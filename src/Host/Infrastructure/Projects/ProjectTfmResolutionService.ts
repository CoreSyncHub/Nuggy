import * as path from "path";
import { singleton } from "tsyringe";
import { SlnParser } from "../Solution/SlnParser";
import { SlnxParser } from "../Solution/SlnxParser";
import { BuildConfigDetector } from "../Build/BuildConfigDetector";
import { BuildConfigParser } from "../Build/BuildConfigParser";
import { TfmResolver, type ResolvedTfm } from "./TfmResolver";
import { type BuildConfigFile } from "../../Domain/Build/Entities/BuildConfigFile";

/** Everything reading a solution produces, in a single pass. */
export interface SolutionTfmResolution {
  projectPaths: string[];
  buildConfigFiles: BuildConfigFile[];
  resolvedTfms: Map<string, ResolvedTfm>;
}

/**
 * The "parse the solution → load MSBuild configuration files → resolve
 * effective TFMs" sequence, shared by every handler that needs it.
 *
 * It used to be copied into four handlers, two of them character-for-character
 * identical, each dragging along five constructor dependencies. The four copies
 * had already diverged on one point: two threw on an unknown solution extension,
 * two silently treated it as a `.sln`. This service settles on the explicit
 * error — a file that is neither `.sln` nor `.slnx` has no projects to read, and
 * saying so beats returning an empty list.
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

  /** Project paths declared by the solution. Throws if the extension is unknown. */
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

  /** Workspace configuration files, hierarchy built and contents parsed. */
  public async loadBuildConfigFiles(): Promise<BuildConfigFile[]> {
    const buildConfigFiles = await this.buildConfigDetector.findAllConfigFiles();
    this.buildConfigDetector.buildHierarchy(buildConfigFiles);
    for (const file of buildConfigFiles) {
      this.buildConfigParser.parse(file.path, file);
    }
    return buildConfigFiles;
  }

  /**
   * Full resolution in a single pass. Callers that need the configuration files
   * or the detailed resolution come through here rather than chaining the
   * granular methods: discovering configuration files queries the workspace, so
   * it is worth doing only once.
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

  /** Effective TFMs per project path, with MSBuild inheritance applied. */
  public async resolveProjectTfms(solutionPath: string): Promise<Map<string, string[]>> {
    const { resolvedTfms } = await this.resolveSolution(solutionPath);
    return new Map([...resolvedTfms.entries()].map(([p, r]) => [p, r.targetFrameworks]));
  }
}
