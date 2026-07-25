import { singleton } from "tsyringe";
import { type NuGetSource } from "../../Domain/Packages/Entities/NuGetSource";
import { NuGetConfigScope } from "../../Domain/Packages/Enums/NuGetConfigScope";
import { type PackageSourceMapping } from "../../Domain/Packages/Entities/PackageSourceMapping";
import { NuGetConfigParser } from "./NuGetConfigParser";

/**
 * Result of NuGet configuration resolution
 */
export interface NuGetConfigResolution {
  /** All resolved package sources, ordered by priority */
  sources: NuGetSource[];

  /** Sources grouped by scope */
  sourcesByScope: {
    machineWide: NuGetSource[];
    userProfile: NuGetSource[];
    solutionLocal: NuGetSource[];
  };

  /** Package source mappings */
  packageSourceMappings: PackageSourceMapping[];

  /** Paths to all NuGet.Config files that were processed */
  configPaths: {
    machineWide?: string;
    userProfile?: string;
    solutionLocal: string[];
  };
}

/**
 * Resolves and merges NuGet.Config files from all scopes
 */
@singleton()
export class NuGetConfigResolver {
  constructor(private readonly nuGetConfigParser: NuGetConfigParser) {}

  /**
   * Resolves NuGet configuration for a solution
   */
  public resolve(solutionPath: string): NuGetConfigResolution {
    const configPaths = this.nuGetConfigParser.findAllConfigs(solutionPath);

    const machineWideSources: NuGetSource[] = [];
    const userProfileSources: NuGetSource[] = [];
    const solutionLocalSources: NuGetSource[] = [];

    if (configPaths.machineWide) {
      machineWideSources.push(
        ...this.nuGetConfigParser.parse(configPaths.machineWide, NuGetConfigScope.MachineWide),
      );
    }

    if (configPaths.userProfile) {
      userProfileSources.push(
        ...this.nuGetConfigParser.parse(configPaths.userProfile, NuGetConfigScope.UserProfile),
      );
    }

    for (const configPath of configPaths.solutionLocal) {
      solutionLocalSources.push(
        ...this.nuGetConfigParser.parse(configPath, NuGetConfigScope.SolutionLocal),
      );
    }

    const mergedSources = this.mergeSources(
      machineWideSources,
      userProfileSources,
      solutionLocalSources,
    );

    const packageSourceMappings: PackageSourceMapping[] = [];
    for (const configPath of configPaths.solutionLocal) {
      const mappings = this.nuGetConfigParser.parsePackageSourceMappings(configPath);
      packageSourceMappings.push(...mappings);
    }

    return {
      sources: mergedSources,
      sourcesByScope: {
        machineWide: machineWideSources,
        userProfile: userProfileSources,
        solutionLocal: solutionLocalSources,
      },
      packageSourceMappings,
      configPaths,
    };
  }

  private mergeSources(
    machineWideSources: NuGetSource[],
    userProfileSources: NuGetSource[],
    solutionLocalSources: NuGetSource[],
  ): NuGetSource[] {
    const sourceMap = new Map<string, NuGetSource>();

    for (const source of machineWideSources) {
      sourceMap.set(source.name.toLowerCase(), source);
    }

    for (const source of userProfileSources) {
      sourceMap.set(source.name.toLowerCase(), source);
    }

    for (const source of solutionLocalSources) {
      sourceMap.set(source.name.toLowerCase(), source);
    }

    const allSources = Array.from(sourceMap.values());

    return allSources
      .filter((source) => source.isEnabled)
      .sort((a, b) => {
        if (a.priority !== b.priority) {
          return a.priority - b.priority;
        }

        const scopePriority: Record<NuGetConfigScope, number> = {
          [NuGetConfigScope.SolutionLocal]: 0,
          [NuGetConfigScope.UserProfile]: 1,
          [NuGetConfigScope.MachineWide]: 2,
        };

        return scopePriority[a.scope] - scopePriority[b.scope];
      });
  }

  public getPrivateFeeds(resolution: NuGetConfigResolution): NuGetSource[] {
    return resolution.sources.filter((source) => source.isPrivateFeed());
  }

  public getAzureArtifactsFeeds(resolution: NuGetConfigResolution): NuGetSource[] {
    return resolution.sources.filter((source) => source.isAzureArtifacts());
  }

  public getBaGetFeeds(resolution: NuGetConfigResolution): NuGetSource[] {
    return resolution.sources.filter((source) => source.isBaGet());
  }

  public hasSource(resolution: NuGetConfigResolution, sourceName: string): boolean {
    return resolution.sources.some(
      (source) => source.name.toLowerCase() === sourceName.toLowerCase(),
    );
  }

  public getSource(resolution: NuGetConfigResolution, sourceName: string): NuGetSource | undefined {
    return resolution.sources.find(
      (source) => source.name.toLowerCase() === sourceName.toLowerCase(),
    );
  }

  public getAllowedSourcesForPackage(
    resolution: NuGetConfigResolution,
    packageId: string,
  ): string[] {
    if (resolution.packageSourceMappings.length === 0) {
      return resolution.sources.map((s) => s.name);
    }

    const matchingMappings = resolution.packageSourceMappings.filter((mapping) =>
      mapping.matches(packageId),
    );

    if (matchingMappings.length === 0) {
      return [];
    }

    const allowedSources = new Set<string>();
    for (const mapping of matchingMappings) {
      for (const sourceName of mapping.sourceNames) {
        allowedSources.add(sourceName);
      }
    }

    return Array.from(allowedSources);
  }

  public canSourcePackageFrom(
    resolution: NuGetConfigResolution,
    packageId: string,
    sourceName: string,
  ): boolean {
    const allowedSources = this.getAllowedSourcesForPackage(resolution, packageId);

    if (allowedSources.length === 0) {
      return false;
    }

    return allowedSources.some((s) => s.toLowerCase() === sourceName.toLowerCase());
  }
}
