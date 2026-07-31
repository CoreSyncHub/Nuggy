/** Une cible qu'une écriture a laissée de côté, et pourquoi. */
export interface SkippedTargetDto {
  /**
   * Le projet concerné — ou le `Directory.Packages.props` lorsque l'échec porte
   * sur la version centrale, qui n'appartient à aucun projet en particulier.
   * Le champ s'appelait `projectPath` et mentait donc dans ce second cas.
   */
  path: string;
  reason: string;
}

export interface PackageWriteResultDto {
  status: "Ok" | "Error";
  filesChanged: string[];
  affectedProjects: string[];
  skipped: SkippedTargetDto[];
  error?: string;
}
