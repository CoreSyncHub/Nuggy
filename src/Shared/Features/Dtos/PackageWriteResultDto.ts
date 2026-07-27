export interface SkippedProjectDto {
  projectPath: string;
  reason: string;
}

export interface PackageWriteResultDto {
  status: "Ok" | "Error";
  filesChanged: string[];
  affectedProjects: string[];
  skipped: SkippedProjectDto[];
  error?: string;
}
