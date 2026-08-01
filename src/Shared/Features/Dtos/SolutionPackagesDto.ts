export type PackageReferenceStyle = "PackageReference" | "CpmManaged" | "PackagesConfig";

export interface PackageInstallationDto {
  projectPath: string;
  projectName: string;
  effectiveTfms: string[];
  installedVersion: string;
  referenceStyle: PackageReferenceStyle;
}

export interface SolutionPackageDto {
  id: string;
  /** nuget.org flat-container URL, derived from the id + installed version */
  iconUrl: string;
  installations: PackageInstallationDto[];
}

/**
 * A project of the solution, independent of any package. Lets the UI offer
 * per-project installation where the package is absent: without this list, only
 * the projects already equipped would show and the ＋ button on the project
 * cards would stay unreachable.
 */
export interface SolutionProjectDto {
  projectPath: string;
  projectName: string;
  effectiveTfms: string[];
  /**
   * The style an installation in this project would take, aligned with
   * `PackageWriteTargetResolver`: `PackagesConfig` for a legacy project (writes out
   * of scope), `CpmManaged` when the solution carries a Directory.Packages.props,
   * otherwise `PackageReference`.
   */
  referenceStyle: PackageReferenceStyle;
}

export interface SolutionPackagesDto {
  packages: SolutionPackageDto[];
  /** Every project of the solution, sorted by name (cf. SolutionProjectDto). */
  projects: SolutionProjectDto[];
  /** Names of private feeds detected but not queried (UI banner) */
  uninterrogatedFeeds: string[];
}
