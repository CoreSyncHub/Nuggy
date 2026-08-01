import { type SkippedTargetDto } from "./PackageWriteResultDto";

export interface RestoreRunEntryDto {
  kind: "restore";
  runId: number;
  solutionPath: string;
  startedUtc: string;
  finishedUtc?: string;
  status: "Running" | "Succeeded" | "Failed";
  exitCode?: number;
  /** Full dotnet restore output, capped at 500 lines (+ a truncation line). */
  output: string[];
  /** `dotnet nuget why` blocks produced by the enrichment (RestoreScheduler). */
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
  skipped: SkippedTargetDto[];
  error?: string;
}

export type OperationLogEntryDto = RestoreRunEntryDto | WriteOperationEntryDto;

export interface OperationLogDto {
  entries: OperationLogEntryDto[];
}
