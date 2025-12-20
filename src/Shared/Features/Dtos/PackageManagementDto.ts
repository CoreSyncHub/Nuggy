/**
 * Package management mode
 */
export type PackageManagementMode = 'Central' | 'Local' | 'Mixed' | 'Unknown';

/**
 * Package diagnostic severity
 */
export type PackageDiagnosticSeverity = 'Error' | 'Warning' | 'Info';

/**
 * Package source type
 */
export type PackageSourceType = 'CPM' | 'Local' | 'Legacy';

/**
 * DTO for a package version (from Directory.Packages.props)
 */
export interface PackageVersionDto {
  /** Package name */
  name: string;

  /** Package version */
  version: string | undefined;

  /** Path to the Directory.Packages.props file */
  sourcePath: string;

  /** Projects that use this package */
  affectedProjects: string[];
}

/**
 * DTO for a package reference (from .csproj)
 */
export interface PackageReferenceDto {
  /** Package name */
  name: string;

  /** Package version (if specified locally) */
  version: string | undefined;

  /** Project path */
  projectPath: string;

  /** Whether the package has a local version */
  hasLocalVersion: boolean;
}

/**
 * DTO for a legacy package (from packages.config)
 */
export interface LegacyPackageDto {
  /** Package name */
  name: string;

  /** Package version */
  version: string | undefined;

  /** Project path */
  projectPath: string;

  /** Path to packages.config */
  configPath: string;

  /** Target framework (if specified) */
  targetFramework?: string;
}

/**
 * DTO for a package diagnostic message
 */
export interface PackageDiagnosticDto {
  /** Severity level */
  severity: PackageDiagnosticSeverity;

  /** Diagnostic message */
  message: string;

  /** Package name */
  packageName: string;

  /** Project path (if applicable) */
  projectPath?: string;

  /** File path (if applicable) */
  filePath?: string;
}

/**
 * Summary of project types in the solution
 */
export interface ProjectTypeSummaryDto {
  /** Number of legacy .NET Framework projects (packages.config) */
  legacyFrameworkProjects: number;

  /** Number of SDK-style projects (.NET Core/.NET) */
  sdkStyleProjects: number;

  /** Number of SDK-style projects using CPM */
  cpmEnabledProjects: number;
}

/**
 * DTO for package management diagnostic result
 */
export interface PackageManagementDiagnosticDto {
  /** Whether CPM is enabled */
  isCpmEnabled: boolean;

  /** Package management mode */
  mode: PackageManagementMode;

  /** Indicates if this is a transitional solution (.NET Framework + .NET Core coexistence) */
  isTransitional: boolean;

  /** Summary of project types in the solution */
  projectTypeSummary: ProjectTypeSummaryDto;

  /** Path to Directory.Packages.props (if exists) */
  cpmFilePath?: string;

  /** All package versions from Directory.Packages.props */
  packageVersions: PackageVersionDto[];

  /** All package references grouped by project */
  packageReferencesByProject: Record<string, PackageReferenceDto[]>;

  /** All legacy packages grouped by project */
  legacyPackagesByProject: Record<string, LegacyPackageDto[]>;

  /** Diagnostics (warnings, errors) */
  diagnostics: PackageDiagnosticDto[];

  /** Summary statistics */
  summary: {
    /** Total number of centrally managed packages */
    totalCentralPackages: number;

    /** Total number of projects analyzed */
    totalProjects: number;

    /** Total number of legacy projects */
    totalLegacyProjects: number;

    /** Number of diagnostics by severity */
    diagnosticsBySeverity: {
      errors: number;
      warnings: number;
      infos: number;
    };
  };
}
