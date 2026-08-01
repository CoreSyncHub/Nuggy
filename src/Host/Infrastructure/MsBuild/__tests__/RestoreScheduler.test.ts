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

  it("debounce: three schedules in quick succession → a single run", async () => {
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

  it("a schedule during a running run chains a second run at the end", async () => {
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
    await jest.advanceTimersByTimeAsync(300); // run 1 starts and stays hanging
    scheduler.schedule("/Solution/My.sln"); // during the run
    await jest.advanceTimersByTimeAsync(300);
    expect(runner.run).toHaveBeenCalledTimes(1); // pas de concurrence
    release({ exitCode: 0, output: "", timedOut: false });
    await jest.advanceTimersByTimeAsync(300);
    expect(runner.run).toHaveBeenCalledTimes(2); // chained after the end
    expect(scheduler.getStatus().status).toBe("Succeeded");
  });

  it("failure: extracts the error NU/MSB lines, runId increases", async () => {
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

  it("timeout → Failed with a dedicated message", async () => {
    const runner = runnerReturning({ exitCode: null, output: "", timedOut: true });
    const store = new OperationLogStore();
    const scheduler = new RestoreScheduler(store, runner, noOpLogger);
    scheduler.schedule("/Solution/My.sln");
    await jest.advanceTimersByTimeAsync(300);
    expect(scheduler.getStatus().status).toBe("Failed");
    expect(scheduler.getStatus().messages[0]).toContain("timeout");
  });

  it("dotnet not found → Failed with an SDK message", async () => {
    const runner = runnerReturning({ exitCode: null, output: "", timedOut: false });
    const store = new OperationLogStore();
    const scheduler = new RestoreScheduler(store, runner, noOpLogger);
    scheduler.schedule("/Solution/My.sln");
    await jest.advanceTimersByTimeAsync(300);
    expect(scheduler.getStatus().messages[0]).toContain("SDK .NET introuvable");
  });

  it("the terminal state stays readable then goes back to Running on the next schedule", async () => {
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

  it("write received during a running run: run 1 publishes Running (not its terminal status), run 2 then publishes its own terminal status (Finding 2)", async () => {
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
    await jest.advanceTimersByTimeAsync(300); // run 1 (runId 1) starts and stays hanging
    scheduler.schedule("/Solution/My.sln"); // write B lands during run 1
    release({ exitCode: 0, output: "", timedOut: false }); // run 1 finishes (success)
    await jest.advanceTimersByTimeAsync(0); // let run 1's continuation execute
    // Run 1's terminal status must never be published: a second run is pending.
    expect(scheduler.getStatus().status).toBe("Running");
    await jest.advanceTimersByTimeAsync(300); // run 2 (runId 2) starts and finishes
    const status = scheduler.getStatus();
    expect(status.status).toBe("Succeeded");
    expect(status.runId).toBe(2);
  });

  it("runner rejection → reaches the Failed state (not stuck Running), no unhandled rejection", async () => {
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
    expect(status.messages[0]).toContain("process execution error");
    expect(status.runId).toBe(1);
  });

  describe("transitive dependency blame through dotnet nuget why", () => {
    it("NU failure on a transitive package named twice: a single dotnet nuget why call, result appended to the messages", async () => {
      const restoreOutput = [
        "/x/A.csproj : error NU1902: Package 'OpenTelemetry.Api' 1.14.0 has a known moderate severity vulnerability",
        "/x/B.csproj : error NU1902: Package 'OpenTelemetry.Api' 1.14.0 has a known moderate severity vulnerability",
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

      expect(run).toHaveBeenCalledTimes(2); // 1 restore + 1 why (deduplicated)
      expect(run).toHaveBeenCalledWith(
        "dotnet",
        ["nuget", "why", "/Solution/My.sln", "OpenTelemetry.Api"],
        "/Solution",
        30_000,
      );

      const status = scheduler.getStatus();
      expect(status.status).toBe("Failed");
      expect(status.messages).toEqual([
        "/x/A.csproj : error NU1902: Package 'OpenTelemetry.Api' 1.14.0 has a known moderate severity vulnerability",
        "/x/B.csproj : error NU1902: Package 'OpenTelemetry.Api' 1.14.0 has a known moderate severity vulnerability",
        "— dependencies of 'OpenTelemetry.Api' (dotnet nuget why) —",
        "Project 'My' has the following dependency graph(s) for 'OpenTelemetry.Api':",
        "[net8.0]",
        "└─ Foo.Bar (>= 1.0.0)",
        "└─ OpenTelemetry.Api (>= 1.14.0)",
      ]);
    });

    it("dotnet nuget why fails (exit 1): the Failed restore is published without crashing, messages unchanged apart from the original errors, logger.Warning called", async () => {
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

    it("successful restore: no dotnet nuget why call", async () => {
      const run = jest.fn().mockResolvedValue({ exitCode: 0, output: "", timedOut: false });
      const runner: IProcessRunner = { run };
      const store = new OperationLogStore();
      const scheduler = new RestoreScheduler(store, runner, noOpLogger);
      scheduler.schedule("/Solution/My.sln");
      await jest.advanceTimersByTimeAsync(300);

      expect(run).toHaveBeenCalledTimes(1);
      expect(scheduler.getStatus().status).toBe("Succeeded");
    });

    it("NU line without a quoted token: no extraction, no crash, no why call", async () => {
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
      expect(run).toHaveBeenCalledTimes(1); // the restore only, no why (nothing to extract)
    });

    it("NU failure while a run is already pending: Running published, enrichment skipped (zero why calls)", async () => {
      let release!: (v: { exitCode: number; output: string; timedOut: boolean }) => void;
      const restoreOutput =
        "/x/A.csproj : error NU1902: Package 'Foo' 1.0.0 has a known vulnerability";
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
      await jest.advanceTimersByTimeAsync(300); // run 1 starts and stays hanging
      scheduler.schedule("/Solution/My.sln"); // a second run is queued while run 1 is in flight
      release({ exitCode: 1, output: restoreOutput, timedOut: false }); // run 1 fails with an NU error
      await jest.advanceTimersByTimeAsync(0); // let run 1's continuation execute

      // Run 1's Failed terminal status must never be published: a second run is pending,
      // so its enrichment (dotnet nuget why) is skipped — it would be wasted work.
      expect(scheduler.getStatus().status).toBe("Running");
      const whyCalls = run.mock.calls.filter((call) => call[1][0] === "nuget");
      expect(whyCalls).toHaveLength(0);
    });
  });

  describe("journalling into OperationLogStore", () => {
    it("journals a successful run: start Running then complete Succeeded with the output", async () => {
      const store = new OperationLogStore();
      const runner = runnerReturning({
        exitCode: 0,
        output: "Restore completed.\n",
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
      expect(entry.output).toContain("Restore completed.");
    });

    it("journals a failure with the nuget why blocks in whyInsights (not in output)", async () => {
      const store = new OperationLogStore();
      const restoreOutput =
        "/x/A.csproj : error NU1902: Package 'OpenTelemetry.Api' 1.14.0 has a known moderate severity vulnerability";
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
      expect(entry.output.join("\n")).not.toContain("— dependencies of");
    });

    it("journals Failed when the runner rejects", async () => {
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

    it("journals the run's terminal status even when its publication is suppressed (write during the run)", async () => {
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
      await jest.advanceTimersByTimeAsync(300); // run 1 (runId 1) starts and stays hanging
      scheduler.schedule("/Solution/My.sln"); // write during run 1
      release({ exitCode: 0, output: "", timedOut: false }); // run 1 finishes (success)
      await jest.advanceTimersByTimeAsync(0); // let run 1's continuation execute
      // Run 1's terminal status must never be published: a second run is pending.
      expect(scheduler.getStatus().status).toBe("Running");
      const entries = store.getEntries() as RestoreRunEntryDto[];
      expect(entries.find((e) => e.runId === 1)?.status).toBe("Succeeded");
    });
  });
});
