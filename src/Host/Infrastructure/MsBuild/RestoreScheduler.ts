import * as path from "path";
import { singleton } from "tsyringe";
import { injectToken } from "@Shared/DependencyInjection/inject";
import { type ILogger, LOGGER } from "@/Host/Application/Abstractions/Log/ILogger";
import { type RestoreStatusDto } from "@/Shared/Features/Dtos/RestoreStatusDto";
import { PROCESS_RUNNER, type IProcessRunner } from "./ProcessRunner";
import { OperationLogStore } from "./OperationLogStore";

const DEBOUNCE_MS = 300;
const RESTORE_TIMEOUT_MS = 300_000;
const WHY_TIMEOUT_MS = 30_000;
const WHY_MAX_PACKAGES = 3;
const WHY_MAX_LINES = 40;
/** Total budget for all `dotnet nuget why` calls of a single failure: bounds how late
 *  the Failed status is published (cf. PackagesView.RESTORE_POLL_TIMEOUT_MS on the UI side). */
const WHY_TOTAL_BUDGET_MS = 60_000;

/**
 * Schedules dotnet restore runs: 300 ms debounce, never two concurrent runs
 * (the next one chains after), status readable through a query.
 */
@singleton()
export class RestoreScheduler {
  private status: RestoreStatusDto = { status: "Idle", messages: [], runId: 0 };
  private debounceTimer?: ReturnType<typeof setTimeout>;
  private running = false;
  private pendingSolution?: string;

  constructor(
    private readonly operationLog: OperationLogStore,
    @injectToken(PROCESS_RUNNER) private readonly processRunner: IProcessRunner,
    @injectToken(LOGGER) private readonly logger: ILogger,
  ) {}

  public schedule(solutionPath: string): void {
    this.pendingSolution = solutionPath;
    this.status = { status: "Running", messages: [], runId: this.status.runId };
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
    }
    this.debounceTimer = setTimeout(() => void this.fire(), DEBOUNCE_MS);
  }

  public getStatus(): RestoreStatusDto {
    return this.status;
  }

  private async fire(): Promise<void> {
    if (this.running || !this.pendingSolution) {
      return; // un run en cours relancera via sa fin
    }
    const solutionPath = this.pendingSolution;
    this.pendingSolution = undefined;
    this.running = true;
    const runId = this.status.runId + 1;
    this.operationLog.recordRestoreStart(runId, solutionPath);
    try {
      const result = await this.processRunner.run(
        "dotnet",
        ["restore", solutionPath],
        path.dirname(solutionPath),
        RESTORE_TIMEOUT_MS,
      );
      this.logger.Info("dotnet restore finished", { solutionPath, exitCode: result.exitCode });
      this.logger.Debug(result.output);
      const terminal = this.toStatus(result, runId);
      const messagesBeforeWhy = terminal.messages.length;
      // A run is already pending: we are about to republish "Running" below, so the
      // enrichment would be wasted work — skip it rather than delay publication.
      if (!this.pendingSolution && terminal.status === "Failed") {
        await this.attributeTransitiveDependencies(terminal, solutionPath);
      }
      this.operationLog.completeRestore(runId, {
        status: terminal.status === "Succeeded" ? "Succeeded" : "Failed",
        exitCode: result.exitCode ?? undefined,
        output: result.output.split(/\r?\n/),
        whyInsights: terminal.messages.slice(messagesBeforeWhy),
      });
      // A write landed during this run (pendingSolution already re-armed): never publish
      // the terminal status of the finishing run, or the UI polling would believe
      // EVERYTHING is done while a second run is about to start and overwrite that result.
      this.status = this.pendingSolution ? { status: "Running", messages: [], runId } : terminal;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      this.logger.Error(`dotnet restore failed`, error instanceof Error ? error : undefined, {
        solutionPath,
      });
      const terminal: RestoreStatusDto = {
        status: "Failed",
        messages: [`process execution error: ${errorMessage}`],
        runId,
        finishedAtUtc: new Date().toISOString(),
      };
      this.operationLog.completeRestore(runId, {
        status: "Failed",
        output: [`process execution error: ${errorMessage}`],
        whyInsights: [],
      });
      this.status = this.pendingSolution ? { status: "Running", messages: [], runId } : terminal;
    } finally {
      this.running = false;
      if (this.pendingSolution) {
        this.debounceTimer = setTimeout(() => void this.fire(), DEBOUNCE_MS);
      }
    }
  }

  private toStatus(
    result: { exitCode: number | null; output: string; timedOut: boolean },
    runId: number,
  ): RestoreStatusDto {
    const finishedAtUtc = new Date().toISOString();
    if (result.timedOut) {
      return { status: "Failed", messages: ["restore interrompu (timeout)"], runId, finishedAtUtc };
    }
    if (result.exitCode === null) {
      return {
        status: "Failed",
        messages: ["SDK .NET introuvable (dotnet absent du PATH)"],
        runId,
        finishedAtUtc,
      };
    }
    if (result.exitCode === 0) {
      return { status: "Succeeded", messages: [], runId, finishedAtUtc };
    }
    const errors = result.output
      .split(/\r?\n/)
      .filter((line) => /error (NU|MSB)\d+/.test(line))
      .map((line) => line.trim());
    return {
      status: "Failed",
      messages:
        errors.length > 0 ? errors : [`dotnet restore failed (exit code ${result.exitCode})`],
      runId,
      finishedAtUtc,
    };
  }

  /**
   * For a restore failure carrying NuGet errors (NU****), tries to identify through
   * `dotnet nuget why` which direct packages pull in each offending transitive package,
   * and completes the status messages accordingly. Best-effort: any failure of
   * `dotnet nuget why` (non-zero exit, timeout, null exitCode, rejection) is logged then
   * ignored — the original Failed status must never be delayed indefinitely.
   */
  private async attributeTransitiveDependencies(
    status: RestoreStatusDto,
    solutionPath: string,
  ): Promise<void> {
    const packageIds = this.extractCandidatePackageIds(status.messages);
    const deadline = Date.now() + WHY_TOTAL_BUDGET_MS;
    for (const packageId of packageIds) {
      const remaining = deadline - Date.now();
      if (remaining <= 0) {
        this.logger.Warning("dotnet nuget why: enrichment budget exhausted, package skipped", {
          solutionPath,
          packageId,
        });
        break;
      }
      try {
        const result = await this.processRunner.run(
          "dotnet",
          ["nuget", "why", solutionPath, packageId],
          path.dirname(solutionPath),
          Math.min(WHY_TIMEOUT_MS, remaining),
        );
        if (result.timedOut || result.exitCode !== 0) {
          this.logger.Warning("dotnet nuget why failed", {
            solutionPath,
            packageId,
            exitCode: result.exitCode,
            timedOut: result.timedOut,
          });
          continue;
        }
        const lines = result.output.split(/\r?\n/).map((line) => line.trim());
        while (lines.length > 0 && lines[0] === "") {
          lines.shift();
        }
        while (lines.length > 0 && lines[lines.length - 1] === "") {
          lines.pop();
        }
        if (lines.length === 0) {
          continue;
        }
        status.messages.push(
          `— dependencies of '${packageId}' (dotnet nuget why) —`,
          ...lines.slice(0, WHY_MAX_LINES),
        );
      } catch (error) {
        this.logger.Warning("dotnet nuget why failed", {
          solutionPath,
          packageId,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
  }

  /** Candidate package ids for `dotnet nuget why`, extracted from the `error NU****` lines. */
  private extractCandidatePackageIds(messages: string[]): string[] {
    const ids: string[] = [];
    for (const line of messages) {
      if (!/error NU\d+/.test(line)) {
        continue;
      }
      const match = /'([A-Za-z0-9_.\-]+)'/.exec(line);
      if (match && !ids.includes(match[1])) {
        ids.push(match[1]);
      }
      if (ids.length >= WHY_MAX_PACKAGES) {
        break;
      }
    }
    return ids;
  }
}
