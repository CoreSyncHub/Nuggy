import * as fs from "fs";
import { injectable } from "tsyringe";
import { injectToken } from "@Shared/DependencyInjection/inject";
import { type ICommandHandler } from "@Shared/Abstractions/Messaging/ICommandHandler";
import { HandlerFor } from "@Shared/Infrastructure/Messaging/HandlerFor";
import { UninstallPackageCommand } from "@Shared/Features/Commands/UninstallPackageCommand";
import {
  type PackageWriteResultDto,
  type SkippedProjectDto,
} from "@Shared/Features/Dtos/PackageWriteResultDto";
import { MsBuildTextEditor, type EditResult } from "@Infrastructure/MsBuild/MsBuildTextEditor";
import { isValidPackageId } from "./PackageWriteInputValidator";
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
 * Retire un package d'un projet explicite, ou de tous les projets où il est
 * déjà installé si `projectPath` est absent.
 *
 * Contrairement à `UpgradePackageCommandHandler`, retirer une
 * `<PackageReference>` reste une action par-projet valide même sous CPM (on
 * ne modifie pas la version centrale, seulement la référence locale) : il
 * n'existe donc pas de branche de refus pour une cible CPM explicite. En
 * revanche, une fois tous les retraits appliqués, si plus aucun projet de la
 * solution ne référence le package, le `<PackageVersion>` devenu orphelin
 * est retiré du fichier CPM — ce qui impose de RE-résoudre les cibles après
 * écriture (`PackageWriteTargetResolver.resolveTargets` reflète l'état
 * disque courant).
 */
@injectable()
@HandlerFor(UninstallPackageCommand)
export class UninstallPackageCommandHandler implements ICommandHandler<
  UninstallPackageCommand,
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

  async Handle(command: UninstallPackageCommand): Promise<PackageWriteResultDto> {
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

    const skipped: SkippedProjectDto[] = [];
    const candidates: WriteTarget[] = [];

    for (const target of selected) {
      if (target.style === "PackagesConfig") {
        skipped.push({ projectPath: target.projectPath, reason: "legacy project" });
        continue;
      }
      if (target.installedVersion === undefined) {
        skipped.push({ projectPath: target.projectPath, reason: "not installed" });
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
        skipped.push({ projectPath: target.projectPath, reason: applied.reason });
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
          // Les csproj ont déjà été écrits avec succès à ce stade : jamais de perte
          // silencieuse de ce résultat, ni d'exception qui s'échapperait de Handle().
          const reason = `${cpmResult.reason} (le nettoyage du PackageVersion orphelin de '${command.packageId}' a échoué)`;
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
          skipped.push({ projectPath: solutionCpmFilePath, reason });
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
   * Re-résout les cibles d'écriture APRÈS les retraits déjà appliqués sur le
   * disque, pour déterminer si un projet de la solution référence encore le
   * package (quel que soit son style). Un échec de résolution n'est jamais
   * fatal ici : on considère alors, par prudence, que le package est encore
   * référencé — le `<PackageVersion>` central n'est retiré que sur certitude.
   */
  private async isStillReferenced(solutionPath: string, packageId: string): Promise<boolean> {
    try {
      const { targets } = await this.targetResolver.resolveTargets(solutionPath, packageId);
      return targets.some((t) => t.installedVersion !== undefined);
    } catch (error) {
      this.logger.Warning(
        "Impossible de vérifier si le package est encore référencé après désinstallation : le PackageVersion central est conservé par prudence",
        { packageId, error },
      );
      return true;
    }
  }

  /**
   * Retire le `<PackageVersion>` central devenu orphelin (au plus une tentative
   * par Handle : appelée une seule fois, après tous les retraits). Lecture ET
   * écriture sont protégées (même discipline que `InstallPackageCommandHandler.
   * ensureCpmVersion`) : cette méthode ne doit jamais laisser une exception
   * s'échapper de `Handle()`.
   */
  private removeOrphanCpmVersion(
    cpmFilePath: string,
    packageId: string,
  ): { ok: true; changed: boolean } | { ok: false; reason: string } {
    let cpmContent: string;
    try {
      cpmContent = fs.readFileSync(cpmFilePath, "utf8");
    } catch {
      return { ok: false, reason: `lecture du fichier CPM impossible : ${cpmFilePath}` };
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
      return { ok: false, reason: `écriture du fichier CPM impossible : ${cpmFilePath}` };
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
