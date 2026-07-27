import { singleton } from "tsyringe";
import {
  type OperationLogEntryDto,
  type RestoreRunEntryDto,
  type WriteOperationEntryDto,
} from "@Shared/Features/Dtos/OperationLogDto";

const MAX_ENTRIES = 50;
const MAX_OUTPUT_LINES = 500;

/**
 * Journal mémoire de session : runs de restore + opérations d'écriture.
 * Tampon borné (50 entrées FIFO), zéro I/O, zéro persistance, ne jette jamais.
 * L'ordre interne est l'ordre d'arrivée ; `getEntries` sert l'anté-chronologique.
 */
@singleton()
export class OperationLogStore {
  private readonly entries: OperationLogEntryDto[] = [];

  /** Crée l'entrée `Running` du run — appelé par RestoreScheduler.fire() au lancement. */
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

  /** Complète l'entrée du run. runId inconnu (entrée éjectée par le FIFO) → no-op. */
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

  /** Copie anté-chronologique (la plus récente d'abord). */
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
      `… sortie tronquée (${output.length} lignes au total)`,
    ];
  }
}
