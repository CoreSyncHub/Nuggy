import * as path from "path";
import { singleton } from "tsyringe";
import { SlnParser } from "../Solution/SlnParser";
import { SlnxParser } from "../Solution/SlnxParser";
import { BuildConfigDetector } from "../Build/BuildConfigDetector";
import { BuildConfigParser } from "../Build/BuildConfigParser";
import { TfmResolver, type ResolvedTfm } from "./TfmResolver";
import { type BuildConfigFile } from "../../Domain/Build/Entities/BuildConfigFile";

/** Tout ce que la lecture d'une solution produit, en une seule passe. */
export interface SolutionTfmResolution {
  projectPaths: string[];
  buildConfigFiles: BuildConfigFile[];
  resolvedTfms: Map<string, ResolvedTfm>;
}

/**
 * Séquence « parser la solution → charger les fichiers de configuration MSBuild →
 * résoudre les TFM effectifs », partagée par tous les handlers qui en ont besoin.
 *
 * Elle était auparavant recopiée dans quatre handlers, dont deux à l'identique au
 * caractère près, en traînant cinq dépendances de constructeur à chaque fois. Les
 * quatre copies divergeaient déjà sur un point : deux jetaient sur une extension de
 * solution inconnue, deux la traitaient silencieusement comme un `.sln`. Le service
 * tranche pour l'erreur explicite — un fichier qui n'est ni `.sln` ni `.slnx` n'a
 * pas de projets à lire, et l'annoncer vaut mieux que de rendre une liste vide.
 */
@singleton()
export class ProjectTfmResolutionService {
  constructor(
    private readonly slnParser: SlnParser,
    private readonly slnxParser: SlnxParser,
    private readonly buildConfigDetector: BuildConfigDetector,
    private readonly buildConfigParser: BuildConfigParser,
    private readonly tfmResolver: TfmResolver,
  ) {}

  /** Chemins des projets déclarés par la solution. Jette si l'extension est inconnue. */
  public parseProjectPaths(solutionPath: string): string[] {
    const ext = path.extname(solutionPath).toLowerCase();
    if (ext === ".slnx") {
      return this.slnxParser.parse(solutionPath).projects.map((p) => p.path);
    }
    if (ext === ".sln") {
      return this.slnParser.parse(solutionPath).projects.map((p) => p.path);
    }
    throw new Error(`Unsupported solution format: ${ext}`);
  }

  /** Fichiers de configuration du workspace, hiérarchie construite et contenus analysés. */
  public async loadBuildConfigFiles(): Promise<BuildConfigFile[]> {
    const buildConfigFiles = await this.buildConfigDetector.findAllConfigFiles();
    this.buildConfigDetector.buildHierarchy(buildConfigFiles);
    for (const file of buildConfigFiles) {
      this.buildConfigParser.parse(file.path, file);
    }
    return buildConfigFiles;
  }

  /**
   * Résolution complète en une passe. Les appelants qui ont besoin des fichiers
   * de configuration ou de la résolution détaillée passent par ici plutôt que
   * d'enchaîner les méthodes granulaires : la découverte des fichiers de config
   * interroge le workspace, autant ne la faire qu'une fois.
   */
  public async resolveSolution(solutionPath: string): Promise<SolutionTfmResolution> {
    const projectPaths = this.parseProjectPaths(solutionPath);
    const buildConfigFiles = await this.loadBuildConfigFiles();
    return {
      projectPaths,
      buildConfigFiles,
      resolvedTfms: this.tfmResolver.resolveMultiple(projectPaths, buildConfigFiles),
    };
  }

  /** TFM effectifs par chemin de projet, héritage MSBuild appliqué. */
  public async resolveProjectTfms(solutionPath: string): Promise<Map<string, string[]>> {
    const { resolvedTfms } = await this.resolveSolution(solutionPath);
    return new Map([...resolvedTfms.entries()].map(([p, r]) => [p, r.targetFrameworks]));
  }
}
