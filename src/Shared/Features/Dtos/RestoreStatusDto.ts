export type RestoreState = "Idle" | "Running" | "Succeeded" | "Failed";

export interface RestoreStatusDto {
  status: RestoreState;
  messages: string[];
  runId: number;
  finishedAtUtc?: string;
}
