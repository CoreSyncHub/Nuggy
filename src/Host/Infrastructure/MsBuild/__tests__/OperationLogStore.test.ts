import { OperationLogStore } from "../OperationLogStore";
import {
  type RestoreRunEntryDto,
  type WriteOperationEntryDto,
} from "@Shared/Features/Dtos/OperationLogDto";
import { type SkippedTargetDto } from "@Shared/Features/Dtos/PackageWriteResultDto";

describe("OperationLogStore", () => {
  beforeEach(() => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date("2026-07-27T10:00:00.000Z"));
  });
  afterEach(() => jest.useRealTimers());

  const writeEntry = (
    packageId = "Serilog",
  ): Omit<WriteOperationEntryDto, "kind" | "timestampUtc"> => ({
    operation: "install",
    packageId,
    version: "4.0.0",
    status: "Ok",
    affectedProjects: ["/repo/src/App/App.csproj"],
    filesChanged: ["/repo/src/App/App.csproj"],
    skipped: [],
  });

  it("records a restore run as Running then completes it", () => {
    const store = new OperationLogStore();
    store.recordRestoreStart(1, "/repo/Solution.sln");
    let [entry] = store.getEntries() as RestoreRunEntryDto[];
    expect(entry).toMatchObject({
      kind: "restore",
      runId: 1,
      status: "Running",
      startedUtc: "2026-07-27T10:00:00.000Z",
    });
    expect(entry.finishedUtc).toBeUndefined();

    jest.setSystemTime(new Date("2026-07-27T10:00:05.000Z"));
    store.completeRestore(1, {
      status: "Succeeded",
      exitCode: 0,
      output: ["Restore completed."],
      whyInsights: [],
    });
    [entry] = store.getEntries() as RestoreRunEntryDto[];
    expect(entry).toMatchObject({
      status: "Succeeded",
      exitCode: 0,
      finishedUtc: "2026-07-27T10:00:05.000Z",
      output: ["Restore completed."],
    });
  });

  it("completeRestore on an unknown runId is a silent no-op", () => {
    const store = new OperationLogStore();
    expect(() =>
      store.completeRestore(99, {
        status: "Failed",
        output: [],
        whyInsights: [],
      }),
    ).not.toThrow();
    expect(store.getEntries()).toHaveLength(0);
  });

  it("timestamps the writes and returns them newest-first", () => {
    const store = new OperationLogStore();
    store.recordWrite(writeEntry("Premier"));
    jest.setSystemTime(new Date("2026-07-27T10:01:00.000Z"));
    store.recordWrite(writeEntry("Second"));
    const entries = store.getEntries() as WriteOperationEntryDto[];
    expect(entries.map((e) => e.packageId)).toEqual(["Second", "Premier"]);
    expect(entries[0].timestampUtc).toBe("2026-07-27T10:01:00.000Z");
    expect(entries[0].kind).toBe("write");
  });

  it("evicts the oldest entry beyond 50 (FIFO)", () => {
    const store = new OperationLogStore();
    for (let i = 1; i <= 51; i++) {
      store.recordWrite(writeEntry(`Pkg${i}`));
    }
    const entries = store.getEntries() as WriteOperationEntryDto[];
    expect(entries).toHaveLength(50);
    expect(entries[entries.length - 1].packageId).toBe("Pkg2"); // Pkg1 evicted
    expect(entries[0].packageId).toBe("Pkg51");
  });

  it("caps the output at 500 lines with a truncation line", () => {
    const store = new OperationLogStore();
    store.recordRestoreStart(1, "/repo/Solution.sln");
    const output = Array.from({ length: 750 }, (_, i) => `ligne ${i + 1}`);
    store.completeRestore(1, {
      status: "Failed",
      exitCode: 1,
      output,
      whyInsights: [],
    });
    const [entry] = store.getEntries() as RestoreRunEntryDto[];
    expect(entry.output).toHaveLength(501);
    expect(entry.output[499]).toBe("ligne 500");
    expect(entry.output[500]).toBe("… output truncated (750 lines in total)");
  });

  it("getEntries returns a copy: mutating the result does not affect the store", () => {
    const store = new OperationLogStore();
    store.recordWrite(writeEntry());
    const entries = store.getEntries();
    entries.pop();
    (store.getEntries()[0] as WriteOperationEntryDto).packageId = "Mutation";
    expect(store.getEntries()).toHaveLength(1);
    expect((store.getEntries()[0] as WriteOperationEntryDto).packageId).toBe("Serilog");
  });

  it("recordWrite copies the arrays: mutating the passed arrays does not corrupt the journal", () => {
    const store = new OperationLogStore();
    const affectedProjects = ["/repo/src/App/App.csproj"];
    const filesChanged = ["/repo/src/App/App.csproj"];
    const skipped: SkippedTargetDto[] = [{ path: "/repo/Skip", reason: "Original" }];
    store.recordWrite({
      ...writeEntry(),
      affectedProjects,
      filesChanged,
      skipped,
    });

    // Mutate the arrays AND the inner objects AFTER recording
    affectedProjects.push("/repo/src/Extra/Extra.csproj");
    filesChanged.push("/repo/src/Extra/Extra.csproj");
    skipped[0].reason = "Mutated";

    // Check that the journal was not corrupted
    const [entry] = store.getEntries() as WriteOperationEntryDto[];
    expect(entry.affectedProjects).toEqual(["/repo/src/App/App.csproj"]);
    expect(entry.filesChanged).toEqual(["/repo/src/App/App.csproj"]);
    expect(entry.skipped[0].reason).toBe("Original");
  });
});
