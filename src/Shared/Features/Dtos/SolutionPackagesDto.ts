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

/**
 * Projet de la solution, indépendamment de tout package. Permet à l'UI de
 * proposer l'installation par projet là où le package est absent : sans cette
 * liste, seuls les projets déjà équipés seraient affichés et le bouton ＋ des
 * cartes projet resterait inatteignable.
 */
export interface SolutionProjectDto {
  projectPath: string;
  projectName: string;
  effectiveTfms: string[];
  /**
   * Style qu'aurait une installation dans ce projet, aligné sur
   * `PackageWriteTargetResolver` : `PackagesConfig` pour un projet legacy
   * (écritures hors périmètre), `CpmManaged` si la solution porte un
   * Directory.Packages.props, sinon `PackageReference`.
   */
  referenceStyle: PackageReferenceStyle;
}

export interface SolutionPackagesDto {
  packages: SolutionPackageDto[];
  /** Tous les projets de la solution, triés par nom (cf. SolutionProjectDto). */
  projects: SolutionProjectDto[];
  /** Noms des feeds privés détectés mais non interrogés (bandeau UI) */
  uninterrogatedFeeds: string[];
}
