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
  /** URL flat-container nuget.org, déduite de l'id + version installée */
  iconUrl: string;
  installations: PackageInstallationDto[];
}

export interface SolutionPackagesDto {
  packages: SolutionPackageDto[];
  /** Noms des feeds privés détectés mais non interrogés (bandeau UI) */
  uninterrogatedFeeds: string[];
}
