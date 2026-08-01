import * as fs from "fs";
import { injectable } from "tsyringe";
import { injectToken } from "@Shared/DependencyInjection/inject";
import { type ICommandHandler } from "@Shared/Abstractions/Messaging/ICommandHandler";
import { HandlerFor } from "@Shared/Infrastructure/Messaging/HandlerFor";
import { UpgradePackageCommand } from "@Shared/Features/Commands/UpgradePackageCommand";
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
import { USER_PROMPT, type IUserPrompt } from "../../Abstractions/Prompt/IUserPrompt";
import { type ILogger, LOGGER } from "../../Abstractions/Log/ILogger";

/**
 * Upgrades the version of a package on a specific project, or on all projects
 * where it is already installed if `projectPath` is not provided.
 *
 * Unlike `InstallPackageCommandHandler`, no TFM compatibility verdict
 * is calculated here: the upgrade is triggered from a UI that already
 * displays the verdicts at the time of version selection, and MSBuild
 * will ultimately decide during restore.
 */
@injectable()
@HandlerFor(UpgradePackageCommand)
export class UpgradePackageCommandHandler implements ICommandHandler<
  UpgradePackageCommand,
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

  async Handle(command: UpgradePackageCommand): Promise<PackageWriteResultDto> {
    let result: PackageWriteResultDto;
    try {
      result = await this.handleCore(command);
    } catch (error) {
      // handleCore is designed never to throw: should it happen anyway, the session
      // audit must not stay silent about the attempted operation.
      this.operationLog.recordWrite({
        operation: "upgrade",
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
      operation: "upgrade",
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

  private async handleCore(command: UpgradePackageCommand): Promise<PackageWriteResultDto> {
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
        ? targets.filter((t) => t.installedVersion !== undefined)
        : targets.filter((t) => t.projectPath === command.projectPath);

    if (command.projectPath !== undefined) {
      const explicitTarget = selected.find((t) => t.projectPath === command.projectPath);
      if (explicitTarget?.style === "CpmManaged") {
        this.logger.Warning(
          "Upgrade requested on an explicit project managed centrally (CPM): the UI should have disabled this action",
          { packageId: command.packageId, projectPath: command.projectPath },
        );
        return {
          status: "Error",
          filesChanged: [],
          affectedProjects: [],
          skipped: [],
          error: `'${command.packageId}' is managed centrally through Directory.Packages.props; update the solution's central version instead.`,
        };
      }
    }

    const skipped: SkippedTargetDto[] = [];
    const cpmCandidates: WriteTarget[] = [];
    const referenceCandidates: WriteTarget[] = [];

    for (const target of selected) {
      if (target.style === "PackagesConfig") {
        skipped.push({ path: target.projectPath, reason: "legacy project" });
        continue;
      }
      if (target.installedVersion === undefined) {
        skipped.push({ path: target.projectPath, reason: "not installed" });
        continue;
      }
      if (target.style === "CpmManaged") {
        cpmCandidates.push(target);
        continue;
      }
      if (this.hasWildcardVersion(target.projectPath, command.packageId)) {
        skipped.push({ path: target.projectPath, reason: "wildcard version" });
        continue;
      }
      referenceCandidates.push(target);
    }

    if (cpmCandidates.length > 1) {
      const accepted = await this.prompt.confirm(
        `Update ${command.packageId} to ${command.version}? This will affect ${cpmCandidates.length} projects.`,
      );
      if (!accepted) {
        return { status: "Ok", filesChanged: [], affectedProjects: [], skipped: [] };
      }
    }

    if (command.projectPath === undefined && referenceCandidates.length > 1) {
      const accepted = await this.prompt.confirm(
        `Update ${command.packageId} to ${command.version} on ${referenceCandidates.length} projects?`,
      );
      if (!accepted) {
        return { status: "Ok", filesChanged: [], affectedProjects: [], skipped: [] };
      }
    }

    const filesChanged = new Set<string>();
    const affectedProjects: string[] = [];

    if (cpmCandidates.length > 0) {
      const cpmFilePath = cpmCandidates[0].cpmFilePath ?? solutionCpmFilePath;
      if (cpmFilePath === undefined) {
        for (const target of cpmCandidates) {
          skipped.push({
            path: target.projectPath,
            reason: "fichier de version centrale introuvable",
          });
        }
      } else {
        const cpmResult = this.applyEdit(cpmFilePath, (content) =>
          this.editor.setVersionAttribute(
            content,
            "PackageVersion",
            command.packageId,
            command.version,
          ),
        );
        if (cpmResult.ok) {
          filesChanged.add(cpmFilePath);
          affectedProjects.push(...cpmCandidates.map((t) => t.projectPath));
        } else {
          skipped.push({ path: cpmFilePath, reason: cpmResult.reason });
        }
      }
    }

    for (const target of referenceCandidates) {
      const applied = this.applyEdit(target.projectPath, (content) =>
        this.editor.setVersionAttribute(
          content,
          "PackageReference",
          command.packageId,
          command.version,
        ),
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
   * Before any write, checks if the currently installed version contains
   * a wildcard (e.g., `Version="8.*"`). The `setVersionAttribute` would
   * replace this value as-is without detecting it: this exclusion
   * (outside the scope of the MSBuild wildcard spec v1) is the
   * responsibility of the handler, not the editor. An unreadable
   * file here is never fatal: any actual failure will surface
   * through `applyEdit` at the time of writing.
   */
  private hasWildcardVersion(projectPath: string, packageId: string): boolean {
    let content: string;
    try {
      content = fs.readFileSync(projectPath, "utf8");
    } catch {
      return false;
    }
    const found = this.editor.findItemElement(content, "PackageReference", packageId);
    return found?.attributes["Version"]?.includes("*") ?? false;
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
