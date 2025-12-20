import { PackageVersion } from '../../Domain/Packages/Entities/PackageVersion';
import { PackageReference } from '../../Domain/Packages/Entities/PackageReference';
import { LegacyPackage } from '../../Domain/Packages/Entities/LegacyPackage';
import { PackageDiagnostic } from '../../Domain/Packages/Entities/PackageDiagnostic';
import { PackageManagementMode } from '../../Domain/Packages/Enums/PackageManagementMode';
import { BuildConfigFile } from '../../Domain/Build/Entities/BuildConfigFile';
import { CpmDiagnosticService } from './CpmDiagnosticService';

/**
 * Summary of project types in the solution
 */
export interface ProjectTypeSummary {
  /** Number of legacy .NET Framework projects (packages.config) */
  legacyFrameworkProjects: number;

  /** Number of SDK-style projects (.NET Core/.NET) */
  sdkStyleProjects: number;

  /** Number of SDK-style projects using CPM */
  cpmEnabledProjects: number;
}

/**
 * Result of package management diagnostic analysis
 */
export interface PackageManagementDiagnosticResult {
  /** Whether CPM is enabled (SDK-style projects only) */
  isCpmEnabled: boolean;

  /** The mode of package management */
  mode: PackageManagementMode;

  /** Indicates if this is a transitional solution (.NET Framework + .NET Core coexistence) */
  isTransitional: boolean;

  /** Summary of project types in the solution */
  projectTypeSummary: ProjectTypeSummary;

  /** All package versions defined in Directory.Packages.props (SDK-style only) */
  packageVersions: PackageVersion[];

  /** All package references from SDK-style projects */
  packageReferences: Map<string, PackageReference[]>;

  /** All legacy packages from packages.config files (Legacy projects only) */
  legacyPackages: Map<string, LegacyPackage[]>;

  /** Diagnostics found during analysis */
  diagnostics: PackageDiagnostic[];

  /** Path to the Directory.Packages.props file (if exists) */
  cpmFilePath?: string;
}

/**
 * Service for analyzing all package management modes:
 * - SDK-style projects with CPM (Central Package Management)
 * - SDK-style projects with local PackageReference
 * - Legacy projects with packages.config
 */
export class PackageManagementDiagnosticService {
  /**
   * Analyzes package management configuration across all project types
   */
  public static analyze(
    buildConfigFiles: BuildConfigFile[],
    packageReferences: Map<string, PackageReference[]>,
    legacyPackages: Map<string, LegacyPackage[]>
  ): PackageManagementDiagnosticResult {
    // Analyze SDK-style projects (CPM + PackageReference)
    const cpmResult = CpmDiagnosticService.analyze(buildConfigFiles, packageReferences);

    // Calculate project type summary
    const projectTypeSummary = this.calculateProjectTypeSummary(
      packageReferences,
      legacyPackages,
      cpmResult.isCpmEnabled
    );

    // Detect if this is a transitional solution
    const isTransitional = this.isTransitionalSolution(projectTypeSummary);

    // Combine diagnostics from CPM analysis and transitional info
    const diagnostics = [...cpmResult.diagnostics];
    if (isTransitional) {
      diagnostics.push(this.createTransitionalSolutionInfo(projectTypeSummary));
    }

    // Combine results from both SDK-style and legacy projects
    return {
      isCpmEnabled: cpmResult.isCpmEnabled,
      mode: this.determineOverallMode(cpmResult.mode, packageReferences, legacyPackages),
      isTransitional,
      projectTypeSummary,
      packageVersions: cpmResult.packageVersions,
      packageReferences: cpmResult.packageReferences,
      legacyPackages,
      diagnostics,
      cpmFilePath: cpmResult.cpmFilePath,
    };
  }

  /**
   * Calculates project type summary
   */
  private static calculateProjectTypeSummary(
    packageReferences: Map<string, PackageReference[]>,
    legacyPackages: Map<string, LegacyPackage[]>,
    isCpmEnabled: boolean
  ): ProjectTypeSummary {
    const legacyFrameworkProjects = legacyPackages.size;
    const sdkStyleProjects = packageReferences.size;

    // Count how many SDK-style projects are using CPM
    // If CPM is enabled, we assume all SDK-style projects without local versions are using it
    let cpmEnabledProjects = 0;
    if (isCpmEnabled) {
      for (const references of packageReferences.values()) {
        const hasOnlyNonLocalVersions = references.every((ref) => !ref.hasLocalVersion);
        if (hasOnlyNonLocalVersions) {
          cpmEnabledProjects++;
        }
      }
    }

    return {
      legacyFrameworkProjects,
      sdkStyleProjects,
      cpmEnabledProjects,
    };
  }

  /**
   * Determines if this is a transitional solution (.NET Framework + .NET Core coexistence)
   */
  private static isTransitionalSolution(summary: ProjectTypeSummary): boolean {
    return summary.legacyFrameworkProjects > 0 && summary.sdkStyleProjects > 0;
  }

  /**
   * Creates an informational diagnostic for transitional solutions
   */
  private static createTransitionalSolutionInfo(summary: ProjectTypeSummary): PackageDiagnostic {
    const message =
      `This solution contains both legacy .NET Framework projects (${summary.legacyFrameworkProjects} project${summary.legacyFrameworkProjects > 1 ? 's' : ''} with packages.config) ` +
      `and modern SDK-style projects (${summary.sdkStyleProjects} project${summary.sdkStyleProjects > 1 ? 's' : ''} with PackageReference). ` +
      `This is typical of a progressive migration from .NET Framework to .NET Core/.NET.`;

    return PackageDiagnostic.info(message, '', undefined, undefined);
  }

  /**
   * Determines the overall package management mode considering both SDK-style and legacy projects
   */
  private static determineOverallMode(
    sdkStyleMode: PackageManagementMode,
    packageReferences: Map<string, PackageReference[]>,
    legacyPackages: Map<string, LegacyPackage[]>
  ): PackageManagementMode {
    const hasLegacyProjects = legacyPackages.size > 0;
    const hasSdkStyleProjects = packageReferences.size > 0;

    // If we have both SDK-style and legacy projects, it's always mixed (transitional)
    if (hasLegacyProjects && hasSdkStyleProjects) {
      return PackageManagementMode.Mixed;
    }

    // If only legacy projects exist
    if (hasLegacyProjects && !hasSdkStyleProjects) {
      return PackageManagementMode.Local; // Legacy is considered "Local" mode
    }

    // Otherwise, use the SDK-style mode (Central, Local, or Mixed from SDK-style analysis)
    return sdkStyleMode;
  }
}
