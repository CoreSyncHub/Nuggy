import * as path from 'path';
import { singleton } from 'tsyringe';
import { CsprojParser } from './CsprojParser';
import { type BuildConfigFile } from '@Domain/Build/Entities/BuildConfigFile';
import { BuildConfigFileType } from '@Domain/Build/Enums/BuildConfigFileType';
import { type ProjectSdkType } from '@Domain/Projects/Enums/ProjectSdkType';
import { type ObjectEnumType } from '@/Shared/Types/ObjetEnumType';
import { type ILogger, LOGGER } from '@/Host/Application/Abstractions/Log/ILogger';
import { injectToken } from '@Shared/DependencyInjection/inject';

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

export const TfmSource = {
  CsprojFile: '.csproj',
  DirectoryBuildTargets: 'Directory.Build.targets',
  DirectoryBuildProps: 'Directory.Build.props',
  NotFound: 'Not Found',
} as const;

export type TfmSource = ObjectEnumType<typeof TfmSource>;

/**
 * Service responsible for resolving the effective TFM of a project
 */
@singleton()
export class TfmResolver {
  constructor(
    private readonly csprojParser: CsprojParser,
    @injectToken(LOGGER) private readonly logger: ILogger
  ) {}

  /**
   * Resolves the effective TFM for a project
   */
  public resolve(csprojPath: string, buildConfigFiles: BuildConfigFile[]): ResolvedTfm {
    const parsedCsproj = this.csprojParser.parse(csprojPath);

    const projectDir = path.dirname(csprojPath);
    const allMSBuildProps = this.getAllMSBuildProperties(projectDir, buildConfigFiles);

    const csprojTfms = this.csprojParser.getAllTargetFrameworks(parsedCsproj);
    if (csprojTfms.length > 0) {
      const resolvedTfms = csprojTfms.map((tfm) =>
        this.resolveMSBuildProperty(tfm, allMSBuildProps)
      );

      return {
        targetFrameworks: resolvedTfms,
        isMultiTargeting: resolvedTfms.length > 1,
        primaryTargetFramework: resolvedTfms[0],
        source: TfmSource.CsprojFile,
        sdkType: parsedCsproj.sdkType,
        sdk: parsedCsproj.sdk,
      };
    }

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

    return {
      targetFrameworks: [],
      isMultiTargeting: false,
      primaryTargetFramework: 'unknown',
      source: TfmSource.NotFound,
      sdkType: parsedCsproj.sdkType,
      sdk: parsedCsproj.sdk,
    };
  }

  private getAllMSBuildProperties(
    projectDir: string,
    buildConfigFiles: BuildConfigFile[]
  ): Map<string, string> {
    const allProps = new Map<string, string>();

    const propsFile = this.findClosestBuildConfigFile(
      projectDir,
      buildConfigFiles,
      BuildConfigFileType.DirectoryBuildProps
    );
    if (propsFile) {
      const props = propsFile.getAllProperties();
      props.forEach((value, key) => allProps.set(key, value));
    }

    const targetsFile = this.findClosestBuildConfigFile(
      projectDir,
      buildConfigFiles,
      BuildConfigFileType.DirectoryBuildTargets
    );
    if (targetsFile) {
      const props = targetsFile.getAllProperties();
      props.forEach((value, key) => allProps.set(key, value));
    }

    return allProps;
  }

  private findClosestBuildConfigFile(
    projectDir: string,
    buildConfigFiles: BuildConfigFile[],
    type: BuildConfigFileType
  ): BuildConfigFile | null {
    const filesOfType = buildConfigFiles.filter((f) => f.type === type);

    let currentDir = projectDir;

    while (currentDir && currentDir !== path.parse(currentDir).root) {
      const file = filesOfType.find((f) => f.directory === currentDir);
      if (file) {
        return file;
      }

      const parentDir = path.dirname(currentDir);
      if (parentDir === currentDir) { break; }
      currentDir = parentDir;
    }

    const rootFile = filesOfType.find((f) => f.directory === path.parse(projectDir).root);

    return rootFile || null;
  }

  private findTfmInBuildConfig(
    projectDir: string,
    buildConfigFiles: BuildConfigFile[],
    type: BuildConfigFileType
  ): string[] {
    const filesOfType = buildConfigFiles.filter((f) => f.type === type);

    let currentDir = projectDir;

    while (currentDir && currentDir !== path.parse(currentDir).root) {
      const file = filesOfType.find((f) => f.directory === currentDir);
      if (file) {
        return this.extractTfmFromBuildConfig(file);
      }

      const parentDir = path.dirname(currentDir);
      if (parentDir === currentDir) { break; }
      currentDir = parentDir;
    }

    const rootFile = filesOfType.find((f) => f.directory === path.parse(projectDir).root);

    if (rootFile) {
      return this.extractTfmFromBuildConfig(rootFile);
    }

    return [];
  }

  private extractTfmFromBuildConfig(configFile: BuildConfigFile): string[] {
    const allProps = configFile.getAllProperties();

    const targetFrameworks = allProps.get('TargetFrameworks');
    if (targetFrameworks) {
      return targetFrameworks
        .split(';')
        .map((f) => this.resolveMSBuildProperty(f.trim(), allProps))
        .filter(Boolean);
    }

    const targetFramework = allProps.get('TargetFramework');
    if (targetFramework) {
      const resolved = this.resolveMSBuildProperty(targetFramework, allProps);
      return resolved ? [resolved] : [];
    }

    return [];
  }

  private resolveMSBuildProperty(value: string, properties: Map<string, string>): string {
    const propertyRefPattern = /\$\(([^)]+)\)/g;

    let resolved = value;
    let match;
    let iterations = 0;
    const maxIterations = 10;

    while ((match = propertyRefPattern.exec(resolved)) !== null && iterations < maxIterations) {
      const fullMatch = match[0];
      const propertyName = match[1];

      const propertyValue = properties.get(propertyName);
      if (propertyValue) {
        resolved = resolved.replace(fullMatch, propertyValue);
        propertyRefPattern.lastIndex = 0;
      } else {
        break;
      }

      iterations++;
    }

    return resolved;
  }

  /**
   * Resolves TFMs for multiple projects
   */
  public resolveMultiple(
    csprojPaths: string[],
    buildConfigFiles: BuildConfigFile[]
  ): Map<string, ResolvedTfm> {
    const results = new Map<string, ResolvedTfm>();

    for (const csprojPath of csprojPaths) {
      try {
        const resolved = this.resolve(csprojPath, buildConfigFiles);
        results.set(csprojPath, resolved);
      } catch (error) {
        this.logger.Error(`Failed to resolve TFM for ${csprojPath}`, error as Error);
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
