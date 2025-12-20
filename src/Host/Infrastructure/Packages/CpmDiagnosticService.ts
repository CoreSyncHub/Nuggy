import * as path from 'path';
import { PackageVersion } from '../../Domain/Packages/Entities/PackageVersion';
import { PackageReference } from '../../Domain/Packages/Entities/PackageReference';
import { PackageDiagnostic } from '../../Domain/Packages/Entities/PackageDiagnostic';
import { PackageManagementMode } from '../../Domain/Packages/Enums/PackageManagementMode';
import { BuildConfigFile } from '../../Domain/Build/Entities/BuildConfigFile';
import { BuildConfigFileType } from '../../Domain/Build/Enums/BuildConfigFileType';
import { PackageVersionParser } from './PackageVersionParser';

/**
 * Result of CPM diagnostic analysis
 */
export interface CpmDiagnosticResult {
  /** Whether CPM is enabled */
  isCpmEnabled: boolean;

  /** The mode of package management */
  mode: PackageManagementMode;

  /** All package versions defined in Directory.Packages.props */
  packageVersions: PackageVersion[];

  /** All package references from projects */
  packageReferences: Map<string, PackageReference[]>;

  /** Diagnostics found during analysis */
  diagnostics: PackageDiagnostic[];

  /** Path to the Directory.Packages.props file (if exists) */
  cpmFilePath?: string;
}

/**
 * Service for diagnosing CPM (Central Package Management) configuration
 */
export class CpmDiagnosticService {
  /**
   * Analyzes CPM configuration and detects anomalies
   */
  public static analyze(
    buildConfigFiles: BuildConfigFile[],
    packageReferences: Map<string, PackageReference[]>
  ): CpmDiagnosticResult {
    const diagnostics: PackageDiagnostic[] = [];

    // 1. Get all CPM files
    const cpmFiles = buildConfigFiles.filter(
      (f) => f.type === BuildConfigFileType.DirectoryPackagesProps
    );
    const isCpmEnabled = cpmFiles.length > 0;

    // 2. For each project, find the closest CPM file and parse it
    const allPackageVersions: PackageVersion[] = [];
    const cpmFilesByPath = new Map<string, BuildConfigFile>();

    for (const cpmFile of cpmFiles) {
      cpmFilesByPath.set(cpmFile.path, cpmFile);
    }

    // Parse all CPM files and extract PackageVersions
    for (const cpmFile of cpmFiles) {
      const versions = this.parsePackageVersions(cpmFile.path);
      allPackageVersions.push(...versions);
    }

    // 3. Determine management mode
    const mode = this.determineManagementMode(isCpmEnabled, packageReferences);

    // 4. Detect version conflicts (considering hierarchy)
    if (isCpmEnabled) {
      const conflicts = this.detectVersionConflictsWithHierarchy(
        buildConfigFiles,
        packageReferences
      );
      diagnostics.push(...conflicts);
    }

    // 5. Map package versions to affected projects (considering hierarchy)
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

  /**
   * Determines the package management mode based on the configuration
   */
  private static determineManagementMode(
    isCpmEnabled: boolean,
    packageReferences: Map<string, PackageReference[]>
  ): PackageManagementMode {
    if (!isCpmEnabled) {
      return PackageManagementMode.Local;
    }

    // Check if any packages have local versions
    let hasLocalVersions = false;
    let hasPackagesWithoutLocalVersions = false;

    for (const references of packageReferences.values()) {
      for (const ref of references) {
        if (ref.hasLocalVersion) {
          hasLocalVersions = true;
        } else {
          hasPackagesWithoutLocalVersions = true;
        }
      }
    }

    if (hasLocalVersions && hasPackagesWithoutLocalVersions) {
      return PackageManagementMode.Mixed;
    } else if (hasLocalVersions) {
      // CPM enabled but all packages have local versions - unusual
      return PackageManagementMode.Mixed;
    } else {
      return PackageManagementMode.Central;
    }
  }

  /**
   * Detects version conflicts (packages with local versions when CPM is enabled)
   */
  private static detectVersionConflicts(
    packageVersions: PackageVersion[],
    packageReferences: Map<string, PackageReference[]>
  ): PackageDiagnostic[] {
    const diagnostics: PackageDiagnostic[] = [];
    const centralPackageNames = new Set(packageVersions.map((pv) => pv.name));

    for (const [projectPath, references] of packageReferences) {
      for (const ref of references) {
        // Check if package has a local version
        if (ref.hasLocalVersion) {
          // Check if it's also centrally managed
          if (centralPackageNames.has(ref.name)) {
            diagnostics.push(
              PackageDiagnostic.warning(
                `Package '${ref.name}' has a local version '${ref.version}' but is centrally managed. Remove the Version attribute from the PackageReference.`,
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

  /**
   * Maps package versions to projects that reference them
   */
  private static mapPackageVersionsToProjects(
    packageVersions: PackageVersion[],
    packageReferences: Map<string, PackageReference[]>,
    cpmFile: BuildConfigFile
  ): void {
    // Get all projects affected by the CPM file
    const affectedProjects = cpmFile.affectedProjects;

    for (const packageVersion of packageVersions) {
      // Find all projects that reference this package
      for (const [projectPath, references] of packageReferences) {
        // Only consider projects affected by this CPM file
        if (!affectedProjects.includes(projectPath)) {
          continue;
        }

        // Check if this project references this package
        const hasReference = references.some((ref) => ref.name === packageVersion.name);
        if (hasReference) {
          packageVersion.addAffectedProject(projectPath);
        }
      }
    }
  }

  /**
   * Parses PackageVersion entries from a Directory.Packages.props file
   */
  private static parsePackageVersions(filePath: string): PackageVersion[] {
    return PackageVersionParser.parse(filePath);
  }

  /**
   * Finds the closest Directory.Packages.props file affecting a project
   */
  private static findClosestCpmFile(
    projectPath: string,
    buildConfigFiles: BuildConfigFile[]
  ): BuildConfigFile | null {
    const cpmFiles = buildConfigFiles.filter(
      (f) => f.type === BuildConfigFileType.DirectoryPackagesProps
    );

    const projectDir = path.dirname(projectPath);
    let currentDir = projectDir;

    // Search up the directory tree for the closest CPM file
    while (currentDir && currentDir !== path.parse(currentDir).root) {
      const cpmFile = cpmFiles.find((f) => f.directory === currentDir);
      if (cpmFile) {
        return cpmFile;
      }
      currentDir = path.dirname(currentDir);
    }

    // Check root directory
    const rootCpmFile = cpmFiles.find((f) => f.directory === path.parse(projectDir).root);
    return rootCpmFile || null;
  }

  /**
   * Detects version conflicts considering hierarchical Directory.Packages.props
   */
  private static detectVersionConflictsWithHierarchy(
    buildConfigFiles: BuildConfigFile[],
    packageReferences: Map<string, PackageReference[]>
  ): PackageDiagnostic[] {
    const diagnostics: PackageDiagnostic[] = [];

    for (const [projectPath, references] of packageReferences) {
      // Find the closest CPM file for this project
      const cpmFile = this.findClosestCpmFile(projectPath, buildConfigFiles);

      if (!cpmFile) {
        continue;
      }

      // Parse the CPM file to get centrally managed packages
      const packageVersions = PackageVersionParser.parse(cpmFile.path);
      const centralPackageNames = new Set(packageVersions.map((pv) => pv.name));

      // Check for conflicts in this project
      for (const ref of references) {
        if (ref.hasLocalVersion && centralPackageNames.has(ref.name)) {
          diagnostics.push(
            PackageDiagnostic.warning(
              `Package '${ref.name}' has a local version '${ref.version}' but is centrally managed in '${cpmFile.path}'. Remove the Version attribute from the PackageReference.`,
              ref.name,
              projectPath,
              projectPath
            )
          );
        }
      }
    }

    return diagnostics;
  }

  /**
   * Maps package versions to projects considering hierarchical Directory.Packages.props
   */
  private static mapPackageVersionsToProjectsWithHierarchy(
    allPackageVersions: PackageVersion[],
    packageReferences: Map<string, PackageReference[]>,
    buildConfigFiles: BuildConfigFile[]
  ): void {
    for (const [projectPath, references] of packageReferences) {
      // Find the closest CPM file for this project
      const cpmFile = this.findClosestCpmFile(projectPath, buildConfigFiles);

      if (!cpmFile) {
        continue;
      }

      // Find package versions from this specific CPM file
      const relevantPackageVersions = allPackageVersions.filter(
        (pv) => pv.sourcePath === cpmFile.path
      );

      // Map references to package versions
      for (const ref of references) {
        const packageVersion = relevantPackageVersions.find((pv) => pv.name === ref.name);
        if (packageVersion) {
          packageVersion.addAffectedProject(projectPath);
        }
      }
    }
  }
}
