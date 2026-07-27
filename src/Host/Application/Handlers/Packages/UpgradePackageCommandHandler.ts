import * as fs from "fs";
import { injectable } from "tsyringe";
import { injectToken } from "@Shared/DependencyInjection/inject";
import { type ICommandHandler } from "@Shared/Abstractions/Messaging/ICommandHandler";
import { HandlerFor } from "@Shared/Infrastructure/Messaging/HandlerFor";
import { UpgradePackageCommand } from "@Shared/Features/Commands/UpgradePackageCommand";
import {
  type PackageWriteResultDto,
  type SkippedProjectDto,
} from "@Shared/Features/Dtos/PackageWriteResultDto";
import { MsBuildTextEditor, type EditResult } from "@Infrastructure/MsBuild/MsBuildTextEditor";
import { isValidPackageId, isValidVersion } from "./PackageWriteInputValidator";
import {
  PackageWriteTargetResolver,
  type WriteTarget,
} from "@Infrastructure/MsBuild/PackageWriteTargetResolver";
import { RestoreScheduler } from "@Infrastructure/MsBuild/RestoreScheduler";
import { PackageMetadataCache } from "@Infrastructure/NuGet/PackageMetadataCache";
import { ProjectTfmCache } from "@Infrastructure/Projects/ProjectTfmCache";
import { USER_PROMPT, type IUserPrompt } from "../../Abstractions/Prompt/IUserPrompt";
import { type ILogger, LOGGER } from "../../Abstractions/Log/ILogger";

/**
 * Met à jour la version d'un package sur un projet explicite, ou sur tous
 * les projets où il est déjà installé si `projectPath` est absent.
 *
 * Contrairement à `InstallPackageCommandHandler`, aucun verdict de
 * compatibilité TFM n'est calculé ici : l'upgrade est déclenchée depuis une
 * UI qui affiche déjà les verdicts au moment du choix de version, et MSBuild
 * tranchera de toute façon au restore.
 */
@injectable()
@HandlerFor(UpgradePackageCommand)
export class UpgradePackageCommandHandler implements ICommandHandler<
  UpgradePackageCommand,
  PackageWriteResultDto
> {
  constructor(
    private readonly targetResolver: PackageWriteTargetResolver,
    private readonly editor: MsBuildTextEditor,
    private readonly restoreScheduler: RestoreScheduler,
    private readonly metadataCache: PackageMetadataCache,
    private readonly tfmCache: ProjectTfmCache,
    @injectToken(USER_PROMPT) private readonly prompt: IUserPrompt,
    @injectToken(LOGGER) private readonly logger: ILogger,
  ) {}

  async Handle(command: UpgradePackageCommand): Promise<PackageWriteResultDto> {
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

    // Défense en profondeur : l'UI désactive déjà le bouton d'upgrade pour un
    // projet explicite géré centralement (CPM) — la mise à jour doit passer
    // par la version centrale, solution-wide. Si cette branche est atteinte
    // malgré tout, l'état de l'UI est incohérent : on logge pour le signaler.
    if (command.projectPath !== undefined) {
      const explicitTarget = selected.find((t) => t.projectPath === command.projectPath);
      if (explicitTarget?.style === "CpmManaged") {
        this.logger.Warning(
          "Upgrade demandé sur un projet explicite géré centralement (CPM) : l'UI aurait dû désactiver cette action",
          { packageId: command.packageId, projectPath: command.projectPath },
        );
        return {
          status: "Error",
          filesChanged: [],
          affectedProjects: [],
          skipped: [],
          error: `'${command.packageId}' est géré centralement via Directory.Packages.props ; mettez à jour la version centrale de la solution.`,
        };
      }
    }

    const skipped: SkippedProjectDto[] = [];
    const cpmCandidates: WriteTarget[] = [];
    const referenceCandidates: WriteTarget[] = [];

    for (const target of selected) {
      if (target.style === "PackagesConfig") {
        skipped.push({ projectPath: target.projectPath, reason: "legacy project" });
        continue;
      }
      if (target.installedVersion === undefined) {
        skipped.push({ projectPath: target.projectPath, reason: "not installed" });
        continue;
      }
      if (target.style === "CpmManaged") {
        cpmCandidates.push(target);
        continue;
      }
      if (this.hasWildcardVersion(target.projectPath, command.packageId)) {
        skipped.push({ projectPath: target.projectPath, reason: "wildcard version" });
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
            projectPath: target.projectPath,
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
          skipped.push({ projectPath: cpmFilePath, reason: cpmResult.reason });
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
        skipped.push({ projectPath: target.projectPath, reason: applied.reason });
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
   * Vérifie AVANT toute écriture si la version actuellement installée
   * contient un wildcard (`Version="8.*"`). `setVersionAttribute` remplacerait
   * cette valeur telle quelle sans le détecter : cette exclusion (hors
   * périmètre du spec MSBuild wildcard v1) est du ressort du handler, pas de
   * l'éditeur. Une lecture impossible ici n'est jamais fatale : l'échec réel,
   * s'il y en a un, remonte de toute façon via `applyEdit` au moment de
   * l'écriture.
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
      return { ok: false, reason: `lecture impossible : ${filePath}` };
    }
    const result = edit(content);
    if (!result.ok) {
      return result;
    }
    try {
      fs.writeFileSync(filePath, result.content);
    } catch {
      return { ok: false, reason: `écriture impossible : ${filePath}` };
    }
    return { ok: true };
  }
}
