import * as path from "path";
import { singleton } from "tsyringe";
import { injectToken } from "@Shared/DependencyInjection/inject";
import { type ILogger, LOGGER } from "@/Host/Application/Abstractions/Log/ILogger";
import { type RestoreStatusDto } from "@/Shared/Features/Dtos/RestoreStatusDto";
import { PROCESS_RUNNER, type IProcessRunner } from "./ProcessRunner";

const DEBOUNCE_MS = 300;
const RESTORE_TIMEOUT_MS = 300_000;
const WHY_TIMEOUT_MS = 30_000;
const WHY_MAX_PACKAGES = 3;
const WHY_MAX_LINES = 40;
/** Budget total pour l'ensemble des appels `dotnet nuget why` d'un même échec : borne le
 *  retard de publication du Failed (cf. PackagesView.RESTORE_POLL_TIMEOUT_MS côté UI). */
const WHY_TOTAL_BUDGET_MS = 60_000;

/**
 * Programme les dotnet restore : débounce 300 ms, jamais deux runs
 * concurrents (le suivant s'enchaîne), statut consultable par query.
 */
@singleton()
export class RestoreScheduler {
  private status: RestoreStatusDto = { status: "Idle", messages: [], runId: 0 };
  private debounceTimer?: ReturnType<typeof setTimeout>;
  private running = false;
  private pendingSolution?: string;

  constructor(
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
    try {
      const result = await this.processRunner.run(
        "dotnet",
        ["restore", solutionPath],
        path.dirname(solutionPath),
        RESTORE_TIMEOUT_MS,
      );
      this.logger.Info("dotnet restore terminé", { solutionPath, exitCode: result.exitCode });
      this.logger.Debug(result.output);
      const terminal = this.toStatus(result, runId);
      // Un run est déjà en attente : on va republier "Running" ci-dessous, l'enrichissement
      // serait du travail jeté — on le saute pour ne pas retarder la publication.
      if (!this.pendingSolution && terminal.status === "Failed") {
        await this.attributeTransitiveDependencies(terminal, solutionPath);
      }
      // Une écriture est arrivée pendant ce run (pendingSolution déjà réarmé) : ne jamais
      // publier le terminal du run qui se termine, sous peine de faire croire au polling
      // UI que TOUT est fini alors qu'un second run va démarrer et écraser ce résultat.
      this.status = this.pendingSolution ? { status: "Running", messages: [], runId } : terminal;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      this.logger.Error(`dotnet restore a échoué`, error instanceof Error ? error : undefined, {
        solutionPath,
      });
      const terminal: RestoreStatusDto = {
        status: "Failed",
        messages: [`erreur d'exécution du processus: ${errorMessage}`],
        runId,
        finishedAtUtc: new Date().toISOString(),
      };
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
      messages: errors.length > 0 ? errors : [`dotnet restore a échoué (code ${result.exitCode})`],
      runId,
      finishedAtUtc,
    };
  }

  /**
   * Pour un échec de restore portant des erreurs NuGet (NU****), tente d'identifier via
   * `dotnet nuget why` quels packages directs introduisent chaque package transitif en
   * faute, et complète les messages du statut en conséquence. Best-effort : toute
   * défaillance de `dotnet nuget why` (exit non nul, timeout, exitCode null, rejet) est
   * loguée puis ignorée — le Failed d'origine ne doit jamais être retardé indéfiniment.
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
        this.logger.Warning("dotnet nuget why : budget d'enrichissement épuisé, paquet ignoré", {
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
          this.logger.Warning("dotnet nuget why a échoué", {
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
          `— dépendances de '${packageId}' (dotnet nuget why) —`,
          ...lines.slice(0, WHY_MAX_LINES),
        );
      } catch (error) {
        this.logger.Warning("dotnet nuget why a échoué", {
          solutionPath,
          packageId,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
  }

  /** Ids de packages candidats pour `dotnet nuget why`, extraits des lignes `error NU****`. */
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
