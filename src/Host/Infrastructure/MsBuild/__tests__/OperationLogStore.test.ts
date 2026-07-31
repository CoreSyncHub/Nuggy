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

  it("enregistre un run de restore en Running puis le complète", () => {
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
      output: ["Restauration effectuée."],
      whyInsights: [],
    });
    [entry] = store.getEntries() as RestoreRunEntryDto[];
    expect(entry).toMatchObject({
      status: "Succeeded",
      exitCode: 0,
      finishedUtc: "2026-07-27T10:00:05.000Z",
      output: ["Restauration effectuée."],
    });
  });

  it("completeRestore sur runId inconnu est un no-op silencieux", () => {
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

  it("horodate les écritures et retourne l'ordre anté-chronologique", () => {
    const store = new OperationLogStore();
    store.recordWrite(writeEntry("Premier"));
    jest.setSystemTime(new Date("2026-07-27T10:01:00.000Z"));
    store.recordWrite(writeEntry("Second"));
    const entries = store.getEntries() as WriteOperationEntryDto[];
    expect(entries.map((e) => e.packageId)).toEqual(["Second", "Premier"]);
    expect(entries[0].timestampUtc).toBe("2026-07-27T10:01:00.000Z");
    expect(entries[0].kind).toBe("write");
  });

  it("éjecte la plus ancienne entrée au-delà de 50 (FIFO)", () => {
    const store = new OperationLogStore();
    for (let i = 1; i <= 51; i++) {
      store.recordWrite(writeEntry(`Pkg${i}`));
    }
    const entries = store.getEntries() as WriteOperationEntryDto[];
    expect(entries).toHaveLength(50);
    expect(entries[entries.length - 1].packageId).toBe("Pkg2"); // Pkg1 éjecté
    expect(entries[0].packageId).toBe("Pkg51");
  });

  it("plafonne la sortie à 500 lignes avec une ligne de troncature", () => {
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
    expect(entry.output[500]).toBe("… sortie tronquée (750 lignes au total)");
  });

  it("getEntries retourne une copie : muter le résultat n'affecte pas le store", () => {
    const store = new OperationLogStore();
    store.recordWrite(writeEntry());
    const entries = store.getEntries();
    entries.pop();
    (store.getEntries()[0] as WriteOperationEntryDto).packageId = "Mutation";
    expect(store.getEntries()).toHaveLength(1);
    expect((store.getEntries()[0] as WriteOperationEntryDto).packageId).toBe("Serilog");
  });

  it("recordWrite copie les tableaux : muter les tableaux passés ne corrompt pas le journal", () => {
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

    // Mutate les tableaux ET les objets internes APRÈS l'enregistrement
    affectedProjects.push("/repo/src/Extra/Extra.csproj");
    filesChanged.push("/repo/src/Extra/Extra.csproj");
    skipped[0].reason = "Mutated";

    // Vérifier que le journal n'est pas corrompu
    const [entry] = store.getEntries() as WriteOperationEntryDto[];
    expect(entry.affectedProjects).toEqual(["/repo/src/App/App.csproj"]);
    expect(entry.filesChanged).toEqual(["/repo/src/App/App.csproj"]);
    expect(entry.skipped[0].reason).toBe("Original");
  });
});
