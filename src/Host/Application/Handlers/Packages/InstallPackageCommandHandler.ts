import * as fs from "fs";
import * as path from "path";
import { injectable } from "tsyringe";
import { injectToken } from "@Shared/DependencyInjection/inject";
import { type ICommandHandler } from "@Shared/Abstractions/Messaging/ICommandHandler";
import { HandlerFor } from "@Shared/Infrastructure/Messaging/HandlerFor";
import { InstallPackageCommand } from "@Shared/Features/Commands/InstallPackageCommand";
import {
  type PackageWriteResultDto,
  type SkippedTargetDto,
} from "@Shared/Features/Dtos/PackageWriteResultDto";
import { MsBuildTextEditor, type EditResult } from "@Infrastructure/MsBuild/MsBuildTextEditor";
import { isValidPackageId, isValidVersion } from "./PackageWriteInputValidator";
import {
  PackageWriteTargetResolver,
  type WriteTarget,
} from "@Infrastructure/MsBuild/PackageWriteTargetResolver";
import { RestoreScheduler } from "@Infrastructure/MsBuild/RestoreScheduler";
import { OperationLogStore } from "@Infrastructure/MsBuild/OperationLogStore";
import { PackageMetadataCache } from "@Infrastructure/NuGet/PackageMetadataCache";
import { ProjectTfmCache } from "@Infrastructure/Projects/ProjectTfmCache";
import { NuGetV3ApiClient } from "@Infrastructure/NuGet/NuGetV3ApiClient";
import {
  TfmCompatibilityService,
  type CompatibilityResult,
} from "@Infrastructure/Projects/TfmCompatibilityService";
import { ProjectTfmResolutionService } from "@Infrastructure/Projects/ProjectTfmResolutionService";
import { USER_PROMPT, type IUserPrompt } from "../../Abstractions/Prompt/IUserPrompt";
import { type ILogger, LOGGER } from "../../Abstractions/Log/ILogger";

/**
 * Install a package on a specific project, or on all compatible projects
 * in the solution if `projectPath` is not provided.
 *
 * The resolution of project TFMs reuses the same pattern as
 * `GetPackageUpdateInfoQueryHandler.resolveProjectTfms` (via
 * `ProjectTfmCache.getOrResolve`): `ProjectTfmCache` does not expose synchronous
 * reading of already resolved TFMs, so the handler itself carries the necessary
 * dependencies (solution parsers, build file detection, `TfmResolver`) to reconstruct this Map on demand.
 */
@injectable()
@HandlerFor(InstallPackageCommand)
export class InstallPackageCommandHandler implements ICommandHandler<
  InstallPackageCommand,
  PackageWriteResultDto
> {
  constructor(
    private readonly operationLog: OperationLogStore,
    private readonly targetResolver: PackageWriteTargetResolver,
    private readonly editor: MsBuildTextEditor,
    private readonly restoreScheduler: RestoreScheduler,
    private readonly metadataCache: PackageMetadataCache,
    private readonly tfmCache: ProjectTfmCache,
    private readonly apiClient: NuGetV3ApiClient,
    private readonly compatibility: TfmCompatibilityService,
    private readonly tfmResolution: ProjectTfmResolutionService,
    @injectToken(USER_PROMPT) private readonly prompt: IUserPrompt,
    @injectToken(LOGGER) private readonly logger: ILogger,
  ) {}

  async Handle(command: InstallPackageCommand): Promise<PackageWriteResultDto> {
    let result: PackageWriteResultDto;
    try {
      result = await this.handleCore(command);
    } catch (error) {
      // handleCore is designed never to throw: should it happen anyway, the session
      // audit must not stay silent about the attempted operation.
      this.operationLog.recordWrite({
        operation: "install",
        packageId: command.packageId,
        version: command.version,
        status: "Error",
        affectedProjects: [],
        filesChanged: [],
        skipped: [],
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
    this.operationLog.recordWrite({
      operation: "install",
      packageId: command.packageId,
      version: command.version,
      status: result.status,
      affectedProjects: result.affectedProjects,
      filesChanged: result.filesChanged,
      skipped: result.skipped,
      error: result.error,
    });
    return result;
  }

  private async handleCore(command: InstallPackageCommand): Promise<PackageWriteResultDto> {
    if (!isValidPackageId(command.packageId) || !isValidVersion(command.version)) {
      return {
        status: "Error",
        filesChanged: [],
        affectedProjects: [],
        skipped: [],
        error: `identifiant ou version de package invalide : '${command.packageId}' '${command.version}'`,
      };
    }

    const { targets, cpmFilePath: solutionCpmFilePath } = await this.targetResolver.resolveTargets(
      command.solutionPath,
      command.packageId,
    );

    const selected =
      command.projectPath === undefined
        ? targets
        : targets.filter((t) => t.projectPath === command.projectPath);

    const packageFrameworks = await this.frameworksOf(command.packageId, command.version);
    const projectTfms =
      packageFrameworks === undefined
        ? undefined
        : await this.resolveProjectTfmsSafely(command.solutionPath);

    const skipped: SkippedTargetDto[] = [];
    const candidates: WriteTarget[] = [];

    for (const target of selected) {
      if (target.style === "PackagesConfig") {
        skipped.push({ path: target.projectPath, reason: "legacy project" });
        continue;
      }
      if (target.installedVersion !== undefined) {
        skipped.push({ path: target.projectPath, reason: "already installed" });
        continue;
      }
      if (packageFrameworks !== undefined) {
        const tfms = projectTfms?.get(target.projectPath) ?? [];
        const verdict = this.verdictFor(tfms, packageFrameworks);
        if (verdict.verdict === "Incompatible") {
          skipped.push({
            path: target.projectPath,
            reason: verdict.reason ?? "incompatible",
          });
          continue;
        }
      }
      candidates.push(target);
    }

    if (command.projectPath === undefined && candidates.length > 1) {
      const accepted = await this.prompt.confirm(
        `Install ${command.packageId} ${command.version} on ${candidates.length} projects?`,
      );
      if (!accepted) {
        return { status: "Ok", filesChanged: [], affectedProjects: [], skipped: [] };
      }
    }

    const filesChanged = new Set<string>();
    const affectedProjects: string[] = [];
    let cpmVersionEnsured = false;
    // Non-undefined as soon as writing the central PackageVersion has failed (Finding 5):
    // every remaining CpmManaged candidate depends on that same central version — writing its
    // PackageReference would produce a reference with no backing version, a silent build
    // failure. They are therefore routed to `skipped` without ever touching the disk.
    let cpmFailureReason: string | undefined;

    for (const target of candidates) {
      if (target.style === "CpmManaged" && cpmFailureReason !== undefined) {
        skipped.push({ path: target.projectPath, reason: cpmFailureReason });
        continue;
      }

      const attrs: Record<string, string> =
        target.style === "CpmManaged"
          ? { Include: command.packageId }
          : { Include: command.packageId, Version: command.version };

      const applied = this.applyEdit(target.projectPath, (content) =>
        this.editor.addItemElement(content, "PackageReference", attrs),
      );
      if (!applied.ok) {
        if (command.projectPath !== undefined) {
          return {
            status: "Error",
            filesChanged: [...filesChanged],
            affectedProjects,
            skipped,
            error: applied.reason,
          };
        }
        skipped.push({ path: target.projectPath, reason: applied.reason });
        continue;
      }
      filesChanged.add(target.projectPath);
      affectedProjects.push(target.projectPath);

      const cpmFilePath = target.cpmFilePath ?? solutionCpmFilePath;
      if (target.style === "CpmManaged" && cpmFilePath && !cpmVersionEnsured) {
        cpmVersionEnsured = true;
        const cpmResult = this.ensureCpmVersion(cpmFilePath, command.packageId, command.version);
        if (cpmResult.ok) {
          if (cpmResult.changed) {
            filesChanged.add(cpmFilePath);
          }
        } else {
          // The csproj has already been written successfully at this point: never lose
          // that result silently, and never let an exception escape Handle().
          const reason = `${cpmResult.reason} (the reference to '${command.packageId}' was already added in ${target.projectPath})`;
          cpmFailureReason = `${cpmResult.reason} (adding the central PackageVersion for '${command.packageId}' failed: no further CPM PackageReference is written for this package)`;
          if (command.projectPath !== undefined) {
            this.invalidateAndSchedule(command.solutionPath, command.packageId, filesChanged);
            return {
              status: "Error",
              filesChanged: [...filesChanged],
              affectedProjects,
              skipped,
              error: reason,
            };
          }
          skipped.push({ path: cpmFilePath, reason });
        }
      }
    }

    this.invalidateAndSchedule(command.solutionPath, command.packageId, filesChanged);

    return { status: "Ok", filesChanged: [...filesChanged], affectedProjects, skipped };
  }

  private invalidateAndSchedule(
    solutionPath: string,
    packageId: string,
    filesChanged: Set<string>,
  ): void {
    if (filesChanged.size === 0) {
      return;
    }
    this.metadataCache.invalidate(`${solutionPath}::${packageId.toLowerCase()}`);
    this.tfmCache.invalidate(solutionPath);
    this.restoreScheduler.schedule(solutionPath);
  }

  /**
   * Adds the central `<PackageVersion>` when it is missing (at most one attempt per
   * Handle: `cpmVersionEnsured` prevents repeated attempts for the following
   * candidates). Both read AND write are guarded (same discipline as `applyEdit`):
   * this method must never let an exception escape `Handle()`.
   */
  private ensureCpmVersion(
    cpmFilePath: string,
    packageId: string,
    version: string,
  ): { ok: true; changed: boolean } | { ok: false; reason: string } {
    let cpmContent: string;
    try {
      cpmContent = fs.readFileSync(cpmFilePath, "utf8");
    } catch {
      return { ok: false, reason: `cannot read the CPM file: ${cpmFilePath}` };
    }
    if (this.editor.findItemElement(cpmContent, "PackageVersion", packageId)) {
      return { ok: true, changed: false };
    }
    const cpmEdit = this.editor.addItemElement(cpmContent, "PackageVersion", {
      Include: packageId,
      Version: version,
    });
    if (!cpmEdit.ok) {
      return { ok: false, reason: cpmEdit.reason };
    }
    try {
      fs.writeFileSync(cpmFilePath, cpmEdit.content);
    } catch {
      return { ok: false, reason: `cannot write the CPM file: ${cpmFilePath}` };
    }
    return { ok: true, changed: true };
  }

  private applyEdit(
    filePath: string,
    edit: (content: string) => EditResult,
  ): { ok: true } | { ok: false; reason: string } {
    let content: string;
    try {
      content = fs.readFileSync(filePath, "utf8");
    } catch {
      return { ok: false, reason: `cannot read: ${filePath}` };
    }
    const result = edit(content);
    if (!result.ok) {
      return result;
    }
    try {
      fs.writeFileSync(filePath, result.content);
    } catch {
      return { ok: false, reason: `cannot write: ${filePath}` };
    }
    return { ok: true };
  }

  /** Frameworks targeted by the requested version; `undefined` when the verdict cannot be determined (→ Unknown → allowed). */
  private async frameworksOf(packageId: string, version: string): Promise<string[] | undefined> {
    try {
      const leaves = await this.apiClient.getRegistrationLeaves(packageId);
      const leaf = leaves.find((l) => l.version === version);
      if (!leaf) {
        return undefined;
      }
      return leaf.dependencyGroups.map((g) => g.targetFramework).filter((t) => t.length > 0);
    } catch (error) {
      this.logger.Warning("Compatibility verdict unavailable (registration unreachable)", {
        packageId,
        error,
      });
      return undefined;
    }
  }

  /**
   * Resolves the TFMs of every project in the solution, through the cache (same
   * pattern as `GetPackageUpdateInfoQueryHandler`). A local resolution failure must
   * never make the installation fail: the verdict then falls back to Unknown for
   * the projects concerned.
   */
  private async resolveProjectTfmsSafely(solutionPath: string): Promise<Map<string, string[]>> {
    try {
      return await this.tfmCache.getOrResolve(solutionPath, () =>
        this.tfmResolution.resolveProjectTfms(solutionPath),
      );
    } catch (error) {
      this.logger.Error("Failed to resolve project TFMs from solution", error as Error);
      return new Map();
    }
  }

  private verdictFor(tfms: string[], packageFrameworks: string[]): CompatibilityResult {
    if (tfms.length === 0) {
      return { verdict: "Unknown" };
    }
    const rank: Record<CompatibilityResult["verdict"], number> = {
      Compatible: 0,
      Unknown: 1,
      Incompatible: 2,
    };
    let worst: CompatibilityResult = { verdict: "Compatible" };
    for (const tfm of tfms) {
      const result = this.compatibility.isCompatible(tfm, packageFrameworks);
      if (rank[result.verdict] > rank[worst.verdict]) {
        worst = result;
      }
    }
    return worst;
  }
}
