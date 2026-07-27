# Onglets webview Packages / Logs — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ajouter des onglets Packages / Logs à la webview : historique borné des runs de restore (sortie complète) + journal de session des écritures, avec navigation « bandeau d'échec → onglet Logs scrollé sur le run ».

**Architecture:** Un `OperationLogStore` singleton côté Host (tampon mémoire 50 entrées FIFO, zéro I/O) alimenté par `RestoreScheduler` et les trois handlers d'écriture, exposé par une nouvelle `GetOperationLogQuery`. Côté Web, une coquille `<nuget-tabs>` (fluent-tabs, déjà enregistrés dans `Main.ts`) héberge `<packages-view>` (inchangé, bandeau allégé) et un nouveau `<logs-view>` qui fetch à l'activation.

**Tech Stack:** TypeScript, tsyringe (DI), Lit (webview), Fluent UI Web Components, Jest (ts-jest), CQRS WebMediator maison.

**Spec:** `docs/superpowers/specs/2026-07-27-onglets-logs-design.md`

## Global Constraints

- Prettier : guillemets doubles, `printWidth 100` — lancer `npx prettier --write` sur les fichiers touchés avant commit.
- Dépendances de constructeur injectées PAR CLASSE : **imports de valeur obligatoires** (`import { X }`, jamais `import type { X }`) — SWC n'émet pas les `design:paramtypes` sinon. Les interfaces injectées par token peuvent rester `import { type X }`.
- Tests : fixtures POSIX ; toute suite qui mocke `fs` ajoute `jest.mock("path", () => jest.requireActual("path").posix);` juste après `jest.mock("fs");` ; aucun réseau ni process réel ; fake timers (`jest.useFakeTimers()`) pour tout ce qui touche au temps.
- Messages produits côté Host : en français (convention existante, ex. « restore interrompu (timeout) »).
- Lit : fragments SVG via le template tag `svg` (jamais `html`) ; les composants réutilisent `TranslationService` + `subscribe` comme les composants existants.
- Le tampon du journal : **50 entrées max (FIFO)**, sortie restore **plafonnée à 500 lignes**, aucune persistance disque.
- `OperationLogStore` ne jette jamais (`completeRestore` sur runId inconnu = no-op silencieux).
- Suite complète verte à chaque tâche : `npx jest` (361 tests existants + nouveaux).

---

### Task 1: Contrats partagés + OperationLogStore

**Files:**
- Create: `src/Shared/Features/Dtos/OperationLogDto.ts`
- Create: `src/Host/Infrastructure/MsBuild/OperationLogStore.ts`
- Test: `src/Host/Infrastructure/MsBuild/__tests__/OperationLogStore.test.ts`

**Interfaces:**
- Consumes: `SkippedProjectDto` (existant, `src/Shared/Features/Dtos/PackageWriteResultDto.ts`).
- Produces: types `RestoreRunEntryDto` / `WriteOperationEntryDto` / `OperationLogEntryDto` / `OperationLogDto` et la classe `OperationLogStore` avec `recordRestoreStart(runId, solutionPath)`, `completeRestore(runId, result)`, `recordWrite(entry)`, `getEntries()` — consommés par les Tasks 2, 3, 4.

- [ ] **Step 1: Écrire le DTO partagé**

```typescript
// src/Shared/Features/Dtos/OperationLogDto.ts
import { type SkippedProjectDto } from "./PackageWriteResultDto";

export interface RestoreRunEntryDto {
  kind: "restore";
  runId: number;
  solutionPath: string;
  startedUtc: string;
  finishedUtc?: string;
  status: "Running" | "Succeeded" | "Failed";
  exitCode?: number;
  /** Sortie complète de dotnet restore, plafonnée à 500 lignes (+ ligne de troncature). */
  output: string[];
  /** Blocs `dotnet nuget why` produits par l'enrichissement (RestoreScheduler). */
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
  skipped: SkippedProjectDto[];
  error?: string;
}

export type OperationLogEntryDto = RestoreRunEntryDto | WriteOperationEntryDto;

export interface OperationLogDto {
  entries: OperationLogEntryDto[];
}
```

- [ ] **Step 2: Écrire les tests qui échouent**

```typescript
// src/Host/Infrastructure/MsBuild/__tests__/OperationLogStore.test.ts
import { OperationLogStore } from "../OperationLogStore";
import { type RestoreRunEntryDto, type WriteOperationEntryDto } from "@Shared/Features/Dtos/OperationLogDto";

describe("OperationLogStore", () => {
  beforeEach(() => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date("2026-07-27T10:00:00.000Z"));
  });
  afterEach(() => jest.useRealTimers());

  const writeEntry = (packageId = "Serilog"): Omit<WriteOperationEntryDto, "kind" | "timestampUtc"> => ({
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
    expect(entry).toMatchObject({ kind: "restore", runId: 1, status: "Running", startedUtc: "2026-07-27T10:00:00.000Z" });
    expect(entry.finishedUtc).toBeUndefined();

    jest.setSystemTime(new Date("2026-07-27T10:00:05.000Z"));
    store.completeRestore(1, { status: "Succeeded", exitCode: 0, output: ["Restauration effectuée."], whyInsights: [] });
    [entry] = store.getEntries() as RestoreRunEntryDto[];
    expect(entry).toMatchObject({ status: "Succeeded", exitCode: 0, finishedUtc: "2026-07-27T10:00:05.000Z", output: ["Restauration effectuée."] });
  });

  it("completeRestore sur runId inconnu est un no-op silencieux", () => {
    const store = new OperationLogStore();
    expect(() =>
      store.completeRestore(99, { status: "Failed", output: [], whyInsights: [] }),
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
    store.completeRestore(1, { status: "Failed", exitCode: 1, output, whyInsights: [] });
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
});
```

- [ ] **Step 3: Vérifier l'échec**

Run: `npx jest src/Host/Infrastructure/MsBuild/__tests__/OperationLogStore.test.ts`
Expected: FAIL (module `../OperationLogStore` introuvable)

- [ ] **Step 4: Implémenter le store**

```typescript
// src/Host/Infrastructure/MsBuild/OperationLogStore.ts
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
    this.push({ kind: "write", timestampUtc: new Date().toISOString(), ...entry });
  }

  /** Copie anté-chronologique (la plus récente d'abord). */
  public getEntries(): OperationLogEntryDto[] {
    return [...this.entries]
      .reverse()
      .map((e) => (e.kind === "restore" ? { ...e, output: [...e.output], whyInsights: [...e.whyInsights] } : { ...e, affectedProjects: [...e.affectedProjects], filesChanged: [...e.filesChanged], skipped: e.skipped.map((s) => ({ ...s })) }));
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
```

- [ ] **Step 5: Vérifier le vert + suite complète**

Run: `npx jest src/Host/Infrastructure/MsBuild/__tests__/OperationLogStore.test.ts` puis `npx jest`
Expected: PASS partout

- [ ] **Step 6: Commit**

```bash
git add src/Shared/Features/Dtos/OperationLogDto.ts src/Host/Infrastructure/MsBuild/OperationLogStore.ts src/Host/Infrastructure/MsBuild/__tests__/OperationLogStore.test.ts
git commit -m "feat: OperationLogStore - journal mémoire des restores et écritures"
```

---

### Task 2: RestoreScheduler alimente le journal

**Files:**
- Modify: `src/Host/Infrastructure/MsBuild/RestoreScheduler.ts`
- Test: `src/Host/Infrastructure/MsBuild/__tests__/RestoreScheduler.test.ts` (suite existante, à étendre)
- Modify: `src/Tests/Acceptances/__tests__/PackageWrites.acceptance.test.ts` (adapter la construction `new RestoreScheduler(...)` au nouveau 1er paramètre `new OperationLogStore()` — sinon la suite complète casse)

**Interfaces:**
- Consumes: `OperationLogStore.recordRestoreStart(runId, solutionPath)` et `.completeRestore(runId, { status, exitCode?, output, whyInsights })` (Task 1).
- Produces: entrées `kind: "restore"` complètes dans le journal pour tous les chemins de fin (succès, échec, timeout, exception du runner). Le `runId` des entrées est celui du `RestoreStatusDto` — la navigation UI (Task 7) s'appuie dessus.

- [ ] **Step 1: Étendre la suite existante avec des tests qui échouent**

Ajouter au `describe` existant (les tests actuels construisent le scheduler avec un `FakeProcessRunner` et des fake timers — réutiliser les mêmes helpers). Le scheduler prendra `OperationLogStore` en 1er paramètre de constructeur (injection par classe) : adapter les instanciations existantes `new RestoreScheduler(runner, logger)` → `new RestoreScheduler(store, runner, logger)` avec `const store = new OperationLogStore();` par test (instance réelle, pas de fake — c'est un service pur).

```typescript
it("journalise un run réussi : start Running puis complete Succeeded avec la sortie", async () => {
  const store = new OperationLogStore();
  const runner = new FakeProcessRunner({ exitCode: 0, output: "Restauration effectuée.\n", timedOut: false });
  const scheduler = new RestoreScheduler(store, runner, fakeLogger);
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
  // runner : restore exitCode 1 avec "error NU1902 ... 'OpenTelemetry.Api' ...",
  // puis appel `dotnet nuget why` réussi retournant "App -> OpenTelemetry.Api"
  // (même mécanique de FakeProcessRunner à réponses séquencées que les tests d'enrichissement existants)
  const [entry] = store.getEntries() as RestoreRunEntryDto[];
  expect(entry.status).toBe("Failed");
  expect(entry.whyInsights.join("\n")).toContain("OpenTelemetry.Api");
  expect(entry.output.join("\n")).not.toContain("— dépendances de");
});

it("journalise Failed quand le runner rejette", async () => {
  // runner qui rejette (même setup que le test existant du catch → Failed)
  const [entry] = store.getEntries() as RestoreRunEntryDto[];
  expect(entry.status).toBe("Failed");
  expect(entry.output.join(" ")).toContain("boom"); // message de l'erreur
});

it("journalise le terminal du run même quand sa publication est supprimée (écriture pendant le run)", async () => {
  // même scénario que le test existant "supprime le terminal si un run est en attente" :
  // schedule → run démarre → schedule pendant le run → le statut publié reste Running,
  // MAIS l'entrée de journal du 1er run est bien complétée (Succeeded/Failed).
  const entries = store.getEntries() as RestoreRunEntryDto[];
  expect(entries.find((e) => e.runId === 1)?.status).toBe("Succeeded");
});
```

- [ ] **Step 2: Vérifier l'échec**

Run: `npx jest src/Host/Infrastructure/MsBuild/__tests__/RestoreScheduler.test.ts`
Expected: FAIL (constructeur à 2 paramètres, aucune entrée journalisée)

- [ ] **Step 3: Brancher le scheduler sur le store**

Dans `RestoreScheduler.ts` :

1. Import de **valeur** (injection par classe) : `import { OperationLogStore } from "./OperationLogStore";`
2. Constructeur :

```typescript
constructor(
  private readonly operationLog: OperationLogStore,
  @injectToken(PROCESS_RUNNER) private readonly processRunner: IProcessRunner,
  @injectToken(LOGGER) private readonly logger: ILogger,
) {}
```

3. Dans `fire()`, juste après `const runId = this.status.runId + 1;` :

```typescript
this.operationLog.recordRestoreStart(runId, solutionPath);
```

4. Dans le `try`, après l'enrichissement éventuel — capturer d'abord le nombre de messages AVANT enrichissement pour isoler les blocs why :

```typescript
const terminal = this.toStatus(result, runId);
const messagesBeforeWhy = terminal.messages.length;
if (!this.pendingSolution && terminal.status === "Failed") {
  await this.attributeTransitiveDependencies(terminal, solutionPath);
}
this.operationLog.completeRestore(runId, {
  status: terminal.status === "Succeeded" ? "Succeeded" : "Failed",
  exitCode: result.exitCode ?? undefined,
  output: result.output.split(/\r?\n/),
  whyInsights: terminal.messages.slice(messagesBeforeWhy),
});
```

Note : `toStatus` ne retourne que `Succeeded`/`Failed` ici (jamais `Idle`/`Running`), le ternaire ne sert qu'à satisfaire le type. Le `completeRestore` est appelé AVANT la logique de suppression du terminal (`this.status = this.pendingSolution ? … : terminal`) : le journal enregistre la réalité du run, que son statut soit publié ou non.

5. Dans le `catch`, avant `this.status = …` :

```typescript
this.operationLog.completeRestore(runId, {
  status: "Failed",
  output: [`erreur d'exécution du processus: ${errorMessage}`],
  whyInsights: [],
});
```

- [ ] **Step 4: Vérifier le vert + suite complète**

Run: `npx jest src/Host/Infrastructure/MsBuild/__tests__/RestoreScheduler.test.ts` puis `npx jest`
Expected: PASS (les tests existants adaptés au nouveau constructeur restent verts)

- [ ] **Step 5: Commit**

```bash
git add src/Host/Infrastructure/MsBuild/RestoreScheduler.ts src/Host/Infrastructure/MsBuild/__tests__/RestoreScheduler.test.ts
git commit -m "feat: RestoreScheduler journalise chaque run dans OperationLogStore"
```

---

### Task 3: Les handlers d'écriture journalisent leurs opérations

**Files:**
- Modify: `src/Host/Application/Handlers/Packages/InstallPackageCommandHandler.ts`
- Modify: `src/Host/Application/Handlers/Packages/UpgradePackageCommandHandler.ts`
- Modify: `src/Host/Application/Handlers/Packages/UninstallPackageCommandHandler.ts`
- Test: suites existantes `__tests__/InstallPackageCommandHandler.test.ts`, `UpgradePackageCommandHandler.test.ts`, `UninstallPackageCommandHandler.test.ts` (étendre)
- Modify: `src/Tests/Acceptances/__tests__/PackageWrites.acceptance.test.ts` (adapter la construction des 3 handlers au nouveau 1er paramètre — passer le MÊME `OperationLogStore` que celui du `RestoreScheduler` adapté en Task 2, la Task 4 s'appuiera dessus)

**Interfaces:**
- Consumes: `OperationLogStore.recordWrite(entry)` (Task 1).
- Produces: une `WriteOperationEntryDto` par appel de `Handle`, cohérente avec le `PackageWriteResultDto` retourné (tous les chemins de sortie, y compris erreurs de validation).

**Patron (identique pour les trois handlers)** — pour couvrir TOUS les `return` sans dupliquer l'appel, renommer le `Handle` actuel en `handleCore` (private) et créer un `Handle` enveloppant :

```typescript
async Handle(command: InstallPackageCommand): Promise<PackageWriteResultDto> {
  const result = await this.handleCore(command);
  this.operationLog.recordWrite({
    operation: "install", // "upgrade" / "uninstall" selon le handler
    packageId: command.packageId,
    version: command.version, // omis dans UninstallPackageCommandHandler (pas de version)
    status: result.status,
    affectedProjects: result.affectedProjects,
    filesChanged: result.filesChanged,
    skipped: result.skipped,
    error: result.error,
  });
  return result;
}
```

Chaque handler gagne `private readonly operationLog: OperationLogStore` en **premier** paramètre de constructeur (injection par classe → import de valeur `import { OperationLogStore } from "@Infrastructure/MsBuild/OperationLogStore";`).

- [ ] **Step 1: Étendre chaque suite avec un test qui échoue**

Dans chaque suite, adapter la construction du handler (nouveau 1er paramètre : `new OperationLogStore()` réelle) puis ajouter (exemple pour Uninstall, décliner pour Install — avec `version` — et Upgrade) :

```typescript
it("journalise l'opération dans OperationLogStore avec les données du DTO", async () => {
  // réutiliser le setup nominal existant (retrait réussi d'un PackageReference)
  const result = await handler.Handle(new UninstallPackageCommand("Serilog", "/repo/Solution.sln"));
  const [entry] = store.getEntries() as WriteOperationEntryDto[];
  expect(entry).toMatchObject({
    kind: "write",
    operation: "uninstall",
    packageId: "Serilog",
    status: result.status,
    affectedProjects: result.affectedProjects,
    filesChanged: result.filesChanged,
  });
  expect(entry.version).toBeUndefined(); // Install/Upgrade : expect(entry.version).toBe("4.0.0")
});

it("journalise aussi les erreurs de validation", async () => {
  await handler.Handle(new UninstallPackageCommand("id invalide!", "/repo/Solution.sln"));
  const [entry] = store.getEntries() as WriteOperationEntryDto[];
  expect(entry.status).toBe("Error");
  expect(entry.error).toContain("identifiant de package invalide");
});
```

- [ ] **Step 2: Vérifier l'échec**

Run: `npx jest src/Host/Application/Handlers/Packages`
Expected: FAIL sur les 6 nouveaux tests (+ erreurs de constructeur dans les tests existants tant que non adaptés)

- [ ] **Step 3: Appliquer le patron aux trois handlers**

Renommage `Handle` → `handleCore` + `Handle` enveloppant + paramètre de constructeur, comme décrit ci-dessus. Ne toucher à AUCUNE logique interne de `handleCore`.

- [ ] **Step 4: Vérifier le vert + suite complète**

Run: `npx jest src/Host/Application/Handlers/Packages` puis `npx jest`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/Host/Application/Handlers/Packages
git commit -m "feat: Journalisation des écritures install/upgrade/uninstall"
```

---

### Task 4: GetOperationLogQuery + câblage DI/WebMediator + acceptance

**Files:**
- Create: `src/Shared/Features/Queries/GetOperationLogQuery.ts`
- Create: `src/Host/Application/Handlers/Packages/GetOperationLogQueryHandler.ts`
- Modify: `src/Host/Application/DependencyInjection.ts` (ProvidePackages)
- Modify: `src/Host/Presentation/nugetWebviewProvider.ts` (registerRequestType)
- Test: `src/Tests/Acceptances/__tests__/PackageWrites.acceptance.test.ts` (étendre)

**Interfaces:**
- Consumes: `OperationLogStore.getEntries()` (Task 1), entrées produites par Tasks 2-3.
- Produces: `GetOperationLogQuery` (classe sans paramètres, `implements IQuery<OperationLogDto>`) dispatché depuis le Web par `<logs-view>` (Task 6). **Attention convention WebMediator : la chaîne de `registerRequestType` doit être exactement le nom de la classe** (`"GetOperationLogQuery"`).

- [ ] **Step 1: Écrire la query et le handler**

```typescript
// src/Shared/Features/Queries/GetOperationLogQuery.ts
import { type IQuery } from "../../Abstractions/Messaging/IQuery";
import { type OperationLogDto } from "../Dtos/OperationLogDto";

/**
 * Query du journal de session : runs de restore + opérations d'écriture,
 * anté-chronologique, borné à 50 entrées côté Host.
 */
export class GetOperationLogQuery implements IQuery<OperationLogDto> {}
```

```typescript
// src/Host/Application/Handlers/Packages/GetOperationLogQueryHandler.ts
import { injectable } from "tsyringe";
import { type IQueryHandler } from "@Shared/Abstractions/Messaging/IQueryHandler";
import { HandlerFor } from "@Shared/Infrastructure/Messaging/HandlerFor";
import { GetOperationLogQuery } from "@Shared/Features/Queries/GetOperationLogQuery";
import { type OperationLogDto } from "@Shared/Features/Dtos/OperationLogDto";
import { OperationLogStore } from "@Infrastructure/MsBuild/OperationLogStore";

@injectable()
@HandlerFor(GetOperationLogQuery)
export class GetOperationLogQueryHandler implements IQueryHandler<
  GetOperationLogQuery,
  OperationLogDto
> {
  constructor(private readonly operationLog: OperationLogStore) {}

  async Handle(_query: GetOperationLogQuery): Promise<OperationLogDto> {
    return { entries: this.operationLog.getEntries() };
  }
}
```

- [ ] **Step 2: Câbler DI et WebMediator**

- `DependencyInjection.ts` : import + `this.RegisterClass(GetOperationLogQueryHandler);` dans `ProvidePackages()`.
- `nugetWebviewProvider.ts` : import + `this.webMediator.registerRequestType("GetOperationLogQuery", GetOperationLogQuery);` à la suite de `GetRestoreStatusQuery`.

- [ ] **Step 3: Étendre l'acceptance (test qui échoue d'abord si Steps 1-2 sautés — sinon vérifier qu'il passe pour valider le bout en bout)**

Dans `PackageWrites.acceptance.test.ts` : le test construit déjà les handlers à la main (cf. `new GetRestoreStatusQueryHandler(restoreScheduler)`) — créer un `OperationLogStore` partagé, le passer aux 3 handlers d'écriture et au `RestoreScheduler`, construire `new GetOperationLogQueryHandler(store)`, puis à la FIN du scénario install→upgrade→uninstall existant :

```typescript
const log = await operationLogHandler.Handle(new GetOperationLogQuery());
const writes = log.entries.filter((e) => e.kind === "write");
expect(writes.map((e) => e.operation)).toEqual(["uninstall", "upgrade", "install"]); // anté-chronologique
const restores = log.entries.filter((e) => e.kind === "restore");
expect(restores.length).toBeGreaterThan(0);
expect(restores.every((e) => e.status === "Succeeded")).toBe(true);
expect(log.entries[0].kind).toBe("write"); // la dernière action est l'uninstall… sauf si le
// restore qui la suit s'est déjà terminé : si cette assertion est fragile dans le flux réel du
// test (ordre write/restore dépendant des timers), la remplacer par une vérification d'ordre
// PAR TYPE (writes anté-chronologiques entre eux, restores anté-chronologiques entre eux).
```

- [ ] **Step 4: Suite complète + lint**

Run: `npx jest` puis `npm run lint`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/Shared/Features/Queries/GetOperationLogQuery.ts src/Host/Application/Handlers/Packages/GetOperationLogQueryHandler.ts src/Host/Application/DependencyInjection.ts src/Host/Presentation/nugetWebviewProvider.ts src/Tests/Acceptances/__tests__/PackageWrites.acceptance.test.ts
git commit -m "feat: GetOperationLogQuery - exposition du journal à la webview"
```

---

### Task 5: Coquille à onglets `<nuget-tabs>`

**Files:**
- Create: `src/Web/Features/Shell/NugetTabs.ts`
- Modify: `src/Web/App.ts`
- Modify: `src/Web/i18n/locales/fr.json`, `src/Web/i18n/locales/en.json`

**Interfaces:**
- Consumes: composants `fluent-tabs`/`fluent-tab`/`fluent-tab-panel` (déjà enregistrés dans `Main.ts`), `<packages-view>` existant, `<logs-view>` (Task 6 — à ce stade, l'import `"../Logs/LogsView"` n'existe pas encore : rendre le panneau Logs avec un placeholder `<div>` temporaire qui sera remplacé en Task 6 ; ne PAS importer LogsView dans cette task).
- Produces: `<nuget-tabs>` qui : (1) affiche deux onglets Packages (défaut) / Logs, panneaux jamais démontés ; (2) écoute `show-logs` (`CustomEvent<{ runId: number }>`, bubbles+composed, émis par le bandeau en Task 7) → active Logs et transmet le runId ; (3) écoute `restore-finished` (`CustomEvent` sans detail, émis par PackagesView en Task 7) → notifie le rafraîchissement. Contrat consommé par Tasks 6 et 7.

- [ ] **Step 1: Ajouter les clés i18n**

`fr.json` (au niveau racine, à côté de `"packages"`) :

```json
"tabs": {
  "packages": "Packages",
  "logs": "Logs"
}
```

`en.json` : mêmes clés (`"Packages"`, `"Logs"`).

- [ ] **Step 2: Créer NugetTabs**

```typescript
// src/Web/Features/Shell/NugetTabs.ts
import { html, css, LitElement } from "lit";
import { customElement, state } from "lit/decorators.js";
import { container } from "tsyringe";
import { TranslationService } from "../../Core/Services/TranslationService";
import "../Packages/PackagesView";

/**
 * Coquille à onglets de la webview : Packages (défaut) / Logs. Les deux
 * panneaux restent montés en permanence — l'état de packages-view (sélection,
 * splitter, polling) survit aux changements d'onglet ; fluent-tabs masque
 * simplement le panneau inactif.
 *
 * Navigation croisée : le bandeau d'échec de restore (dans packages-view)
 * émet `show-logs { runId }` (bubbles + composed) → activation de l'onglet
 * Logs + ciblage du run. `restore-finished` (émis par packages-view quand son
 * polling observe un état terminal) → rafraîchissement de logs-view si actif.
 */
@customElement("nuget-tabs")
export class NugetTabs extends LitElement {
  @state() private activeId: "tab-packages" | "tab-logs" = "tab-packages";
  /** Incrémenté à chaque fin de restore observée : logs-view re-fetch si actif. */
  @state() private refreshToken = 0;
  /** runId à cibler dans logs-view à la prochaine activation (consommé puis remis à undefined). */
  @state() private targetRunId?: number;

  private i18n!: TranslationService;
  private unsubscribeI18n?: () => void;

  connectedCallback(): void {
    super.connectedCallback();
    this.i18n = container.resolve(TranslationService);
    this.unsubscribeI18n = this.i18n.subscribe(() => this.requestUpdate());
    this.addEventListener("show-logs", this.onShowLogs as EventListener);
    this.addEventListener("restore-finished", this.onRestoreFinished);
  }

  disconnectedCallback(): void {
    super.disconnectedCallback();
    this.unsubscribeI18n?.();
    this.removeEventListener("show-logs", this.onShowLogs as EventListener);
    this.removeEventListener("restore-finished", this.onRestoreFinished);
  }

  static styles = css`
    :host {
      display: flex;
      flex-direction: column;
      height: 100%;
      width: 100%;
      overflow: hidden;
    }
    fluent-tabs {
      display: flex;
      flex-direction: column;
      height: 100%;
      overflow: hidden;
    }
    fluent-tab-panel {
      display: flex;
      flex: 1;
      min-height: 0;
      overflow: hidden;
      padding: 0;
    }
    fluent-tab-panel[hidden] {
      display: none;
    }
  `;

  private onShowLogs = (e: CustomEvent<{ runId: number }>): void => {
    this.targetRunId = e.detail.runId;
    this.activeId = "tab-logs";
  };

  private onRestoreFinished = (): void => {
    this.refreshToken++;
  };

  private onTabChange(e: Event): void {
    const tabs = e.currentTarget as HTMLElement & { activeid?: string };
    if (tabs.activeid === "tab-packages" || tabs.activeid === "tab-logs") {
      this.activeId = tabs.activeid;
      if (tabs.activeid === "tab-packages") {
        this.targetRunId = undefined;
      }
    }
  }

  render() {
    return html`
      <fluent-tabs activeid=${this.activeId} @change=${this.onTabChange}>
        <fluent-tab id="tab-packages" slot="tab">${this.i18n.t("tabs.packages")}</fluent-tab>
        <fluent-tab id="tab-logs" slot="tab">${this.i18n.t("tabs.logs")}</fluent-tab>
        <fluent-tab-panel slot="tabpanel"><packages-view></packages-view></fluent-tab-panel>
        <fluent-tab-panel slot="tabpanel">
          <!-- Task 6 : remplacé par <logs-view .active=... .refreshToken=... .targetRunId=...> -->
          <div style="padding: 12px;">Logs</div>
        </fluent-tab-panel>
      </fluent-tabs>
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "nuget-tabs": NugetTabs;
  }
}
```

Note d'implémentation : si `fluent-tabs` ne reflète pas la sélection programmatique via l'attribut `activeid` (comportement à vérifier en F5 — connu capricieux selon les versions de `@fluentui/web-components`), piloter la sélection à la main : conserver `fluent-tab`/`fluent-tab-panel` pour le rendu mais gérer `activeid` via la propriété DOM (`tabsEl.activeid = this.activeId` dans `updated()`).

- [ ] **Step 3: Brancher App.ts**

Dans `App.ts` : remplacer l'import `"./Features/Packages/PackagesView"` par `"./Features/Shell/NugetTabs"`, et le render par :

```typescript
render() {
  return html`<div class="content"><nuget-tabs></nuget-tabs></div>`;
}
```

Nettoyage au passage (styles morts d'une ancienne itération, jamais utilisés par le render actuel) : supprimer les blocs CSS `.header`, `.tabs`, `.tab`, `.tab:hover`, `.tab.active`, `.search-box`, `.search-box input`, `.search-box input:focus`, `.list-content`, `.list-panel`, `.details-panel`, `.loading-overlay` — ne garder que `:host` et `.content`.

- [ ] **Step 4: Build + lint + suite**

Run: `npm run build && npm run lint && npx jest`
Expected: PASS (aucun test Jest ne couvre le Web ; le build valide le typage)

- [ ] **Step 5: Commit**

```bash
git add src/Web/Features/Shell/NugetTabs.ts src/Web/App.ts src/Web/i18n/locales/fr.json src/Web/i18n/locales/en.json
git commit -m "feat: Coquille à onglets Packages/Logs dans la webview"
```

---

### Task 6: Vue `<logs-view>`

**Files:**
- Create: `src/Web/Features/Logs/LogsView.ts`
- Modify: `src/Web/Features/Shell/NugetTabs.ts` (remplacer le placeholder)
- Modify: `src/Web/i18n/locales/fr.json`, `src/Web/i18n/locales/en.json`

**Interfaces:**
- Consumes: `GetOperationLogQuery` → `OperationLogDto` (Task 4) via `IDispatcher` ; propriétés `active: boolean`, `refreshToken: number`, `targetRunId?: number` fournies par `<nuget-tabs>` (Task 5) ; icônes existantes `checkIcon`, `crossIcon`, `ellipsisIcon`, `warningIcon`, `plusIcon`, `arrowUpIcon`, `trashIcon` de `../Packages/Icons`.
- Produces: rendu du journal ; dépliage + scroll + surlignage bref de la carte du run ciblé par `targetRunId`.

- [ ] **Step 1: Ajouter les clés i18n**

`fr.json` :

```json
"logs": {
  "empty": "Aucune activité pour le moment",
  "restoreTitle": "Restore — {{solution}}",
  "running": "en cours…",
  "durationSeconds": "{{seconds}} s",
  "exitCode": "code {{code}}",
  "whyTitle": "Chaînes de dépendances (dotnet nuget why)",
  "operation": {
    "install": "Installation",
    "upgrade": "Mise à jour",
    "uninstall": "Désinstallation"
  },
  "filesChanged": "Fichiers modifiés",
  "skipped": "Ignorés",
  "affectedProjects": "{{count}} projet(s)"
}
```

`en.json` : équivalents anglais (`"No activity yet"`, `"Restore — {{solution}}"`, `"running…"`, `"{{seconds}} s"`, `"code {{code}}"`, `"Dependency chains (dotnet nuget why)"`, `"Install"/"Upgrade"/"Uninstall"`, `"Files changed"`, `"Skipped"`, `"{{count}} project(s)"`).

- [ ] **Step 2: Créer LogsView**

```typescript
// src/Web/Features/Logs/LogsView.ts
import { html, css, LitElement, nothing, type PropertyValues } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { container } from "tsyringe";
import { DISPATCHER, type IDispatcher } from "@Shared/Abstractions/Messaging/IDispatcher";
import { type ILogger, LOGGER } from "@/Host/Application/Abstractions/Log/ILogger";
import { GetOperationLogQuery } from "@Shared/Features/Queries/GetOperationLogQuery";
import {
  type OperationLogDto,
  type OperationLogEntryDto,
  type RestoreRunEntryDto,
  type WriteOperationEntryDto,
} from "@Shared/Features/Dtos/OperationLogDto";
import { TranslationService } from "../../Core/Services/TranslationService";
import {
  arrowUpIcon,
  checkIcon,
  crossIcon,
  ellipsisIcon,
  plusIcon,
  trashIcon,
  warningIcon,
} from "../Packages/Icons";

/**
 * Onglet Logs : journal de session anté-chronologique (runs de restore avec
 * sortie complète repliable + opérations d'écriture). Fetch à chaque
 * activation et à chaque `refreshToken` (fin de restore observée par le
 * polling de packages-view) — jamais de polling propre.
 */
@customElement("logs-view")
export class LogsView extends LitElement {
  /** L'onglet Logs est actuellement actif (fourni par nuget-tabs). */
  @property({ type: Boolean }) active = false;
  /** Incrémenté par nuget-tabs à chaque fin de restore : déclenche un re-fetch si actif. */
  @property({ type: Number }) refreshToken = 0;
  /** runId du run de restore à déplier + scroller (navigation depuis le bandeau d'échec). */
  @property({ type: Number }) targetRunId?: number;

  @state() private entries: OperationLogEntryDto[] = [];
  /** Cartes restore actuellement dépliées (clé runId) — préservé entre les re-fetch. */
  @state() private expandedRuns = new Set<number>();
  @state() private highlightedRunId?: number;

  private dispatcher!: IDispatcher;
  private logger!: ILogger;
  private i18n!: TranslationService;
  private unsubscribeI18n?: () => void;
  private highlightTimer?: ReturnType<typeof setTimeout>;

  connectedCallback(): void {
    super.connectedCallback();
    this.dispatcher = container.resolve<IDispatcher>(DISPATCHER.token);
    this.logger = container.resolve<ILogger>(LOGGER.token);
    this.i18n = container.resolve(TranslationService);
    this.unsubscribeI18n = this.i18n.subscribe(() => this.requestUpdate());
  }

  disconnectedCallback(): void {
    super.disconnectedCallback();
    this.unsubscribeI18n?.();
    if (this.highlightTimer) {
      clearTimeout(this.highlightTimer);
    }
  }

  protected updated(changed: PropertyValues<this>): void {
    const becameActive = changed.has("active") && this.active;
    const refreshed = changed.has("refreshToken") && this.active;
    const retargeted = changed.has("targetRunId") && this.targetRunId !== undefined;
    if (becameActive || refreshed || retargeted) {
      void this.load().then(() => {
        if (this.targetRunId !== undefined) {
          this.revealRun(this.targetRunId);
        }
      });
    }
  }

  private async load(): Promise<void> {
    try {
      const dto = (await this.dispatcher.Send(new GetOperationLogQuery())) as OperationLogDto;
      this.entries = dto.entries;
    } catch (error) {
      this.logger.Error("Échec du chargement du journal des opérations", error as Error);
    }
  }

  /** Déplie, scrolle et surligne brièvement la carte du run. runId absent du tampon → no-op. */
  private revealRun(runId: number): void {
    if (!this.entries.some((e) => e.kind === "restore" && e.runId === runId)) {
      return;
    }
    this.expandedRuns = new Set(this.expandedRuns).add(runId);
    this.highlightedRunId = runId;
    if (this.highlightTimer) {
      clearTimeout(this.highlightTimer);
    }
    this.highlightTimer = setTimeout(() => (this.highlightedRunId = undefined), 2_000);
    void this.updateComplete.then(() => {
      this.shadowRoot
        ?.querySelector(`[data-run-id="${runId}"]`)
        ?.scrollIntoView({ block: "start", behavior: "smooth" });
    });
  }

  private toggleRun(runId: number, e: Event): void {
    e.preventDefault();
    const next = new Set(this.expandedRuns);
    if (next.has(runId)) {
      next.delete(runId);
    } else {
      next.add(runId);
    }
    this.expandedRuns = next;
  }

  static styles = css`
    :host {
      display: block;
      flex: 1;
      overflow-y: auto;
      padding: 12px;
      font-size: 12px;
      color: var(--vscode-foreground);
    }
    .empty {
      color: var(--vscode-descriptionForeground);
      text-align: center;
      padding: 24px 0;
    }
    .card {
      border: 1px solid var(--vscode-panel-border);
      border-radius: 4px;
      padding: 8px 10px;
      margin-bottom: 8px;
      transition: background 0.3s;
    }
    .card.highlighted {
      background: var(--vscode-list-hoverBackground);
      border-color: var(--vscode-focusBorder);
    }
    .head {
      display: flex;
      align-items: center;
      gap: 6px;
    }
    .head svg {
      flex: none;
    }
    .head .when {
      margin-left: auto;
      color: var(--vscode-descriptionForeground);
      white-space: nowrap;
    }
    .meta {
      color: var(--vscode-descriptionForeground);
    }
    .succeeded { color: var(--vscode-charts-green); }
    .failed { color: var(--vscode-charts-red); }
    .running { color: var(--vscode-descriptionForeground); }
    summary {
      cursor: pointer;
      list-style: none;
    }
    summary::-webkit-details-marker { display: none; }
    .output {
      margin: 6px 0 0 20px;
      font-family: var(--vscode-editor-font-family, monospace);
      font-size: 11px;
      white-space: pre-wrap;
      overflow-wrap: anywhere;
      max-height: 320px;
      overflow-y: auto;
    }
    .why-title {
      margin: 6px 0 0 20px;
      font-weight: 600;
    }
    .sub {
      margin: 4px 0 0 20px;
    }
  `;

  private formatWhen(iso: string): string {
    return new Date(iso).toLocaleTimeString("fr-FR");
  }

  private renderRestore(entry: RestoreRunEntryDto) {
    const t = this.i18n;
    const statusIcon =
      entry.status === "Succeeded"
        ? checkIcon(14)
        : entry.status === "Failed"
          ? crossIcon(14)
          : ellipsisIcon(14);
    const duration =
      entry.finishedUtc !== undefined
        ? t.t("logs.durationSeconds", {
            seconds: Math.round(
              (new Date(entry.finishedUtc).getTime() - new Date(entry.startedUtc).getTime()) / 1000,
            ),
          })
        : t.t("logs.running");
    const solutionName = entry.solutionPath.split("/").pop() ?? entry.solutionPath;
    const expanded = this.expandedRuns.has(entry.runId);
    return html`<div
      class="card ${this.highlightedRunId === entry.runId ? "highlighted" : ""}"
      data-run-id=${entry.runId}
    >
      <details ?open=${expanded}>
        <summary class="head ${entry.status.toLowerCase()}" @click=${(e: Event) => this.toggleRun(entry.runId, e)}>
          ${statusIcon} ${t.t("logs.restoreTitle", { solution: solutionName })}
          <span class="meta">${duration}${entry.exitCode !== undefined ? html` · ${t.t("logs.exitCode", { code: entry.exitCode })}` : nothing}</span>
          <span class="when">${this.formatWhen(entry.startedUtc)}</span>
        </summary>
        ${entry.whyInsights.length > 0
          ? html`<div class="why-title">${t.t("logs.whyTitle")}</div>
              <div class="output">${entry.whyInsights.join("\n")}</div>`
          : nothing}
        <div class="output">${entry.output.join("\n")}</div>
      </details>
    </div>`;
  }

  private renderWrite(entry: WriteOperationEntryDto) {
    const t = this.i18n;
    const opIcon =
      entry.operation === "install"
        ? plusIcon(14)
        : entry.operation === "upgrade"
          ? arrowUpIcon(14)
          : trashIcon(14);
    const statusIcon = entry.status === "Ok" ? checkIcon(14) : crossIcon(14);
    return html`<div class="card">
      <details>
        <summary class="head ${entry.status === "Ok" ? "succeeded" : "failed"}">
          ${opIcon} ${t.t(`logs.operation.${entry.operation}`)} —
          ${entry.packageId}${entry.version !== undefined ? html`@${entry.version}` : nothing}
          ${statusIcon}
          <span class="meta">${t.t("logs.affectedProjects", { count: entry.affectedProjects.length })}</span>
          <span class="when">${this.formatWhen(entry.timestampUtc)}</span>
        </summary>
        ${entry.error !== undefined
          ? html`<div class="sub failed">${entry.error}</div>`
          : nothing}
        ${entry.filesChanged.length > 0
          ? html`<div class="sub"><strong>${t.t("logs.filesChanged")}</strong> :
              ${entry.filesChanged.map((f) => html`<div>${f}</div>`)}</div>`
          : nothing}
        ${entry.skipped.length > 0
          ? html`<div class="sub"><strong>${t.t("logs.skipped")}</strong> :
              ${entry.skipped.map((s) => html`<div>${warningIcon(11)} ${s.projectPath} — ${s.reason}</div>`)}</div>`
          : nothing}
      </details>
    </div>`;
  }

  render() {
    if (this.entries.length === 0) {
      return html`<div class="empty">${this.i18n.t("logs.empty")}</div>`;
    }
    return html`${this.entries.map((e) =>
      e.kind === "restore" ? this.renderRestore(e) : this.renderWrite(e),
    )}`;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "logs-view": LogsView;
  }
}
```

Notes d'implémentation :
- Les chemins de `solutionPath` peuvent être Windows (`\`) en usage réel : pour extraire le nom de la solution, utiliser `entry.solutionPath.split(/[\\/]/).pop()` plutôt que `split("/")` — corriger le code ci-dessus en ce sens.
- Le `<details ?open=...>` combiné au `@click` du summary avec `preventDefault` garde l'état de dépliage dans `expandedRuns` (source de vérité unique) : nécessaire pour que `revealRun` puisse déplier programmatiquement ET que l'état survive aux re-render.
- `formatWhen` : locale `fr-FR` figée, cohérent avec le reste de l'UI (backlog connu).

- [ ] **Step 3: Remplacer le placeholder dans NugetTabs**

```typescript
import "../Logs/LogsView";
// …
<fluent-tab-panel slot="tabpanel">
  <logs-view
    .active=${this.activeId === "tab-logs"}
    .refreshToken=${this.refreshToken}
    .targetRunId=${this.targetRunId}
  ></logs-view>
</fluent-tab-panel>
```

- [ ] **Step 4: Build + lint + suite**

Run: `npm run build && npm run lint && npx jest`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/Web/Features/Logs/LogsView.ts src/Web/Features/Shell/NugetTabs.ts src/Web/i18n/locales/fr.json src/Web/i18n/locales/en.json
git commit -m "feat: Vue Logs - journal des restores et des écritures"
```

---

### Task 7: Bandeau allégé + navigation vers Logs

**Files:**
- Modify: `src/Web/Features/Packages/WriteStatusBanner.ts`
- Modify: `src/Web/Features/Packages/PackagesView.ts`
- Modify: `src/Web/i18n/locales/fr.json`, `src/Web/i18n/locales/en.json`

**Interfaces:**
- Consumes: contrat d'événements de `<nuget-tabs>` (Task 5) : `show-logs` (`CustomEvent<{ runId: number }>`, bubbles + composed) et `restore-finished` (`CustomEvent<void>`, bubbles + composed).
- Produces: bandeau Failed cliquable qui émet `show-logs` ; `PackagesView` qui émet `restore-finished` quand son polling observe un état terminal.

- [ ] **Step 1: Ajouter les clés i18n**

`fr.json`, dans `"packages"."restore"` :

```json
"viewLogs": "Voir les logs →",
"moreLines": "+{{count}} autres lignes"
```

`en.json` : `"View logs →"`, `"+{{count}} more lines"`.

- [ ] **Step 2: Alléger le bandeau**

Dans `WriteStatusBanner.ts`, remplacer intégralement le `case "Failed"` de `renderRestore()` (supprimer le `<details>` et ses styles associés `details.failed`, `summary`, `.messages`) :

```typescript
case "Failed": {
  const first = this.restore.messages[0];
  const more = this.restore.messages.length - 1;
  return html`<div class="row failed clickable" @click=${this.onShowLogs}>
    ${crossIcon(14)} ${this.i18n.t("packages.restore.failed")}${first !== undefined
      ? html`<span class="first-message"> — ${first}</span>`
      : nothing}
    ${more > 0
      ? html`<span class="more">${this.i18n.t("packages.restore.moreLines", { count: more })}</span>`
      : nothing}
    <span class="view-logs">${this.i18n.t("packages.restore.viewLogs")}</span>
  </div>`;
}
```

Nouvelle méthode + styles :

```typescript
/** Le détail des erreurs vit dans l'onglet Logs : le bandeau en échec navigue vers le run. */
private onShowLogs(): void {
  this.dispatchEvent(
    new CustomEvent("show-logs", {
      detail: { runId: this.restore?.runId ?? 0 },
      bubbles: true,
      composed: true,
    }),
  );
}
```

```css
.clickable {
  cursor: pointer;
}
.first-message {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  min-width: 0;
  flex: 0 1 auto;
}
.more {
  color: var(--vscode-descriptionForeground);
  flex: none;
}
.view-logs {
  margin-left: auto;
  flex: none;
  text-decoration: underline;
  color: var(--vscode-textLink-foreground);
}
```

Le composant reste présentation-pure : il émet un événement DOM, aucun dispatcher.

- [ ] **Step 3: Émettre restore-finished depuis PackagesView**

Dans `startRestorePolling()`, dans la branche `if (terminal && status.runId >= baselineRunId)`, juste avant le traitement `Succeeded` :

```typescript
// L'onglet Logs (nuget-tabs) rafraîchit sa liste quand un restore se termine.
this.dispatchEvent(new CustomEvent("restore-finished", { bubbles: true, composed: true }));
```

- [ ] **Step 4: Build + lint + suite**

Run: `npm run build && npm run lint && npx jest`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/Web/Features/Packages/WriteStatusBanner.ts src/Web/Features/Packages/PackagesView.ts src/Web/i18n/locales/fr.json src/Web/i18n/locales/en.json
git commit -m "feat: Bandeau allégé cliquable - navigation vers l'onglet Logs"
```

---

### Task 8: Vérification manuelle F5 (Victor)

Aucun fichier — checklist à dérouler dans la fenêtre Extension Development Host, sur une solution réelle (ex. CleanAspire) :

- [ ] Les deux onglets s'affichent, Packages actif par défaut ; changer d'onglet ne perd ni la sélection de package ni la largeur du splitter.
- [ ] Onglet Logs vide au démarrage : « Aucune activité pour le moment ».
- [ ] Installer un package → l'onglet Logs montre l'écriture (packageId@version, fichiers, projets) puis le run de restore (Running → Succeeded avec durée), sortie complète dépliable.
- [ ] Provoquer un échec de restore (ex. version inexistante dans le csproj ou package vulnérable avec `NuGetAudit`) → bandeau : première erreur + « +N autres lignes » + « Voir les logs → » ; clic → onglet Logs, carte du run dépliée, scrollée, brièvement surlignée ; les blocs `dotnet nuget why` apparaissent sous « Chaînes de dépendances ».
- [ ] Une écriture pendant un restore en cours : le journal montre les deux runs, chacun avec son statut final.
- [ ] Basculer la langue VS Code en anglais → libellés des onglets et du journal traduits.
- [ ] Sélection programmatique des onglets : vérifier que le clic sur « Voir les logs → » active bien l'onglet Logs (cf. note fluent-tabs de la Task 5) — si non, appliquer le pilotage par propriété DOM décrit dans cette note.
