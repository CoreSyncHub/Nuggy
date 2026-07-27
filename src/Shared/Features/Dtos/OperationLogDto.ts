import { type SkippedProjectDto } from "./PackageWriteResultDto";

export interface RestoreRunEntryDto {
  kind: "restore";
  runId: number;
  solutionPath: string;
  startedUtc: string;
  finishedUtc?: string;
  status: "Running" | "Succeeded" | "Failed";
  exitCode?: number;
  /** Sortie complète de dotnet restore, plafonnée à 500 lignes (+ ligne de troncature). */
  output: string[];
  /** Blocs `dotnet nuget why` produits par l'enrichissement (RestoreScheduler). */
  whyInsights: string[];
}

export interface WriteOperationEntryDto {
  kind: "write";
  timestampUtc: string;
  operation: "install" | "upgrade" | "uninstall";
  packageId: string;
  version?: string;
  status: "Ok" | "Error";
  affectedProjects: string[];
  filesChanged: string[];
  skipped: SkippedProjectDto[];
  error?: string;
}

export type OperationLogEntryDto = RestoreRunEntryDto | WriteOperationEntryDto;

export interface OperationLogDto {
  entries: OperationLogEntryDto[];
}
