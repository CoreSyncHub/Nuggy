import * as fs from "fs";
import { injectable } from "tsyringe";
import { injectToken } from "@Shared/DependencyInjection/inject";
import { type ICommandHandler } from "@Shared/Abstractions/Messaging/ICommandHandler";
import { HandlerFor } from "@Shared/Infrastructure/Messaging/HandlerFor";
import { UninstallPackageCommand } from "@Shared/Features/Commands/UninstallPackageCommand";
import {
  type PackageWriteResultDto,
  type SkippedTargetDto,
} from "@Shared/Features/Dtos/PackageWriteResultDto";
import { MsBuildTextEditor, type EditResult } from "@Infrastructure/MsBuild/MsBuildTextEditor";
import { isValidPackageId } from "./PackageWriteInputValidator";
import {
  PackageWriteTargetResolver,
  type WriteTarget,
} from "@Infrastructure/MsBuild/PackageWriteTargetResolver";
import { RestoreScheduler } from "@Infrastructure/MsBuild/RestoreScheduler";
import { OperationLogStore } from "@Infrastructure/MsBuild/OperationLogStore";
import { PackageMetadataCache } from "@Infrastructure/NuGet/PackageMetadataCache";
import { ProjectTfmCache } from "@Infrastructure/Projects/ProjectTfmCache";
import { USER_PROMPT, type IUserPrompt } from "../../Abstractions/Prompt/IUserPrompt";
import { type ILogger, LOGGER } from "../../Abstractions/Log/ILogger";

/**
 * Uninstalls a package from a specific project, or from all projects where it is
 * already installed if `projectPath` is not provided.
 *
 * Unlike `UpgradePackageCommandHandler`, removing a `<PackageReference>`
 * remains a valid per-project action even under CPM(we do not modify
 * the central version, only the local reference).
 * Therefore, there is no rejection branch for an explicit CPM target.
 * However, once all removals have been applied, if no project in the solution
 * references the package anymore, the orphaned `<PackageVersion>` is removed
 * from the CPM file — which requires RE-resolving the targets after writing
 * (`PackageWriteTargetResolver.resolveTargets` reflects the current disk state).
 */
@injectable()
@HandlerFor(UninstallPackageCommand)
export class UninstallPackageCommandHandler implements ICommandHandler<
  UninstallPackageCommand,
  PackageWriteResultDto
> {
  constructor(
    private readonly operationLog: OperationLogStore,
    private readonly targetResolver: PackageWriteTargetResolver,
    private readonly editor: MsBuildTextEditor,
    private readonly restoreScheduler: RestoreScheduler,
    private readonly metadataCache: PackageMetadataCache,
    private readonly tfmCache: ProjectTfmCache,
    @injectToken(USER_PROMPT) private readonly prompt: IUserPrompt,
    @injectToken(LOGGER) private readonly logger: ILogger,
  ) {}

  async Handle(command: UninstallPackageCommand): Promise<PackageWriteResultDto> {
    let result: PackageWriteResultDto;
    try {
      result = await this.handleCore(command);
    } catch (error) {
      this.operationLog.recordWrite({
        operation: "uninstall",
        packageId: command.packageId,
        status: "Error",
        affectedProjects: [],
        filesChanged: [],
        skipped: [],
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
    this.operationLog.recordWrite({
      operation: "uninstall",
      packageId: command.packageId,
      status: result.status,
      affectedProjects: result.affectedProjects,
      filesChanged: result.filesChanged,
      skipped: result.skipped,
      error: result.error,
    });
    return result;
  }

  private async handleCore(command: UninstallPackageCommand): Promise<PackageWriteResultDto> {
    if (!isValidPackageId(command.packageId)) {
      return {
        status: "Error",
        filesChanged: [],
        affectedProjects: [],
        skipped: [],
        error: `identifiant de package invalide : '${command.packageId}'`,
      };
    }

    const { targets, cpmFilePath: solutionCpmFilePath } = await this.targetResolver.resolveTargets(
      command.solutionPath,
      command.packageId,
    );

    const selected =
      command.projectPath === undefined
        ? targets.filter((t) => t.installedVersion !== undefined)
        : targets.filter((t) => t.projectPath === command.projectPath);

    const skipped: SkippedTargetDto[] = [];
    const candidates: WriteTarget[] = [];

    for (const target of selected) {
      if (target.style === "PackagesConfig") {
        skipped.push({ path: target.projectPath, reason: "legacy project" });
        continue;
      }
      if (target.installedVersion === undefined) {
        skipped.push({ path: target.projectPath, reason: "not installed" });
        continue;
      }
      candidates.push(target);
    }

    if (command.projectPath === undefined && candidates.length > 1) {
      const accepted = await this.prompt.confirm(
        `Uninstall ${command.packageId} from ${candidates.length} projects?`,
      );
      if (!accepted) {
        return { status: "Ok", filesChanged: [], affectedProjects: [], skipped: [] };
      }
    }

    const filesChanged = new Set<string>();
    const affectedProjects: string[] = [];
    let touchedCpm = false;

    for (const target of candidates) {
      const applied = this.applyEdit(target.projectPath, (content) =>
        this.editor.removeItemElement(content, "PackageReference", command.packageId),
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

      if (target.style === "CpmManaged") {
        touchedCpm = true;
      }
    }

    if (touchedCpm && solutionCpmFilePath !== undefined) {
      const stillReferenced = await this.isStillReferenced(command.solutionPath, command.packageId);
      if (!stillReferenced) {
        const cpmResult = this.removeOrphanCpmVersion(solutionCpmFilePath, command.packageId);
        if (cpmResult.ok) {
          if (cpmResult.changed) {
            filesChanged.add(solutionCpmFilePath);
          }
        } else {
          // The csproj files have already been written successfully at this point: never
          // lose that result silently, and never let an exception escape Handle().
          const reason = `${cpmResult.reason} (cleanup of the orphaned PackageVersion for '${command.packageId}' failed)`;
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
          skipped.push({ path: solutionCpmFilePath, reason });
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
   *  Re-resolves the write targets AFTER the removals have already been applied on disk,
   * to determine if any project in the solution still references the package
   * (regardless of its style). A resolution failure is never fatal here: we then consider,
   * as a precaution, that the package is still referenced — the central `<PackageVersion>`
   * is only removed on certainty.
   */
  private async isStillReferenced(solutionPath: string, packageId: string): Promise<boolean> {
    try {
      const { targets } = await this.targetResolver.resolveTargets(solutionPath, packageId);
      return targets.some((t) => t.installedVersion !== undefined);
    } catch (error) {
      this.logger.Warning(
        "Cannot verify whether the package is still referenced after uninstall: the central PackageVersion is kept out of caution",
        { packageId, error },
      );
      return true;
    }
  }

  /**
   * Removes the orphaned central `<PackageVersion>`(at most one attempt per Handle:
   * called only once, after all removals). Both reading AND writing are protected
   * (same discipline as `InstallPackageCommandHandler.ensureCpmVersion`): this
   * method must never let an exception escape from `Handle()`.
   */
  private removeOrphanCpmVersion(
    cpmFilePath: string,
    packageId: string,
  ): { ok: true; changed: boolean } | { ok: false; reason: string } {
    let cpmContent: string;
    try {
      cpmContent = fs.readFileSync(cpmFilePath, "utf8");
    } catch {
      return { ok: false, reason: `cannot read the CPM file: ${cpmFilePath}` };
    }
    if (!this.editor.findItemElement(cpmContent, "PackageVersion", packageId)) {
      return { ok: true, changed: false };
    }
    const cpmEdit = this.editor.removeItemElement(cpmContent, "PackageVersion", packageId);
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
}
