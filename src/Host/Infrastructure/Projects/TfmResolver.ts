import * as path from 'path';
import { CsprojParser, ParsedCsproj } from './CsprojParser';
import { BuildConfigFile } from '../../Domain/Build/Entities/BuildConfigFile';
import { BuildConfigFileType } from '../../Domain/Build/Enums/BuildConfigFileType';
import { ProjectSdkType } from '../../Domain/Projects/Enums/ProjectSdkType';
import { ObjectEnumType } from '@/Shared/Types/ObjetEnumType';

/**
 * Represents the resolved TFM information for a project
 */
export interface ResolvedTfm {
  /** The effective target framework(s) */
  targetFrameworks: string[];

  /** Indicates if the project is multi-targeting */
  isMultiTargeting: boolean;

  /** Primary/default target framework (first in the list) */
  primaryTargetFramework: string;

  /** Source of the TFM (where it was defined) */
  source: TfmSource;

  /** SDK type of the project */
  sdkType: ProjectSdkType;

  /** SDK attribute value (for SDK-style projects) */
  sdk?: string;
}

/**
 * Indicates where the TFM was defined
 */
export const TfmSource = {
  /** Defined in the .csproj file itself (highest priority) */
  CsprojFile: '.csproj',

  /** Inherited from Directory.Build.targets */
  DirectoryBuildTargets: 'Directory.Build.targets',

  /** Inherited from Directory.Build.props */
  DirectoryBuildProps: 'Directory.Build.props',

  /** Not found (fallback) */
  NotFound: 'Not Found',
} as const;

export type TfmSource = ObjectEnumType<typeof TfmSource>;

/**
 * Service responsible for resolving the effective TFM of a project
 * Follows MSBuild's priority: .csproj > Directory.Build.targets > Directory.Build.props
 */
export class TfmResolver {
  /**
   * Resolves the effective TFM for a project
   * @param csprojPath Absolute path to the .csproj file
   * @param buildConfigFiles All build configuration files (from BuildConfigDetector)
   */
  public static resolve(csprojPath: string, buildConfigFiles: BuildConfigFile[]): ResolvedTfm {
    // 1. Parse the .csproj file
    const parsedCsproj = CsprojParser.parse(csprojPath);

    // 2. Check if TFM is defined in .csproj
    const csprojTfms = CsprojParser.getAllTargetFrameworks(parsedCsproj);
    if (csprojTfms.length > 0) {
      return {
        targetFrameworks: csprojTfms,
        isMultiTargeting: csprojTfms.length > 1,
        primaryTargetFramework: csprojTfms[0],
        source: TfmSource.CsprojFile,
        sdkType: parsedCsproj.sdkType,
        sdk: parsedCsproj.sdk,
      };
    }

    // 3. If not in .csproj, check Directory.Build.targets
    const projectDir = path.dirname(csprojPath);
    const targetsTfm = this.findTfmInBuildConfig(
      projectDir,
      buildConfigFiles,
      BuildConfigFileType.DirectoryBuildTargets
    );

    if (targetsTfm.length > 0) {
      return {
        targetFrameworks: targetsTfm,
        isMultiTargeting: targetsTfm.length > 1,
        primaryTargetFramework: targetsTfm[0],
        source: TfmSource.DirectoryBuildTargets,
        sdkType: parsedCsproj.sdkType,
        sdk: parsedCsproj.sdk,
      };
    }

    // 4. If not in .targets, check Directory.Build.props
    const propsTfm = this.findTfmInBuildConfig(
      projectDir,
      buildConfigFiles,
      BuildConfigFileType.DirectoryBuildProps
    );

    if (propsTfm.length > 0) {
      return {
        targetFrameworks: propsTfm,
        isMultiTargeting: propsTfm.length > 1,
        primaryTargetFramework: propsTfm[0],
        source: TfmSource.DirectoryBuildProps,
        sdkType: parsedCsproj.sdkType,
        sdk: parsedCsproj.sdk,
      };
    }

    // 5. TFM not found anywhere
    return {
      targetFrameworks: [],
      isMultiTargeting: false,
      primaryTargetFramework: 'unknown',
      source: TfmSource.NotFound,
      sdkType: parsedCsproj.sdkType,
      sdk: parsedCsproj.sdk,
    };
  }

  /**
   * Finds TFM in build configuration files (Directory.Build.props/targets)
   * Searches up the directory tree to find the closest affecting file
   */
  private static findTfmInBuildConfig(
    projectDir: string,
    buildConfigFiles: BuildConfigFile[],
    type: BuildConfigFileType
  ): string[] {
    const filesOfType = buildConfigFiles.filter((f) => f.type === type);

    let currentDir = projectDir;

    // Search up the directory tree
    while (currentDir && currentDir !== path.parse(currentDir).root) {
      const file = filesOfType.find((f) => f.directory === currentDir);
      if (file) {
        return this.extractTfmFromBuildConfig(file);
      }

      currentDir = path.dirname(currentDir);
    }

    // Check root directory
    const rootFile = filesOfType.find((f) => f.directory === path.parse(projectDir).root);

    if (rootFile) {
      return this.extractTfmFromBuildConfig(rootFile);
    }

    return [];
  }

  /**
   * Extracts TFM from a build configuration file's properties
   */
  private static extractTfmFromBuildConfig(configFile: BuildConfigFile): string[] {
    // Get all properties (including inherited from parents)
    const allProps = configFile.getAllProperties();

    // Check for TargetFrameworks (plural) first
    const targetFrameworks = allProps.get('TargetFrameworks');
    if (targetFrameworks) {
      return targetFrameworks
        .split(';')
        .map((f) => f.trim())
        .filter(Boolean);
    }

    // Then check for TargetFramework (singular)
    const targetFramework = allProps.get('TargetFramework');
    if (targetFramework) {
      return [targetFramework];
    }

    return [];
  }

  /**
   * Resolves TFMs for multiple projects
   */
  public static resolveMultiple(
    csprojPaths: string[],
    buildConfigFiles: BuildConfigFile[]
  ): Map<string, ResolvedTfm> {
    const results = new Map<string, ResolvedTfm>();

    for (const csprojPath of csprojPaths) {
      try {
        const resolved = this.resolve(csprojPath, buildConfigFiles);
        results.set(csprojPath, resolved);
      } catch (error) {
        console.error(`Failed to resolve TFM for ${csprojPath}:`, error);
        // Add a fallback result
        results.set(csprojPath, {
          targetFrameworks: [],
          isMultiTargeting: false,
          primaryTargetFramework: 'unknown',
          source: TfmSource.NotFound,
          sdkType: 'Unknown',
        });
      }
    }

    return results;
  }
}
