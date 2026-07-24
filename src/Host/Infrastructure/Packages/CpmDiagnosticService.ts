import * as path from 'path';
import { singleton } from 'tsyringe';
import { PackageVersion } from '../../Domain/Packages/Entities/PackageVersion';
import { PackageReference } from '../../Domain/Packages/Entities/PackageReference';
import { PackageDiagnostic } from '../../Domain/Packages/Entities/PackageDiagnostic';
import { PackageManagementMode } from '../../Domain/Packages/Enums/PackageManagementMode';
import { BuildConfigFile } from '../../Domain/Build/Entities/BuildConfigFile';
import { BuildConfigFileType } from '../../Domain/Build/Enums/BuildConfigFileType';
import { PackageVersionParser } from './PackageVersionParser';

/**
 * Result of CPM diagnostic analysis for SDK-style projects only
 */
export interface CpmDiagnosticResult {
  /** Whether CPM is enabled */
  isCpmEnabled: boolean;

  /** The mode of package management (for SDK-style projects only) */
  mode: PackageManagementMode;

  /** All package versions defined in Directory.Packages.props */
  packageVersions: PackageVersion[];

  /** All package references from SDK-style projects */
  packageReferences: Map<string, PackageReference[]>;

  /** Diagnostics found during analysis */
  diagnostics: PackageDiagnostic[];

  /** Path to the Directory.Packages.props file (if exists) */
  cpmFilePath?: string;
}

/**
 * Service for diagnosing CPM (Central Package Management) configuration
 */
@singleton()
export class CpmDiagnosticService {
  constructor(private readonly packageVersionParser: PackageVersionParser) {}

  /**
   * Analyzes CPM configuration and detects anomalies for SDK-style projects
   */
  public analyze(
    buildConfigFiles: BuildConfigFile[],
    packageReferences: Map<string, PackageReference[]>
  ): CpmDiagnosticResult {
    const diagnostics: PackageDiagnostic[] = [];

    const cpmFiles = buildConfigFiles.filter(
      (f) => f.type === BuildConfigFileType.DirectoryPackagesProps
    );
    const isCpmEnabled = cpmFiles.length > 0;

    const allPackageVersions: PackageVersion[] = [];

    for (const cpmFile of cpmFiles) {
      const versions = this.parsePackageVersions(cpmFile.path);
      allPackageVersions.push(...versions);
    }

    const mode = this.determineManagementMode(isCpmEnabled);

    if (isCpmEnabled) {
      const conflicts = this.detectVersionConflictsWithHierarchy(
        buildConfigFiles,
        packageReferences
      );
      diagnostics.push(...conflicts);
    }

    if (isCpmEnabled) {
      this.mapPackageVersionsToProjectsWithHierarchy(
        allPackageVersions,
        packageReferences,
        buildConfigFiles
      );
    }

    return {
      isCpmEnabled,
      mode,
      packageVersions: allPackageVersions,
      packageReferences,
      diagnostics,
      cpmFilePath: cpmFiles.length > 0 ? cpmFiles[0].path : undefined,
    };
  }

  private determineManagementMode(isCpmEnabled: boolean): PackageManagementMode {
    if (isCpmEnabled) {
      return PackageManagementMode.Central;
    }

    return PackageManagementMode.Local;
  }

  private parsePackageVersions(filePath: string): PackageVersion[] {
    return this.packageVersionParser.parse(filePath);
  }

  private findClosestCpmFile(
    projectPath: string,
    buildConfigFiles: BuildConfigFile[]
  ): BuildConfigFile | null {
    const cpmFiles = buildConfigFiles.filter(
      (f) => f.type === BuildConfigFileType.DirectoryPackagesProps
    );

    const projectDir = path.dirname(projectPath);
    let currentDir = projectDir;

    while (currentDir && currentDir !== path.parse(currentDir).root) {
      const cpmFile = cpmFiles.find((f) => f.directory === currentDir);
      if (cpmFile) {
        return cpmFile;
      }
      const parentDir = path.dirname(currentDir);
      if (parentDir === currentDir) { break; }
      currentDir = parentDir;
    }

    const rootCpmFile = cpmFiles.find((f) => f.directory === path.parse(projectDir).root);
    return rootCpmFile || null;
  }

  private detectVersionConflictsWithHierarchy(
    buildConfigFiles: BuildConfigFile[],
    packageReferences: Map<string, PackageReference[]>
  ): PackageDiagnostic[] {
    const diagnostics: PackageDiagnostic[] = [];

    for (const [projectPath, references] of packageReferences) {
      const cpmFile = this.findClosestCpmFile(projectPath, buildConfigFiles);

      if (!cpmFile) {
        continue;
      }

      const packageVersions = this.packageVersionParser.parse(cpmFile.path);
      const centralPackageNames = new Set(packageVersions.map((pv) => pv.name));

      for (const ref of references) {
        if (ref.hasLocalVersion) {
          if (centralPackageNames.has(ref.name)) {
            diagnostics.push(
              PackageDiagnostic.warning(
                `Package '${ref.name}' has a local version '${ref.version}' but is centrally managed in '${cpmFile.path}'. Remove the Version attribute from the PackageReference.`,
                ref.name,
                projectPath,
                projectPath
              )
            );
          } else {
            diagnostics.push(
              PackageDiagnostic.warning(
                `Package '${ref.name}' has a local version '${ref.version}' but Central Package Management is enabled. Add this package to '${cpmFile.path}' and remove the Version attribute from the PackageReference.`,
                ref.name,
                projectPath,
                projectPath
              )
            );
          }
        }
      }
    }

    return diagnostics;
  }

  private mapPackageVersionsToProjectsWithHierarchy(
    allPackageVersions: PackageVersion[],
    packageReferences: Map<string, PackageReference[]>,
    buildConfigFiles: BuildConfigFile[]
  ): void {
    for (const [projectPath, references] of packageReferences) {
      const cpmFile = this.findClosestCpmFile(projectPath, buildConfigFiles);

      if (!cpmFile) {
        continue;
      }

      const relevantPackageVersions = allPackageVersions.filter(
        (pv) => pv.sourcePath === cpmFile.path
      );

      for (const ref of references) {
        const packageVersion = relevantPackageVersions.find((pv) => pv.name === ref.name);
        if (packageVersion) {
          packageVersion.addAffectedProject(projectPath);
        }
      }
    }
  }
}
