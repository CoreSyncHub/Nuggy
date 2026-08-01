import { singleton } from "tsyringe";
import {
  type OperationLogEntryDto,
  type RestoreRunEntryDto,
  type WriteOperationEntryDto,
} from "@Shared/Features/Dtos/OperationLogDto";

const MAX_ENTRIES = 50;
const MAX_OUTPUT_LINES = 500;

/**
 * In-memory session journal: restore runs plus write operations.
 * Bounded buffer (50 FIFO entries), zero I/O, zero persistence, never throws.
 * Internal order is arrival order; `getEntries` serves it newest-first.
 */
@singleton()
export class OperationLogStore {
  private readonly entries: OperationLogEntryDto[] = [];

  /** Creates the `Running` entry for the run — called by RestoreScheduler.fire() at launch. */
  public recordRestoreStart(runId: number, solutionPath: string): void {
    this.push({
      kind: "restore",
      runId,
      solutionPath,
      startedUtc: new Date().toISOString(),
      status: "Running",
      output: [],
      whyInsights: [],
    });
  }

  /** Completes the run entry. Unknown runId (entry evicted by the FIFO) → no-op. */
  public completeRestore(
    runId: number,
    result: {
      status: "Succeeded" | "Failed";
      exitCode?: number;
      output: string[];
      whyInsights: string[];
    },
  ): void {
    const entry = this.entries.find(
      (e): e is RestoreRunEntryDto => e.kind === "restore" && e.runId === runId,
    );
    if (!entry) {
      return;
    }
    entry.finishedUtc = new Date().toISOString();
    entry.status = result.status;
    entry.exitCode = result.exitCode;
    entry.output = this.capOutput(result.output);
    entry.whyInsights = [...result.whyInsights];
  }

  public recordWrite(entry: Omit<WriteOperationEntryDto, "kind" | "timestampUtc">): void {
    this.push({
      kind: "write",
      timestampUtc: new Date().toISOString(),
      operation: entry.operation,
      packageId: entry.packageId,
      version: entry.version,
      status: entry.status,
      affectedProjects: [...entry.affectedProjects],
      filesChanged: [...entry.filesChanged],
      skipped: entry.skipped.map((s) => ({ ...s })),
      error: entry.error,
    });
  }

  /** Newest-first copy. */
  public getEntries(): OperationLogEntryDto[] {
    return [...this.entries].reverse().map((e) =>
      e.kind === "restore"
        ? {
            ...e,
            output: [...e.output],
            whyInsights: [...e.whyInsights],
          }
        : {
            ...e,
            affectedProjects: [...e.affectedProjects],
            filesChanged: [...e.filesChanged],
            skipped: e.skipped.map((s) => ({ ...s })),
          },
    );
  }

  private push(entry: OperationLogEntryDto): void {
    this.entries.push(entry);
    if (this.entries.length > MAX_ENTRIES) {
      this.entries.shift();
    }
  }

  private capOutput(output: string[]): string[] {
    if (output.length <= MAX_OUTPUT_LINES) {
      return [...output];
    }
    return [
      ...output.slice(0, MAX_OUTPUT_LINES),
      `… output truncated (${output.length} lines in total)`,
    ];
  }
}
