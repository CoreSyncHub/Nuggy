import { NuGetSource } from '../../Domain/Packages/Entities/NuGetSource';
import { NuGetConfigScope } from '../../Domain/Packages/Enums/NuGetConfigScope';
import { PackageSourceMapping } from '../../Domain/Packages/Entities/PackageSourceMapping';
import { NuGetConfigParser } from './NuGetConfigParser';

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
 * Follows NuGet's configuration resolution rules:
 * 1. Solution-local configs (closest first) override
 * 2. User-profile config
 * 3. Machine-wide config
 */
export class NuGetConfigResolver {
  /**
   * Resolves NuGet configuration for a solution
   * @param solutionPath Path to the solution file or solution directory
   * @returns Merged configuration from all scopes
   */
  public static resolve(solutionPath: string): NuGetConfigResolution {
    // Find all config files
    const configPaths = NuGetConfigParser.findAllConfigs(solutionPath);

    // Parse each config file
    const machineWideSources: NuGetSource[] = [];
    const userProfileSources: NuGetSource[] = [];
    const solutionLocalSources: NuGetSource[] = [];

    // Machine-wide config (lowest priority)
    if (configPaths.machineWide) {
      machineWideSources.push(
        ...NuGetConfigParser.parse(configPaths.machineWide, NuGetConfigScope.MachineWide)
      );
    }

    // User-profile config (medium priority)
    if (configPaths.userProfile) {
      userProfileSources.push(
        ...NuGetConfigParser.parse(configPaths.userProfile, NuGetConfigScope.UserProfile)
      );
    }

    // Solution-local configs (highest priority, closest first)
    for (const configPath of configPaths.solutionLocal) {
      solutionLocalSources.push(
        ...NuGetConfigParser.parse(configPath, NuGetConfigScope.SolutionLocal)
      );
    }

    // Merge sources with priority rules
    const mergedSources = this.mergeSources(
      machineWideSources,
      userProfileSources,
      solutionLocalSources
    );

    // Extract package source mappings from solution-local configs
    // Only solution-local configs can define package source mappings
    const packageSourceMappings: PackageSourceMapping[] = [];
    for (const configPath of configPaths.solutionLocal) {
      const mappings = NuGetConfigParser.parsePackageSourceMappings(configPath);
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

  /**
   * Merges sources from different scopes according to NuGet's resolution rules
   *
   * Rules:
   * - Solution-local sources override user-profile and machine-wide
   * - User-profile sources override machine-wide
   * - Sources with the same name are deduplicated (closest scope wins)
   * - Disabled sources are respected
   *
   * @returns Merged and deduplicated sources, ordered by priority
   */
  private static mergeSources(
    machineWideSources: NuGetSource[],
    userProfileSources: NuGetSource[],
    solutionLocalSources: NuGetSource[]
  ): NuGetSource[] {
    const sourceMap = new Map<string, NuGetSource>();

    // Add machine-wide sources first (lowest priority)
    for (const source of machineWideSources) {
      sourceMap.set(source.name.toLowerCase(), source);
    }

    // Add user-profile sources (override machine-wide)
    for (const source of userProfileSources) {
      sourceMap.set(source.name.toLowerCase(), source);
    }

    // Add solution-local sources (override all, highest priority)
    for (const source of solutionLocalSources) {
      sourceMap.set(source.name.toLowerCase(), source);
    }

    // Convert to array and filter out disabled sources
    const allSources = Array.from(sourceMap.values());

    // Return only enabled sources, sorted by priority (if priorities are specified)
    return allSources
      .filter((source) => source.isEnabled)
      .sort((a, b) => {
        // Sort by priority (lower number = higher priority)
        if (a.priority !== b.priority) {
          return a.priority - b.priority;
        }

        // If priorities are equal, prefer solution-local > user-profile > machine-wide
        const scopePriority: Record<NuGetConfigScope, number> = {
          [NuGetConfigScope.SolutionLocal]: 0,
          [NuGetConfigScope.UserProfile]: 1,
          [NuGetConfigScope.MachineWide]: 2,
        };

        return scopePriority[a.scope] - scopePriority[b.scope];
      });
  }

  /**
   * Gets all private feeds from the resolved configuration
   * @param resolution The resolved configuration
   * @returns Array of private feed sources
   */
  public static getPrivateFeeds(resolution: NuGetConfigResolution): NuGetSource[] {
    return resolution.sources.filter((source) => source.isPrivateFeed());
  }

  /**
   * Gets all Azure Artifacts feeds from the resolved configuration
   * @param resolution The resolved configuration
   * @returns Array of Azure Artifacts sources
   */
  public static getAzureArtifactsFeeds(resolution: NuGetConfigResolution): NuGetSource[] {
    return resolution.sources.filter((source) => source.isAzureArtifacts());
  }

  /**
   * Gets all BaGet feeds from the resolved configuration
   * @param resolution The resolved configuration
   * @returns Array of BaGet sources
   */
  public static getBaGetFeeds(resolution: NuGetConfigResolution): NuGetSource[] {
    return resolution.sources.filter((source) => source.isBaGet());
  }

  /**
   * Checks if a package source exists by name
   * @param resolution The resolved configuration
   * @param sourceName The source name to check
   * @returns True if the source exists and is enabled
   */
  public static hasSource(resolution: NuGetConfigResolution, sourceName: string): boolean {
    return resolution.sources.some(
      (source) => source.name.toLowerCase() === sourceName.toLowerCase()
    );
  }

  /**
   * Gets a specific source by name
   * @param resolution The resolved configuration
   * @param sourceName The source name to find
   * @returns The source, or undefined if not found
   */
  public static getSource(
    resolution: NuGetConfigResolution,
    sourceName: string
  ): NuGetSource | undefined {
    return resolution.sources.find(
      (source) => source.name.toLowerCase() === sourceName.toLowerCase()
    );
  }

  /**
   * Gets the allowed sources for a package ID based on package source mappings
   * @param resolution The resolved configuration
   * @param packageId The package ID to check
   * @returns Array of source names that can provide this package, or all sources if no mapping exists
   */
  public static getAllowedSourcesForPackage(
    resolution: NuGetConfigResolution,
    packageId: string
  ): string[] {
    // If no mappings are defined, all sources are allowed
    if (resolution.packageSourceMappings.length === 0) {
      return resolution.sources.map((s) => s.name);
    }

    // Find mappings that match this package ID
    const matchingMappings = resolution.packageSourceMappings.filter((mapping) =>
      mapping.matches(packageId)
    );

    // If no mappings match, no sources are allowed (strict mode)
    if (matchingMappings.length === 0) {
      return [];
    }

    // Collect all source names from matching mappings
    const allowedSources = new Set<string>();
    for (const mapping of matchingMappings) {
      for (const sourceName of mapping.sourceNames) {
        allowedSources.add(sourceName);
      }
    }

    return Array.from(allowedSources);
  }

  /**
   * Checks if a package can be sourced from a specific feed
   * @param resolution The resolved configuration
   * @param packageId The package ID to check
   * @param sourceName The source name to check
   * @returns True if the package can be sourced from this feed
   */
  public static canSourcePackageFrom(
    resolution: NuGetConfigResolution,
    packageId: string,
    sourceName: string
  ): boolean {
    const allowedSources = this.getAllowedSourcesForPackage(resolution, packageId);

    // If no sources are allowed, return false
    if (allowedSources.length === 0) {
      return false;
    }

    return allowedSources.some((s) => s.toLowerCase() === sourceName.toLowerCase());
  }
}
