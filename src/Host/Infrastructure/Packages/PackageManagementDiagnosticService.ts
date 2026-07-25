import { singleton } from "tsyringe";
import { type PackageVersion } from "../../Domain/Packages/Entities/PackageVersion";
import { type PackageReference } from "../../Domain/Packages/Entities/PackageReference";
import { type LegacyPackage } from "../../Domain/Packages/Entities/LegacyPackage";
import { PackageDiagnostic } from "../../Domain/Packages/Entities/PackageDiagnostic";
import { PackageManagementMode } from "../../Domain/Packages/Enums/PackageManagementMode";
import { type BuildConfigFile } from "../../Domain/Build/Entities/BuildConfigFile";
import { CpmDiagnosticService } from "./CpmDiagnosticService";

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
@singleton()
export class PackageManagementDiagnosticService {
  constructor(private readonly cpmDiagnosticService: CpmDiagnosticService) {}

  /**
   * Analyzes package management configuration across all project types
   */
  public analyze(
    buildConfigFiles: BuildConfigFile[],
    packageReferences: Map<string, PackageReference[]>,
    legacyPackages: Map<string, LegacyPackage[]>,
  ): PackageManagementDiagnosticResult {
    const cpmResult = this.cpmDiagnosticService.analyze(buildConfigFiles, packageReferences);

    const projectTypeSummary = this.calculateProjectTypeSummary(
      packageReferences,
      legacyPackages,
      cpmResult.isCpmEnabled,
    );

    const isTransitional = this.isTransitionalSolution(projectTypeSummary);

    const diagnostics = [...cpmResult.diagnostics];
    if (isTransitional) {
      diagnostics.push(this.createTransitionalSolutionInfo(projectTypeSummary));
    }

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

  private calculateProjectTypeSummary(
    packageReferences: Map<string, PackageReference[]>,
    legacyPackages: Map<string, LegacyPackage[]>,
    isCpmEnabled: boolean,
  ): ProjectTypeSummary {
    const legacyFrameworkProjects = legacyPackages.size;
    const sdkStyleProjects = packageReferences.size;

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

  private isTransitionalSolution(summary: ProjectTypeSummary): boolean {
    return summary.legacyFrameworkProjects > 0 && summary.sdkStyleProjects > 0;
  }

  private createTransitionalSolutionInfo(summary: ProjectTypeSummary): PackageDiagnostic {
    const message =
      `This solution contains both legacy .NET Framework projects (${summary.legacyFrameworkProjects} project${summary.legacyFrameworkProjects > 1 ? "s" : ""} with packages.config) ` +
      `and modern SDK-style projects (${summary.sdkStyleProjects} project${summary.sdkStyleProjects > 1 ? "s" : ""} with PackageReference). ` +
      `This is typical of a progressive migration from .NET Framework to .NET Core/.NET.`;

    return PackageDiagnostic.info(message, "", undefined, undefined);
  }

  private determineOverallMode(
    sdkStyleMode: PackageManagementMode,
    packageReferences: Map<string, PackageReference[]>,
    legacyPackages: Map<string, LegacyPackage[]>,
  ): PackageManagementMode {
    const hasLegacyProjects = legacyPackages.size > 0;
    const hasSdkStyleProjects = packageReferences.size > 0;

    if (hasLegacyProjects && hasSdkStyleProjects) {
      return PackageManagementMode.Mixed;
    }

    if (hasLegacyProjects && !hasSdkStyleProjects) {
      return PackageManagementMode.Local;
    }

    return sdkStyleMode;
  }
}
