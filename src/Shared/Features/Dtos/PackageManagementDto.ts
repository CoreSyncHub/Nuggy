/**
 * Package management mode
 */
export type PackageManagementMode = 'Central' | 'Local' | 'Mixed' | 'Unknown';

/**
 * Package diagnostic severity
 */
export type PackageDiagnosticSeverity = 'Error' | 'Warning' | 'Info';

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
 * DTO for package management diagnostic result
 */
export interface PackageManagementDiagnosticDto {
  /** Whether CPM is enabled */
  isCpmEnabled: boolean;

  /** Package management mode */
  mode: PackageManagementMode;

  /** Path to Directory.Packages.props (if exists) */
  cpmFilePath?: string;

  /** All package versions from Directory.Packages.props */
  packageVersions: PackageVersionDto[];

  /** All package references grouped by project */
  packageReferencesByProject: Record<string, PackageReferenceDto[]>;

  /** Diagnostics (warnings, errors) */
  diagnostics: PackageDiagnosticDto[];

  /** Summary statistics */
  summary: {
    /** Total number of centrally managed packages */
    totalCentralPackages: number;

    /** Total number of projects analyzed */
    totalProjects: number;

    /** Number of diagnostics by severity */
    diagnosticsBySeverity: {
      errors: number;
      warnings: number;
      infos: number;
    };
  };
}
