/** A target a write left aside, and why. */
export interface SkippedTargetDto {
  /**
   * The project concerned — or the `Directory.Packages.props` when the failure is
   * about the central version, which belongs to no project in particular.
   * The field used to be called `projectPath` and therefore lied in that second case.
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
