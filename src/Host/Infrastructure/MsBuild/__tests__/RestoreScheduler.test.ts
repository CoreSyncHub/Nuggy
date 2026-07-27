import { RestoreScheduler } from "../RestoreScheduler";
import { OperationLogStore } from "../OperationLogStore";
import { type IProcessRunner } from "../ProcessRunner";
import { type ILogger } from "@/Host/Application/Abstractions/Log/ILogger";
import { type RestoreRunEntryDto } from "@Shared/Features/Dtos/OperationLogDto";

const noOpLogger: ILogger = {
  Info: jest.fn(),
  Warning: jest.fn(),
  Error: jest.fn(),
  Debug: jest.fn(),
};

function runnerReturning(result: { exitCode: number | null; output: string; timedOut: boolean }) {
  return { run: jest.fn().mockResolvedValue(result) } as IProcessRunner;
}

describe("RestoreScheduler", () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  it("débounce : trois schedule rapprochés → un seul run", async () => {
    const runner = runnerReturning({ exitCode: 0, output: "", timedOut: false });
    const store = new OperationLogStore();
    const scheduler = new RestoreScheduler(store, runner, noOpLogger);
    scheduler.schedule("/Solution/My.sln");
    scheduler.schedule("/Solution/My.sln");
    scheduler.schedule("/Solution/My.sln");
    expect(scheduler.getStatus().status).toBe("Running");
    await jest.advanceTimersByTimeAsync(300);
    expect(runner.run).toHaveBeenCalledTimes(1);
    expect(runner.run).toHaveBeenCalledWith(
      "dotnet",
      ["restore", "/Solution/My.sln"],
      "/Solution",
      300_000,
    );
    expect(scheduler.getStatus().status).toBe("Succeeded");
  });

  it("un schedule pendant un run en cours enchaîne un second run à la fin", async () => {
    let release!: (v: { exitCode: number; output: string; timedOut: boolean }) => void;
    const runner: IProcessRunner = {
      run: jest
        .fn()
        .mockImplementationOnce(
          () =>
            new Promise((r) => {
              release = r;
            }),
        )
        .mockResolvedValueOnce({ exitCode: 0, output: "", timedOut: false }),
    };
    const store = new OperationLogStore();
    const scheduler = new RestoreScheduler(store, runner, noOpLogger);
    scheduler.schedule("/Solution/My.sln");
    await jest.advanceTimersByTimeAsync(300); // run 1 démarre et reste pendu
    scheduler.schedule("/Solution/My.sln"); // pendant le run
    await jest.advanceTimersByTimeAsync(300);
    expect(runner.run).toHaveBeenCalledTimes(1); // pas de concurrence
    release({ exitCode: 0, output: "", timedOut: false });
    await jest.advanceTimersByTimeAsync(300);
    expect(runner.run).toHaveBeenCalledTimes(2); // enchaîné après la fin
    expect(scheduler.getStatus().status).toBe("Succeeded");
  });

  it("échec : extrait les lignes error NU/MSB, runId croît", async () => {
    const output = [
      "  Determining projects to restore...",
      "/x/A.csproj : error NU1102: Unable to find package Foo with version 9.9.9",
      "some noise",
      "/x/B.csproj : error MSB4025: The project file could not be loaded.",
    ].join("\n");
    const runner = runnerReturning({ exitCode: 1, output, timedOut: false });
    const store = new OperationLogStore();
    const scheduler = new RestoreScheduler(store, runner, noOpLogger);
    scheduler.schedule("/Solution/My.sln");
    await jest.advanceTimersByTimeAsync(300);
    const status = scheduler.getStatus();
    expect(status.status).toBe("Failed");
    expect(status.messages).toEqual([
      "/x/A.csproj : error NU1102: Unable to find package Foo with version 9.9.9",
      "/x/B.csproj : error MSB4025: The project file could not be loaded.",
    ]);
    expect(status.runId).toBe(1);
  });

  it("timeout → Failed avec message dédié", async () => {
    const runner = runnerReturning({ exitCode: null, output: "", timedOut: true });
    const store = new OperationLogStore();
    const scheduler = new RestoreScheduler(store, runner, noOpLogger);
    scheduler.schedule("/Solution/My.sln");
    await jest.advanceTimersByTimeAsync(300);
    expect(scheduler.getStatus().status).toBe("Failed");
    expect(scheduler.getStatus().messages[0]).toContain("timeout");
  });

  it("dotnet introuvable → Failed avec message SDK", async () => {
    const runner = runnerReturning({ exitCode: null, output: "", timedOut: false });
    const store = new OperationLogStore();
    const scheduler = new RestoreScheduler(store, runner, noOpLogger);
    scheduler.schedule("/Solution/My.sln");
    await jest.advanceTimersByTimeAsync(300);
    expect(scheduler.getStatus().messages[0]).toContain("SDK .NET introuvable");
  });

  it("l'état terminal reste consultable puis repasse Running au schedule suivant", async () => {
    const runner = runnerReturning({ exitCode: 0, output: "", timedOut: false });
    const store = new OperationLogStore();
    const scheduler = new RestoreScheduler(store, runner, noOpLogger);
    scheduler.schedule("/Solution/My.sln");
    await jest.advanceTimersByTimeAsync(300);
    expect(scheduler.getStatus().status).toBe("Succeeded");
    scheduler.schedule("/Solution/My.sln");
    expect(scheduler.getStatus().status).toBe("Running");
    await jest.advanceTimersByTimeAsync(300);
    expect(scheduler.getStatus().runId).toBe(2);
  });

  it("écriture reçue pendant un run en cours : le run 1 publie Running (pas son terminal), le run 2 publie ensuite son propre terminal (Finding 2)", async () => {
    let release!: (v: { exitCode: number; output: string; timedOut: boolean }) => void;
    const runner: IProcessRunner = {
      run: jest
        .fn()
        .mockImplementationOnce(
          () =>
            new Promise((r) => {
              release = r;
            }),
        )
        .mockResolvedValueOnce({ exitCode: 0, output: "", timedOut: false }),
    };
    const store = new OperationLogStore();
    const scheduler = new RestoreScheduler(store, runner, noOpLogger);
    scheduler.schedule("/Solution/My.sln");
    await jest.advanceTimersByTimeAsync(300); // run 1 (runId 1) démarre et reste pendu
    scheduler.schedule("/Solution/My.sln"); // write B arrive pendant le run 1
    release({ exitCode: 0, output: "", timedOut: false }); // run 1 se termine (succès)
    await jest.advanceTimersByTimeAsync(0); // laisse la continuation de run 1 s'exécuter
    // Le terminal du run 1 ne doit jamais être publié : un second run est en attente.
    expect(scheduler.getStatus().status).toBe("Running");
    await jest.advanceTimersByTimeAsync(300); // run 2 (runId 2) démarre et se termine
    const status = scheduler.getStatus();
    expect(status.status).toBe("Succeeded");
    expect(status.runId).toBe(2);
  });

  it("rejet du runner → atteint l'état Failed (pas stuck Running), pas de rejection non gérée", async () => {
    const runner: IProcessRunner = {
      run: jest.fn().mockRejectedValue(new Error("Simulated runner error")),
    };
    const store = new OperationLogStore();
    const scheduler = new RestoreScheduler(store, runner, noOpLogger);
    scheduler.schedule("/Solution/My.sln");
    expect(scheduler.getStatus().status).toBe("Running");
    await jest.advanceTimersByTimeAsync(300);
    const status = scheduler.getStatus();
    expect(status.status).toBe("Failed");
    expect(status.messages[0]).toContain("erreur d'exécution du processus");
    expect(status.runId).toBe(1);
  });

  describe("attribution des dépendances transitives via dotnet nuget why", () => {
    it("échec NU sur un paquet transitif nommé deux fois : un seul appel dotnet nuget why, résultat ajouté aux messages", async () => {
      const restoreOutput = [
        "/x/A.csproj : error NU1902: Le package 'OpenTelemetry.Api' 1.14.0 présente une vulnérabilité connue de gravité modérée",
        "/x/B.csproj : error NU1902: Le package 'OpenTelemetry.Api' 1.14.0 présente une vulnérabilité connue de gravité modérée",
      ].join("\n");
      const whyOutput = [
        "Project 'My' has the following dependency graph(s) for 'OpenTelemetry.Api':",
        "  [net8.0]",
        "   └─ Foo.Bar (>= 1.0.0)",
        "      └─ OpenTelemetry.Api (>= 1.14.0)",
      ].join("\n");
      const run = jest.fn().mockImplementation((_command: string, args: string[]) => {
        if (args[0] === "restore") {
          return Promise.resolve({ exitCode: 1, output: restoreOutput, timedOut: false });
        }
        return Promise.resolve({ exitCode: 0, output: whyOutput, timedOut: false });
      });
      const runner: IProcessRunner = { run };
      const store = new OperationLogStore();
      const scheduler = new RestoreScheduler(store, runner, noOpLogger);
      scheduler.schedule("/Solution/My.sln");
      await jest.advanceTimersByTimeAsync(300);

      expect(run).toHaveBeenCalledTimes(2); // 1 restore + 1 why (dédupliqué)
      expect(run).toHaveBeenCalledWith(
        "dotnet",
        ["nuget", "why", "/Solution/My.sln", "OpenTelemetry.Api"],
        "/Solution",
        30_000,
      );

      const status = scheduler.getStatus();
      expect(status.status).toBe("Failed");
      expect(status.messages).toEqual([
        "/x/A.csproj : error NU1902: Le package 'OpenTelemetry.Api' 1.14.0 présente une vulnérabilité connue de gravité modérée",
        "/x/B.csproj : error NU1902: Le package 'OpenTelemetry.Api' 1.14.0 présente une vulnérabilité connue de gravité modérée",
        "— dépendances de 'OpenTelemetry.Api' (dotnet nuget why) —",
        "Project 'My' has the following dependency graph(s) for 'OpenTelemetry.Api':",
        "[net8.0]",
        "└─ Foo.Bar (>= 1.0.0)",
        "└─ OpenTelemetry.Api (>= 1.14.0)",
      ]);
    });

    it("dotnet nuget why échoue (exit 1) : le restore Failed est publié sans crash, messages inchangés à part les erreurs d'origine, logger.Warning appelé", async () => {
      const restoreOutput =
        "/x/A.csproj : error NU1102: Unable to find package 'Foo' with version (>= 9.9.9)";
      const run = jest.fn().mockImplementation((_command: string, args: string[]) => {
        if (args[0] === "restore") {
          return Promise.resolve({ exitCode: 1, output: restoreOutput, timedOut: false });
        }
        return Promise.resolve({ exitCode: 1, output: "", timedOut: false });
      });
      const runner: IProcessRunner = { run };
      const store = new OperationLogStore();
      const scheduler = new RestoreScheduler(store, runner, noOpLogger);
      scheduler.schedule("/Solution/My.sln");
      await jest.advanceTimersByTimeAsync(300);

      const status = scheduler.getStatus();
      expect(status.status).toBe("Failed");
      expect(status.messages).toEqual([restoreOutput]);
      expect(noOpLogger.Warning).toHaveBeenCalled();
    });

    it("restore réussi : aucun appel dotnet nuget why", async () => {
      const run = jest.fn().mockResolvedValue({ exitCode: 0, output: "", timedOut: false });
      const runner: IProcessRunner = { run };
      const store = new OperationLogStore();
      const scheduler = new RestoreScheduler(store, runner, noOpLogger);
      scheduler.schedule("/Solution/My.sln");
      await jest.advanceTimersByTimeAsync(300);

      expect(run).toHaveBeenCalledTimes(1);
      expect(scheduler.getStatus().status).toBe("Succeeded");
    });

    it("ligne NU sans token entre guillemets : aucune extraction, aucun crash, aucun appel why", async () => {
      const restoreOutput =
        "/x/A.csproj : error NU1102: Unable to find package Foo with version 9.9.9";
      const run = jest
        .fn()
        .mockResolvedValue({ exitCode: 1, output: restoreOutput, timedOut: false });
      const runner: IProcessRunner = { run };
      const store = new OperationLogStore();
      const scheduler = new RestoreScheduler(store, runner, noOpLogger);
      scheduler.schedule("/Solution/My.sln");
      await jest.advanceTimersByTimeAsync(300);

      const status = scheduler.getStatus();
      expect(status.status).toBe("Failed");
      expect(status.messages).toEqual([restoreOutput]);
      expect(run).toHaveBeenCalledTimes(1); // seul le restore, aucun why (rien à extraire)
    });

    it("échec NU pendant qu'un run est déjà en attente : Running publié, enrichissement sauté (zéro appel why)", async () => {
      let release!: (v: { exitCode: number; output: string; timedOut: boolean }) => void;
      const restoreOutput =
        "/x/A.csproj : error NU1902: Le package 'Foo' 1.0.0 présente une vulnérabilité connue";
      const run = jest
        .fn()
        .mockImplementationOnce(
          () =>
            new Promise((r) => {
              release = r;
            }),
        )
        .mockResolvedValue({ exitCode: 0, output: "", timedOut: false });
      const runner: IProcessRunner = { run };
      const store = new OperationLogStore();
      const scheduler = new RestoreScheduler(store, runner, noOpLogger);
      scheduler.schedule("/Solution/My.sln");
      await jest.advanceTimersByTimeAsync(300); // run 1 démarre et reste pendu
      scheduler.schedule("/Solution/My.sln"); // un second run est mis en attente pendant le run 1
      release({ exitCode: 1, output: restoreOutput, timedOut: false }); // run 1 échoue avec une erreur NU
      await jest.advanceTimersByTimeAsync(0); // laisse la continuation de run 1 s'exécuter

      // Le terminal Failed du run 1 ne doit jamais être publié : un second run est en attente,
      // donc son enrichissement (dotnet nuget why) est sauté — travail jeté sinon.
      expect(scheduler.getStatus().status).toBe("Running");
      const whyCalls = run.mock.calls.filter((call) => call[1][0] === "nuget");
      expect(whyCalls).toHaveLength(0);
    });
  });

  describe("journalisation dans OperationLogStore", () => {
    it("journalise un run réussi : start Running puis complete Succeeded avec la sortie", async () => {
      const store = new OperationLogStore();
      const runner = runnerReturning({
        exitCode: 0,
        output: "Restauration effectuée.\n",
        timedOut: false,
      });
      const scheduler = new RestoreScheduler(store, runner, noOpLogger);
      scheduler.schedule("/repo/Solution.sln");
      await jest.advanceTimersByTimeAsync(300);
      const [entry] = store.getEntries() as RestoreRunEntryDto[];
      expect(entry).toMatchObject({
        kind: "restore",
        runId: 1,
        solutionPath: "/repo/Solution.sln",
        status: "Succeeded",
        exitCode: 0,
      });
      expect(entry.output).toContain("Restauration effectuée.");
    });

    it("journalise un échec avec les blocs nuget why dans whyInsights (pas dans output)", async () => {
      const store = new OperationLogStore();
      const restoreOutput =
        "/x/A.csproj : error NU1902: Le package 'OpenTelemetry.Api' 1.14.0 présente une vulnérabilité connue de gravité modérée";
      const whyOutput = "App -> OpenTelemetry.Api";
      const run = jest.fn().mockImplementation((_command: string, args: string[]) => {
        if (args[0] === "restore") {
          return Promise.resolve({ exitCode: 1, output: restoreOutput, timedOut: false });
        }
        return Promise.resolve({ exitCode: 0, output: whyOutput, timedOut: false });
      });
      const runner: IProcessRunner = { run };
      const scheduler = new RestoreScheduler(store, runner, noOpLogger);
      scheduler.schedule("/Solution/My.sln");
      await jest.advanceTimersByTimeAsync(300);

      const [entry] = store.getEntries() as RestoreRunEntryDto[];
      expect(entry.status).toBe("Failed");
      expect(entry.whyInsights.join("\n")).toContain("OpenTelemetry.Api");
      expect(entry.output.join("\n")).not.toContain("— dépendances de");
    });

    it("journalise Failed quand le runner rejette", async () => {
      const store = new OperationLogStore();
      const runner: IProcessRunner = {
        run: jest.fn().mockRejectedValue(new Error("boom")),
      };
      const scheduler = new RestoreScheduler(store, runner, noOpLogger);
      scheduler.schedule("/Solution/My.sln");
      await jest.advanceTimersByTimeAsync(300);

      const [entry] = store.getEntries() as RestoreRunEntryDto[];
      expect(entry.status).toBe("Failed");
      expect(entry.output.join(" ")).toContain("boom");
    });

    it("journalise le terminal du run même quand sa publication est supprimée (écriture pendant le run)", async () => {
      const store = new OperationLogStore();
      let release!: (v: { exitCode: number; output: string; timedOut: boolean }) => void;
      const runner: IProcessRunner = {
        run: jest
          .fn()
          .mockImplementationOnce(
            () =>
              new Promise((r) => {
                release = r;
              }),
          )
          .mockResolvedValueOnce({ exitCode: 0, output: "", timedOut: false }),
      };
      const scheduler = new RestoreScheduler(store, runner, noOpLogger);
      scheduler.schedule("/Solution/My.sln");
      await jest.advanceTimersByTimeAsync(300); // run 1 (runId 1) démarre et reste pendu
      scheduler.schedule("/Solution/My.sln"); // write pendant le run 1
      release({ exitCode: 0, output: "", timedOut: false }); // run 1 se termine (succès)
      await jest.advanceTimersByTimeAsync(0); // laisse la continuation de run 1 s'exécuter
      // Le terminal du run 1 ne doit jamais être publié : un second run est en attente.
      expect(scheduler.getStatus().status).toBe("Running");
      const entries = store.getEntries() as RestoreRunEntryDto[];
      expect(entries.find((e) => e.runId === 1)?.status).toBe("Succeeded");
    });
  });
});
