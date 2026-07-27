import * as fs from "fs";
import * as path from "path";
import { injectable } from "tsyringe";
import { injectToken } from "@Shared/DependencyInjection/inject";
import { type ICommandHandler } from "@Shared/Abstractions/Messaging/ICommandHandler";
import { HandlerFor } from "@Shared/Infrastructure/Messaging/HandlerFor";
import { InstallPackageCommand } from "@Shared/Features/Commands/InstallPackageCommand";
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
import { NuGetV3ApiClient } from "@Infrastructure/NuGet/NuGetV3ApiClient";
import {
  TfmCompatibilityService,
  type CompatibilityResult,
} from "@Infrastructure/Projects/TfmCompatibilityService";
import { SlnParser } from "@Infrastructure/Solution/SlnParser";
import { SlnxParser } from "@Infrastructure/Solution/SlnxParser";
import { BuildConfigDetector } from "@Infrastructure/Build/BuildConfigDetector";
import { BuildConfigParser } from "@Infrastructure/Build/BuildConfigParser";
import { TfmResolver } from "@Infrastructure/Projects/TfmResolver";
import { USER_PROMPT, type IUserPrompt } from "../../Abstractions/Prompt/IUserPrompt";
import { type ILogger, LOGGER } from "../../Abstractions/Log/ILogger";

/**
 * Installe un package sur un projet explicite, ou sur tous les projets
 * compatibles non équipés de la solution si `projectPath` est absent.
 *
 * La résolution des TFM de projet réutilise le même motif que
 * `GetPackageUpdateInfoQueryHandler.resolveProjectTfms` (via
 * `ProjectTfmCache.getOrResolve`) : `ProjectTfmCache` n'expose pas de lecture
 * synchrone des TFM déjà résolus, donc le handler porte lui-même les
 * dépendances nécessaires (parsers de solution, détection des fichiers de
 * build, `TfmResolver`) pour reconstruire cette Map à la demande.
 */
@injectable()
@HandlerFor(InstallPackageCommand)
export class InstallPackageCommandHandler implements ICommandHandler<
  InstallPackageCommand,
  PackageWriteResultDto
> {
  constructor(
    private readonly targetResolver: PackageWriteTargetResolver,
    private readonly editor: MsBuildTextEditor,
    private readonly restoreScheduler: RestoreScheduler,
    private readonly metadataCache: PackageMetadataCache,
    private readonly tfmCache: ProjectTfmCache,
    private readonly apiClient: NuGetV3ApiClient,
    private readonly compatibility: TfmCompatibilityService,
    private readonly slnParser: SlnParser,
    private readonly slnxParser: SlnxParser,
    private readonly buildConfigDetector: BuildConfigDetector,
    private readonly buildConfigParser: BuildConfigParser,
    private readonly tfmResolver: TfmResolver,
    @injectToken(USER_PROMPT) private readonly prompt: IUserPrompt,
    @injectToken(LOGGER) private readonly logger: ILogger,
  ) {}

  async Handle(command: InstallPackageCommand): Promise<PackageWriteResultDto> {
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

    const skipped: SkippedProjectDto[] = [];
    const candidates: WriteTarget[] = [];

    for (const target of selected) {
      if (target.style === "PackagesConfig") {
        skipped.push({ projectPath: target.projectPath, reason: "legacy project" });
        continue;
      }
      if (target.installedVersion !== undefined) {
        skipped.push({ projectPath: target.projectPath, reason: "already installed" });
        continue;
      }
      if (packageFrameworks !== undefined) {
        const tfms = projectTfms?.get(target.projectPath) ?? [];
        const verdict = this.verdictFor(tfms, packageFrameworks);
        if (verdict.verdict === "Incompatible") {
          skipped.push({
            projectPath: target.projectPath,
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
    // Non-undefined dès que l'écriture du PackageVersion central a échoué (Finding 5) :
    // tout candidat CpmManaged restant dépend de cette même version centrale — écrire sa
    // PackageReference produirait une référence sans version backing, un échec de build
    // silencieux. On les route donc vers `skipped` sans jamais toucher au disque.
    let cpmFailureReason: string | undefined;

    for (const target of candidates) {
      if (target.style === "CpmManaged" && cpmFailureReason !== undefined) {
        skipped.push({ projectPath: target.projectPath, reason: cpmFailureReason });
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
        skipped.push({ projectPath: target.projectPath, reason: applied.reason });
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
          // Le csproj a déjà été écrit avec succès à ce stade : jamais de perte
          // silencieuse de ce résultat, ni d'exception qui s'échapperait de Handle().
          const reason = `${cpmResult.reason} (la référence à '${command.packageId}' a déjà été ajoutée dans ${target.projectPath})`;
          cpmFailureReason = `${cpmResult.reason} (l'ajout du PackageVersion central pour '${command.packageId}' a échoué : aucune autre PackageReference CPM n'est écrite pour ce package)`;
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
          skipped.push({ projectPath: cpmFilePath, reason });
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
   * Ajoute le `<PackageVersion>` central s'il est absent (au plus une tentative par
   * Handle : `cpmVersionEnsured` empêche les tentatives répétées pour les candidats
   * suivants). Lecture ET écriture sont protégées (même discipline que `applyEdit`) :
   * cette méthode ne doit jamais laisser une exception s'échapper de `Handle()`.
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
      return { ok: false, reason: `lecture du fichier CPM impossible : ${cpmFilePath}` };
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

  /** Frameworks ciblés par la version demandée ; `undefined` si le verdict est indéterminable (→ Unknown → autorisé). */
  private async frameworksOf(packageId: string, version: string): Promise<string[] | undefined> {
    try {
      const leaves = await this.apiClient.getRegistrationLeaves(packageId);
      const leaf = leaves.find((l) => l.version === version);
      if (!leaf) {
        return undefined;
      }
      return leaf.dependencyGroups.map((g) => g.targetFramework).filter((t) => t.length > 0);
    } catch (error) {
      this.logger.Warning("Verdict de compatibilité indisponible (registration inaccessible)", {
        packageId,
        error,
      });
      return undefined;
    }
  }

  /**
   * Résout les TFM de chaque projet de la solution, via le cache (même motif
   * que `GetPackageUpdateInfoQueryHandler.resolveProjectTfms`). Un échec de
   * résolution locale ne doit jamais faire échouer l'installation : le verdict
   * retombe alors sur Unknown pour les projets concernés.
   */
  private async resolveProjectTfmsSafely(solutionPath: string): Promise<Map<string, string[]>> {
    try {
      return await this.tfmCache.getOrResolve(solutionPath, () =>
        this.resolveProjectTfms(solutionPath),
      );
    } catch (error) {
      this.logger.Error("Failed to resolve project TFMs from solution", error as Error);
      return new Map();
    }
  }

  private async resolveProjectTfms(solutionPath: string): Promise<Map<string, string[]>> {
    const ext = path.extname(solutionPath).toLowerCase();
    const projectPaths =
      ext === ".slnx"
        ? this.slnxParser.parse(solutionPath).projects.map((p) => p.path)
        : this.slnParser.parse(solutionPath).projects.map((p) => p.path);

    const buildConfigFiles = await this.buildConfigDetector.findAllConfigFiles();
    this.buildConfigDetector.buildHierarchy(buildConfigFiles);
    for (const file of buildConfigFiles) {
      this.buildConfigParser.parse(file.path, file);
    }
    const resolved = this.tfmResolver.resolveMultiple(projectPaths, buildConfigFiles);
    return new Map([...resolved.entries()].map(([p, r]) => [p, r.targetFrameworks]));
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
