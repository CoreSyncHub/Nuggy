# Recherche et ajout de packages NuGet — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Permettre de chercher un package sur nuget.org et de l'installer sur un projet, même lorsqu'il est absent de toute la solution.

**Architecture:** Côté Host, un port `IPackageSearchSource` (une seule implémentation livrée, nuget.org) agrégé par un `PackageSearchService` qui fusionne, déduplique et tolère l'échec d'une source, exposé par une `SearchPackagesQuery`. Côté webview, la liste de gauche gagne un mode « nuget.org » ; la sélection d'un résultat construit un `SolutionPackageDto` synthétique, ce qui permet de réutiliser le panneau de détail et ses cartes projet sans les modifier.

**Tech Stack:** TypeScript, tsyringe (DI), Lit (webview), Jest/ts-jest, CQRS WebMediator maison, API NuGet V3.

**Spec:** `docs/superpowers/specs/2026-07-30-recherche-packages-design.md`

## Global Constraints

- Prettier : guillemets doubles, `printWidth 100` — lancer `npx prettier --write` sur les fichiers touchés avant chaque commit.
- Dépendances de constructeur injectées PAR CLASSE : **imports de valeur obligatoires** (`import { X }`, jamais `import type { X }`) — SWC n'émet pas les `design:paramtypes` sinon. Les interfaces injectées par token peuvent rester `import { type X }`.
- Convention WebMediator : la chaîne passée à `registerRequestType` doit être **exactement** le nom de la classe (RemoteBus envoie `request.constructor.name`).
- Tests : fixtures POSIX ; aucun réseau ni process réel (`fetch` est mocké via `jest.spyOn(globalThis, "fetch")`) ; les suites qui mockent `fs` ajoutent `jest.mock("path", () => jest.requireActual("path").posix);` juste après `jest.mock("fs");`.
- Messages produits côté Host : en français, comme le reste du Host.
- Lit : fragments SVG via le template tag `svg` (jamais `html`) ; les composants résolvent `TranslationService` dans `connectedCallback` et se désabonnent dans `disconnectedCallback`.
- **Aucun badge de compatibilité dans la liste de résultats** : la compatibilité est une propriété du couple package + version, pas du package.
- **Pas d'installation globale** pour un package absent de la solution : `＋` global masqué en mode recherche, `⇧` et `🗑` masqués tant que le package n'est installé nulle part.
- Pagination : `skip`/`take` transmis tels quels à chaque source, jamais recalculés sur le flux fusionné. `hasMore` = au moins une source a renvoyé `take` résultats, jugé **avant** déduplication.
- Suite complète verte à chaque tâche : `npx jest` (392 tests existants + nouveaux), plus `npm run build` et `npm run lint` pour les tâches webview.

---

## File Structure

| Fichier | Responsabilité |
|---|---|
| `src/Host/Application/Abstractions/Search/IPackageSearchSource.ts` | Port : types `PackageSearchHit`, `PackageSearchOptions`, interface de source, token `PACKAGE_SEARCH_SOURCES`. Aucune logique. |
| `src/Host/Infrastructure/NuGet/NuGetV3ApiClient.ts` *(modifié)* | Gagne `searchPackages()` : recherche libre paginée sur le `SearchQueryService`. |
| `src/Host/Infrastructure/NuGet/NuGetOrgSearchSource.ts` | Adaptateur : implémente le port en déléguant au client V3, estampille `sourceName`. |
| `src/Host/Infrastructure/NuGet/PackageSearchService.ts` | Agrégation multi-sources : parallélisme, déduplication, tolérance aux pannes, calcul de `hasMore`. |
| `src/Shared/Features/Dtos/SearchResultsDto.ts` | Contrat de sortie partagé Host/Web. |
| `src/Shared/Features/Queries/SearchPackagesQuery.ts` | Contrat d'entrée. |
| `src/Host/Application/Handlers/Packages/SearchPackagesQueryHandler.ts` | Handler CQRS, mapping service → DTO. |
| `src/Shared/DependencyInjection/inject.ts` *(modifié)* | Gagne `injectAllTokens` (injection d'un tableau d'implémentations). |
| `src/Web/Features/Packages/PackageList.ts` *(modifié)* | Sélecteur de mode, champ de recherche débouncé, rendu des résultats, « Charger plus ». |
| `src/Web/Features/Packages/PackageSearchItem.ts` | Ligne de résultat distant : icône, id, description, téléchargements, badge vérifié. |
| `src/Web/Features/Packages/PackagesView.ts` *(modifié)* | État de recherche, dispatch de la query, `SolutionPackageDto` synthétique. |
| `src/Web/Features/Packages/PackageDetail.ts` *(modifié)* | Masquage conditionnel des trois boutons globaux. |

---

### Task 1: Recherche libre dans le client V3

**Files:**
- Modify: `src/Host/Infrastructure/NuGet/NuGetV3ApiClient.ts`
- Create: `src/Tests/Fixtures/NuGetApi/search-refit.json`
- Test: `src/Host/Infrastructure/NuGet/__tests__/NuGetV3ApiClient.test.ts` (suite existante, à étendre)

**Interfaces:**
- Consumes: `getServiceIndex()` privé existant (découvre `searchQueryUrl`), `fetchJson()` privé existant (erreurs typées `Offline` / `NotFound` / `RateLimited`).
- Produces: `searchPackages(terms: string, options: { skip: number; take: number; includePrerelease: boolean }): Promise<SearchPackagesEntry[]>` et le type exporté `SearchPackagesEntry` — consommés par la Task 2.

- [ ] **Step 1: Créer la fixture de réponse de recherche**

Créer `src/Tests/Fixtures/NuGetApi/search-refit.json` :

```json
{
  "totalHits": 412,
  "data": [
    {
      "id": "Refit",
      "version": "7.0.0",
      "description": "The automatic type-safe REST library for .NET",
      "totalDownloads": 120000000,
      "verified": true,
      "iconUrl": "https://api.nuget.org/v3-flatcontainer/refit/7.0.0/icon"
    },
    {
      "id": "Refit.HttpClientFactory",
      "version": "7.0.0",
      "description": "HttpClientFactory support for Refit",
      "totalDownloads": 80000000,
      "verified": true
    },
    {
      "id": "Refit.Newtonsoft.Json",
      "description": "Newtonsoft.Json support for Refit",
      "totalDownloads": 30000000,
      "verified": false
    }
  ]
}
```

Le troisième résultat n'a volontairement **pas** de `version` : il doit être ignoré.

- [ ] **Step 2: Écrire les tests qui échouent**

Ajouter au `describe("NuGetV3ApiClient")` existant (il fournit déjà `fixture()`, `okResponse()`, `fetchMock` et `client`) :

```typescript
it("searchPackages construit l'URL de recherche paginée et mappe les résultats", async () => {
  fetchMock
    .mockResolvedValueOnce(okResponse(fixture("service-index.json")))
    .mockResolvedValueOnce(okResponse(fixture("search-refit.json")));

  const hits = await client.searchPackages("refit", {
    skip: 0,
    take: 25,
    includePrerelease: false,
  });

  expect(fetchMock.mock.calls[1][0]).toBe(
    "https://azuresearch-usnc.nuget.org/query?q=refit&skip=0&take=25&prerelease=false&semVerLevel=2.0.0",
  );
  expect(hits).toEqual([
    {
      id: "Refit",
      version: "7.0.0",
      description: "The automatic type-safe REST library for .NET",
      totalDownloads: 120000000,
      verified: true,
      iconUrl: "https://api.nuget.org/v3-flatcontainer/refit/7.0.0/icon",
    },
    {
      id: "Refit.HttpClientFactory",
      version: "7.0.0",
      description: "HttpClientFactory support for Refit",
      totalDownloads: 80000000,
      verified: true,
      iconUrl: undefined,
    },
  ]);
});

it("searchPackages encode les termes et transmet la pagination et les préversions", async () => {
  fetchMock
    .mockResolvedValueOnce(okResponse(fixture("service-index.json")))
    .mockResolvedValueOnce(okResponse({ totalHits: 0, data: [] }));

  await client.searchPackages("entity framework", {
    skip: 50,
    take: 25,
    includePrerelease: true,
  });

  expect(fetchMock.mock.calls[1][0]).toBe(
    "https://azuresearch-usnc.nuget.org/query?q=entity%20framework&skip=50&take=25&prerelease=true&semVerLevel=2.0.0",
  );
});

it("searchPackages rend une liste vide quand la réponse n'a pas de data", async () => {
  fetchMock
    .mockResolvedValueOnce(okResponse(fixture("service-index.json")))
    .mockResolvedValueOnce(okResponse({ totalHits: 0 }));

  await expect(
    client.searchPackages("rien", { skip: 0, take: 25, includePrerelease: false }),
  ).resolves.toEqual([]);
});
```

Note : l'URL attendue au premier appel provient de `service-index.json` — vérifier la valeur réelle du `SearchQueryService/3.5.0` dans cette fixture et l'utiliser telle quelle dans l'assertion.

- [ ] **Step 3: Vérifier l'échec**

Run: `npx jest src/Host/Infrastructure/NuGet/__tests__/NuGetV3ApiClient.test.ts`
Expected: FAIL — `client.searchPackages is not a function`

- [ ] **Step 4: Implémenter la méthode**

Ajouter le type exporté près de `SearchResult` :

```typescript
/** Résultat brut du SearchQueryService, avant estampillage par une source. */
export interface SearchPackagesEntry {
  id: string;
  version: string;
  description: string;
  totalDownloads?: number;
  verified: boolean;
  iconUrl?: string;
}
```

Ajouter la méthode publique après `searchPackage` :

```typescript
/**
 * Recherche libre paginée. Contrairement à `searchPackage`, qui résout un id
 * exact, celle-ci sert la liste de résultats de la webview.
 */
public async searchPackages(
  terms: string,
  options: { skip: number; take: number; includePrerelease: boolean },
): Promise<SearchPackagesEntry[]> {
  const { searchQueryUrl } = await this.getServiceIndex();
  const url =
    `${searchQueryUrl}?q=${encodeURIComponent(terms)}` +
    `&skip=${options.skip}&take=${options.take}` +
    `&prerelease=${options.includePrerelease}&semVerLevel=2.0.0`;
  const body = (await this.fetchJson(url)) as { data?: RawSearchEntry[] };
  return (body.data ?? [])
    // Un résultat sans version n'est pas installable : l'écarter ici évite de
    // propager un hit inutilisable jusqu'aux boutons d'installation.
    .filter((entry): entry is RawSearchEntry & { id: string; version: string } =>
      typeof entry.id === "string" && typeof entry.version === "string",
    )
    .map((entry) => ({
      id: entry.id,
      version: entry.version,
      description: entry.description ?? "",
      totalDownloads: entry.totalDownloads,
      verified: entry.verified === true,
      iconUrl: entry.iconUrl,
    }));
}
```

Compléter l'interface privée `RawSearchEntry` en fin de fichier avec les champs manquants :

```typescript
interface RawSearchEntry {
  id?: string;
  version?: string;
  description?: string;
  verified?: boolean;
  authors?: string | string[];
  owners?: string | string[];
  totalDownloads?: number;
  iconUrl?: string;
  projectUrl?: string;
  licenseUrl?: string;
  tags?: string[];
}
```

- [ ] **Step 5: Vérifier le vert et la suite complète**

Run: `npx jest src/Host/Infrastructure/NuGet/__tests__/NuGetV3ApiClient.test.ts` puis `npx jest`
Expected: PASS partout

- [ ] **Step 6: Commit**

```bash
npx prettier --write src/Host/Infrastructure/NuGet/NuGetV3ApiClient.ts src/Host/Infrastructure/NuGet/__tests__/NuGetV3ApiClient.test.ts
git add src/Host/Infrastructure/NuGet src/Tests/Fixtures/NuGetApi/search-refit.json
git commit -m "feat: Recherche libre paginée dans le client NuGet V3"
```

---

### Task 2: Port de source de recherche et adaptateur nuget.org

**Files:**
- Create: `src/Host/Application/Abstractions/Search/IPackageSearchSource.ts`
- Create: `src/Host/Infrastructure/NuGet/NuGetOrgSearchSource.ts`
- Test: `src/Host/Infrastructure/NuGet/__tests__/NuGetOrgSearchSource.test.ts`

**Interfaces:**
- Consumes: `NuGetV3ApiClient.searchPackages(terms, options)` → `SearchPackagesEntry[]` (Task 1).
- Produces: types `PackageSearchHit`, `PackageSearchOptions`, interface `IPackageSearchSource`, token `PACKAGE_SEARCH_SOURCES`, classe `NuGetOrgSearchSource` — consommés par les Tasks 3 et 4.

- [ ] **Step 1: Écrire le port**

```typescript
// src/Host/Application/Abstractions/Search/IPackageSearchSource.ts
import { InjectionToken } from "@/Shared";

/** Un résultat de recherche, estampillé par la source qui l'a fourni. */
export interface PackageSearchHit {
  id: string;
  description: string;
  latestVersion: string;
  totalDownloads?: number;
  verified: boolean;
  iconUrl?: string;
  /** Nom de la source d'origine : affiché, et utilisé pour arbitrer les doublons. */
  sourceName: string;
}

export interface PackageSearchOptions {
  skip: number;
  take: number;
  includePrerelease: boolean;
}

/**
 * Une source interrogeable. Une seule implémentation est livrée (nuget.org) ;
 * les feeds privés viendront s'ajouter sans toucher au service ni à l'UI.
 */
export interface IPackageSearchSource {
  readonly name: string;
  search(terms: string, options: PackageSearchOptions): Promise<PackageSearchHit[]>;
}

export const PACKAGE_SEARCH_SOURCES = new InjectionToken<IPackageSearchSource>(
  "IPackageSearchSource",
);
```

- [ ] **Step 2: Écrire les tests qui échouent**

```typescript
// src/Host/Infrastructure/NuGet/__tests__/NuGetOrgSearchSource.test.ts
import { NuGetOrgSearchSource } from "../NuGetOrgSearchSource";
import { type NuGetV3ApiClient } from "../NuGetV3ApiClient";

function createSource(searchPackages: jest.Mock): NuGetOrgSearchSource {
  return new NuGetOrgSearchSource({ searchPackages } as unknown as NuGetV3ApiClient);
}

describe("NuGetOrgSearchSource", () => {
  it("s'annonce sous le nom nuget.org", () => {
    expect(createSource(jest.fn()).name).toBe("nuget.org");
  });

  it("transmet les termes et les options au client, et estampille la source", async () => {
    const searchPackages = jest.fn().mockResolvedValue([
      {
        id: "Refit",
        version: "7.0.0",
        description: "REST library",
        totalDownloads: 120,
        verified: true,
        iconUrl: "https://example.test/icon",
      },
    ]);
    const source = createSource(searchPackages);

    const hits = await source.search("refit", { skip: 25, take: 25, includePrerelease: true });

    expect(searchPackages).toHaveBeenCalledWith("refit", {
      skip: 25,
      take: 25,
      includePrerelease: true,
    });
    expect(hits).toEqual([
      {
        id: "Refit",
        description: "REST library",
        latestVersion: "7.0.0",
        totalDownloads: 120,
        verified: true,
        iconUrl: "https://example.test/icon",
        sourceName: "nuget.org",
      },
    ]);
  });

  it("laisse remonter l'erreur du client : c'est le service qui décide de l'isoler", async () => {
    const source = createSource(jest.fn().mockRejectedValue(new Error("hors ligne")));
    await expect(
      source.search("refit", { skip: 0, take: 25, includePrerelease: false }),
    ).rejects.toThrow("hors ligne");
  });
});
```

- [ ] **Step 3: Vérifier l'échec**

Run: `npx jest src/Host/Infrastructure/NuGet/__tests__/NuGetOrgSearchSource.test.ts`
Expected: FAIL — module `../NuGetOrgSearchSource` introuvable

- [ ] **Step 4: Implémenter l'adaptateur**

```typescript
// src/Host/Infrastructure/NuGet/NuGetOrgSearchSource.ts
import { singleton } from "tsyringe";
import {
  type IPackageSearchSource,
  type PackageSearchHit,
  type PackageSearchOptions,
} from "@/Host/Application/Abstractions/Search/IPackageSearchSource";
import { NuGetV3ApiClient } from "./NuGetV3ApiClient";

/**
 * Source nuget.org : traduit les résultats bruts du client V3 en hits
 * estampillés. Les erreurs ne sont pas rattrapées ici — PackageSearchService
 * les isole, pour qu'une source en panne n'empêche pas les autres de servir.
 */
@singleton()
export class NuGetOrgSearchSource implements IPackageSearchSource {
  public readonly name = "nuget.org";

  constructor(private readonly apiClient: NuGetV3ApiClient) {}

  public async search(
    terms: string,
    options: PackageSearchOptions,
  ): Promise<PackageSearchHit[]> {
    const entries = await this.apiClient.searchPackages(terms, options);
    return entries.map((entry) => ({
      id: entry.id,
      description: entry.description,
      latestVersion: entry.version,
      totalDownloads: entry.totalDownloads,
      verified: entry.verified,
      iconUrl: entry.iconUrl,
      sourceName: this.name,
    }));
  }
}
```

- [ ] **Step 5: Vérifier le vert et la suite complète**

Run: `npx jest src/Host/Infrastructure/NuGet/__tests__/NuGetOrgSearchSource.test.ts` puis `npx jest`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
npx prettier --write src/Host/Application/Abstractions/Search/IPackageSearchSource.ts src/Host/Infrastructure/NuGet/NuGetOrgSearchSource.ts src/Host/Infrastructure/NuGet/__tests__/NuGetOrgSearchSource.test.ts
git add src/Host/Application/Abstractions/Search src/Host/Infrastructure/NuGet
git commit -m "feat: Port de source de recherche et adaptateur nuget.org"
```

---

### Task 3: Agrégation multi-sources

**Files:**
- Create: `src/Host/Infrastructure/NuGet/PackageSearchService.ts`
- Test: `src/Host/Infrastructure/NuGet/__tests__/PackageSearchService.test.ts`

**Interfaces:**
- Consumes: `IPackageSearchSource` et `PACKAGE_SEARCH_SOURCES` (Task 2), `injectAllTokens` (créé ici).
- Produces: `PackageSearchService.search(terms, options): Promise<PackageSearchOutcome>` avec `PackageSearchOutcome { hits: PackageSearchHit[]; hasMore: boolean; failedSources: string[] }` — consommé par la Task 4.

- [ ] **Step 1: Ajouter le helper d'injection multiple**

Dans `src/Shared/DependencyInjection/inject.ts`, compléter l'import et ajouter la fonction :

```typescript
import { inject as tsyringeInject, injectAll as tsyringeInjectAll } from "tsyringe";

/**
 * Injecte TOUTES les implémentations enregistrées sous un même token, sous
 * forme de tableau. Utilisé là où plusieurs adaptateurs coexistent (sources de
 * recherche), là où `injectToken` n'en résoudrait qu'une.
 */
export function injectAllTokens<T>(token: InjectionToken<T>) {
  return tsyringeInjectAll(token.token);
}
```

- [ ] **Step 2: Écrire les tests qui échouent**

```typescript
// src/Host/Infrastructure/NuGet/__tests__/PackageSearchService.test.ts
import { PackageSearchService } from "../PackageSearchService";
import {
  type IPackageSearchSource,
  type PackageSearchHit,
} from "@/Host/Application/Abstractions/Search/IPackageSearchSource";
import { type ILogger } from "@/Host/Application/Abstractions/Log/ILogger";

const noOpLogger: ILogger = {
  Info: jest.fn(),
  Warning: jest.fn(),
  Error: jest.fn(),
  Debug: jest.fn(),
};

function hit(id: string, sourceName: string): PackageSearchHit {
  return {
    id,
    description: `${id} description`,
    latestVersion: "1.0.0",
    verified: false,
    sourceName,
  };
}

function source(name: string, hits: PackageSearchHit[]): IPackageSearchSource {
  return { name, search: jest.fn().mockResolvedValue(hits) };
}

function failingSource(name: string): IPackageSearchSource {
  return { name, search: jest.fn().mockRejectedValue(new Error("injoignable")) };
}

const OPTIONS = { skip: 0, take: 2, includePrerelease: false };

describe("PackageSearchService", () => {
  it("fusionne les résultats en conservant l'ordre des sources", async () => {
    const service = new PackageSearchService(
      [source("nuget.org", [hit("Refit", "nuget.org")]), source("interne", [hit("Maison", "interne")])],
      noOpLogger,
    );

    const outcome = await service.search("x", OPTIONS);

    expect(outcome.hits.map((h) => h.id)).toEqual(["Refit", "Maison"]);
    expect(outcome.failedSources).toEqual([]);
  });

  it("déduplique par id insensible à la casse, la source prioritaire l'emporte", async () => {
    const service = new PackageSearchService(
      [
        source("nuget.org", [hit("Refit", "nuget.org")]),
        source("interne", [hit("REFIT", "interne"), hit("Maison", "interne")]),
      ],
      noOpLogger,
    );

    const outcome = await service.search("x", OPTIONS);

    expect(outcome.hits.map((h) => h.id)).toEqual(["Refit", "Maison"]);
    expect(outcome.hits[0].sourceName).toBe("nuget.org");
  });

  it("isole une source en échec et nomme celles qui ont échoué", async () => {
    const service = new PackageSearchService(
      [source("nuget.org", [hit("Refit", "nuget.org")]), failingSource("interne")],
      noOpLogger,
    );

    const outcome = await service.search("x", OPTIONS);

    expect(outcome.hits.map((h) => h.id)).toEqual(["Refit"]);
    expect(outcome.failedSources).toEqual(["interne"]);
  });

  it("rend une liste vide et nomme toutes les sources quand aucune ne répond", async () => {
    const service = new PackageSearchService(
      [failingSource("nuget.org"), failingSource("interne")],
      noOpLogger,
    );

    const outcome = await service.search("x", OPTIONS);

    expect(outcome.hits).toEqual([]);
    expect(outcome.failedSources).toEqual(["nuget.org", "interne"]);
    expect(outcome.hasMore).toBe(false);
  });

  it("hasMore vrai dès qu'une source renvoie une page pleine, jugé avant déduplication", async () => {
    // Les deux sources renvoient les MÊMES packages : après déduplication il ne
    // reste que 2 hits pour take=2, mais d'autres résultats existent en aval.
    const service = new PackageSearchService(
      [
        source("nuget.org", [hit("A", "nuget.org"), hit("B", "nuget.org")]),
        source("interne", [hit("a", "interne"), hit("b", "interne")]),
      ],
      noOpLogger,
    );

    const outcome = await service.search("x", OPTIONS);

    expect(outcome.hits).toHaveLength(2);
    expect(outcome.hasMore).toBe(true);
  });

  it("hasMore faux quand aucune source ne remplit sa page", async () => {
    const service = new PackageSearchService([source("nuget.org", [hit("A", "nuget.org")])], noOpLogger);
    await expect(service.search("x", OPTIONS)).resolves.toMatchObject({ hasMore: false });
  });

  it("transmet les mêmes skip et take à chaque source", async () => {
    const first = source("nuget.org", []);
    const second = source("interne", []);
    const service = new PackageSearchService([first, second], noOpLogger);

    await service.search("refit", { skip: 25, take: 25, includePrerelease: true });

    const expected = ["refit", { skip: 25, take: 25, includePrerelease: true }];
    expect(first.search).toHaveBeenCalledWith(...expected);
    expect(second.search).toHaveBeenCalledWith(...expected);
  });
});
```

- [ ] **Step 3: Vérifier l'échec**

Run: `npx jest src/Host/Infrastructure/NuGet/__tests__/PackageSearchService.test.ts`
Expected: FAIL — module `../PackageSearchService` introuvable

- [ ] **Step 4: Implémenter le service**

```typescript
// src/Host/Infrastructure/NuGet/PackageSearchService.ts
import { singleton } from "tsyringe";
import { injectAllTokens } from "@Shared/DependencyInjection/inject";
import {
  PACKAGE_SEARCH_SOURCES,
  type IPackageSearchSource,
  type PackageSearchHit,
  type PackageSearchOptions,
} from "@/Host/Application/Abstractions/Search/IPackageSearchSource";
import { type ILogger, LOGGER } from "@/Host/Application/Abstractions/Log/ILogger";
import { injectToken } from "@Shared/DependencyInjection/inject";

export interface PackageSearchOutcome {
  hits: PackageSearchHit[];
  hasMore: boolean;
  failedSources: string[];
}

/**
 * Interroge toutes les sources en parallèle et sert un résultat unique.
 *
 * Ne jette jamais : une source qui échoue est journalisée et nommée dans
 * `failedSources`, les autres servent quand même. L'UI peut ainsi distinguer
 * « aucun résultat » de « rien n'a pu être interrogé ».
 */
@singleton()
export class PackageSearchService {
  constructor(
    @injectAllTokens(PACKAGE_SEARCH_SOURCES) private readonly sources: IPackageSearchSource[],
    @injectToken(LOGGER) private readonly logger: ILogger,
  ) {}

  public async search(
    terms: string,
    options: PackageSearchOptions,
  ): Promise<PackageSearchOutcome> {
    const settled = await Promise.all(
      this.sources.map(async (source) => {
        try {
          return { name: source.name, hits: await source.search(terms, options) };
        } catch (error) {
          this.logger.Warning("Source de recherche injoignable", {
            source: source.name,
            error: error instanceof Error ? error.message : String(error),
          });
          return { name: source.name, hits: undefined };
        }
      }),
    );

    const failedSources = settled.filter((r) => r.hits === undefined).map((r) => r.name);
    const succeeded = settled.filter(
      (r): r is { name: string; hits: PackageSearchHit[] } => r.hits !== undefined,
    );

    // Jugé AVANT déduplication : deux sources renvoyant les mêmes packages
    // produiraient une page courte et feraient conclure à tort à la fin.
    const hasMore = succeeded.some((r) => r.hits.length >= options.take);

    const seen = new Set<string>();
    const hits: PackageSearchHit[] = [];
    for (const result of succeeded) {
      for (const candidate of result.hits) {
        const key = candidate.id.toLowerCase();
        if (seen.has(key)) {
          continue;
        }
        seen.add(key);
        hits.push(candidate);
      }
    }

    return { hits, hasMore, failedSources };
  }
}
```

- [ ] **Step 5: Vérifier le vert et la suite complète**

Run: `npx jest src/Host/Infrastructure/NuGet/__tests__/PackageSearchService.test.ts` puis `npx jest`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
npx prettier --write src/Host/Infrastructure/NuGet/PackageSearchService.ts src/Host/Infrastructure/NuGet/__tests__/PackageSearchService.test.ts src/Shared/DependencyInjection/inject.ts
git add src/Host/Infrastructure/NuGet src/Shared/DependencyInjection/inject.ts
git commit -m "feat: Agrégation multi-sources des résultats de recherche"
```

---

### Task 4: Query, handler, câblage et acceptance

**Files:**
- Create: `src/Shared/Features/Dtos/SearchResultsDto.ts`
- Create: `src/Shared/Features/Queries/SearchPackagesQuery.ts`
- Create: `src/Host/Application/Handlers/Packages/SearchPackagesQueryHandler.ts`
- Modify: `src/Host/Application/DependencyInjection.ts` (méthode `ProvidePackages`)
- Modify: `src/Host/Infrastructure/DependencyInjection.ts` (enregistrement de la source)
- Modify: `src/Host/Presentation/nugetWebviewProvider.ts` (`registerRequestType`)
- Test: `src/Tests/Acceptances/__tests__/PackageSearch.acceptance.test.ts`

**Interfaces:**
- Consumes: `PackageSearchService.search(terms, options)` → `PackageSearchOutcome` (Task 3), `NuGetOrgSearchSource` et `PACKAGE_SEARCH_SOURCES` (Task 2).
- Produces: `SearchPackagesQuery { terms, skip, take, includePrerelease }` et `SearchResultsDto { hits, hasMore, failedSources }` — consommés par les Tasks 5 et 6.

- [ ] **Step 1: Écrire le contrat partagé**

```typescript
// src/Shared/Features/Dtos/SearchResultsDto.ts
export interface PackageSearchHitDto {
  id: string;
  description: string;
  latestVersion: string;
  totalDownloads?: number;
  verified: boolean;
  iconUrl?: string;
  /** Source d'origine du résultat. */
  sourceName: string;
}

export interface SearchResultsDto {
  hits: PackageSearchHitDto[];
  /** Au moins une source a renvoyé une page pleine : « Charger plus » a du sens. */
  hasMore: boolean;
  /** Sources injoignables lors de cette recherche. */
  failedSources: string[];
}
```

```typescript
// src/Shared/Features/Queries/SearchPackagesQuery.ts
import { type IQuery } from "../../Abstractions/Messaging/IQuery";
import { type SearchResultsDto } from "../Dtos/SearchResultsDto";

/**
 * Recherche libre paginée sur les sources configurées.
 */
export class SearchPackagesQuery implements IQuery<SearchResultsDto> {
  constructor(
    public readonly terms: string,
    public readonly skip: number,
    public readonly take: number,
    public readonly includePrerelease: boolean,
  ) {}
}
```

- [ ] **Step 2: Écrire le handler**

```typescript
// src/Host/Application/Handlers/Packages/SearchPackagesQueryHandler.ts
import { injectable } from "tsyringe";
import { type IQueryHandler } from "@Shared/Abstractions/Messaging/IQueryHandler";
import { HandlerFor } from "@Shared/Infrastructure/Messaging/HandlerFor";
import { SearchPackagesQuery } from "@Shared/Features/Queries/SearchPackagesQuery";
import { type SearchResultsDto } from "@Shared/Features/Dtos/SearchResultsDto";
import { PackageSearchService } from "@Infrastructure/NuGet/PackageSearchService";

@injectable()
@HandlerFor(SearchPackagesQuery)
export class SearchPackagesQueryHandler implements IQueryHandler<
  SearchPackagesQuery,
  SearchResultsDto
> {
  constructor(private readonly searchService: PackageSearchService) {}

  async Handle(query: SearchPackagesQuery): Promise<SearchResultsDto> {
    const outcome = await this.searchService.search(query.terms, {
      skip: query.skip,
      take: query.take,
      includePrerelease: query.includePrerelease,
    });
    return {
      hits: outcome.hits,
      hasMore: outcome.hasMore,
      failedSources: outcome.failedSources,
    };
  }
}
```

- [ ] **Step 3: Câbler DI et WebMediator**

- `src/Host/Application/DependencyInjection.ts` : importer `SearchPackagesQueryHandler` et ajouter `this.RegisterClass(SearchPackagesQueryHandler);` à la fin de `ProvidePackages()`.
- `src/Host/Infrastructure/DependencyInjection.ts` : ajouter la ligne d'enregistrement de la source à la suite des autres, dans `Provide()` :

```typescript
import {
  PACKAGE_SEARCH_SOURCES,
  type IPackageSearchSource,
} from "@Application/Abstractions/Search/IPackageSearchSource";
import { NuGetOrgSearchSource } from "./NuGet/NuGetOrgSearchSource";
// …
    this.Register<IPackageSearchSource>(PACKAGE_SEARCH_SOURCES, NuGetOrgSearchSource);
```

  `PackageSearchService` n'a **rien** à enregistrer : comme `NuGetV3ApiClient`, il porte `@singleton()` et se résout par sa classe. Ce fichier ne contient que des enregistrements token → implémentation, et c'est bien de cela qu'il s'agit pour la source.
- `src/Host/Presentation/nugetWebviewProvider.ts` : importer `SearchPackagesQuery` et ajouter, à la suite de `GetOperationLogQuery` :

```typescript
this.webMediator.registerRequestType("SearchPackagesQuery", SearchPackagesQuery);
```

- [ ] **Step 4: Écrire le test d'acceptance**

```typescript
// src/Tests/Acceptances/__tests__/PackageSearch.acceptance.test.ts
import * as fs from "fs";
jest.mock("fs");
jest.mock("path", () => jest.requireActual("path").posix);
jest.mock(
  "vscode",
  () => ({
    workspace: { findFiles: jest.fn().mockResolvedValue([]) },
    Uri: { file: (p: string) => ({ fsPath: p }) },
  }),
  { virtual: true },
);

import { SearchPackagesQuery } from "@Shared/Features/Queries/SearchPackagesQuery";
import { SearchPackagesQueryHandler } from "@Application/Handlers/Packages/SearchPackagesQueryHandler";
import { PackageSearchService } from "@Infrastructure/NuGet/PackageSearchService";
import { type IPackageSearchSource } from "@/Host/Application/Abstractions/Search/IPackageSearchSource";
import { type ILogger } from "@/Host/Application/Abstractions/Log/ILogger";

const noOpLogger: ILogger = {
  Info: jest.fn(),
  Warning: jest.fn(),
  Error: jest.fn(),
  Debug: jest.fn(),
};

/** Source factice : l'acceptance ne touche jamais le réseau. */
const fakeSource: IPackageSearchSource = {
  name: "nuget.org",
  search: jest.fn().mockResolvedValue([
    {
      id: "Refit",
      description: "REST library",
      latestVersion: "7.0.0",
      totalDownloads: 120,
      verified: true,
      sourceName: "nuget.org",
    },
  ]),
};

describe("Acceptance : recherche de packages", () => {
  it("sert les résultats, la pagination et les sources en échec", async () => {
    const handler = new SearchPackagesQueryHandler(
      new PackageSearchService([fakeSource], noOpLogger),
    );

    const dto = await handler.Handle(new SearchPackagesQuery("refit", 0, 25, false));

    expect(dto.hits).toEqual([
      {
        id: "Refit",
        description: "REST library",
        latestVersion: "7.0.0",
        totalDownloads: 120,
        verified: true,
        sourceName: "nuget.org",
      },
    ]);
    expect(dto.hasMore).toBe(false);
    expect(dto.failedSources).toEqual([]);
    expect(fakeSource.search).toHaveBeenCalledWith("refit", {
      skip: 0,
      take: 25,
      includePrerelease: false,
    });
  });
});
```

Note : `fs` est mocké pour rester aligné sur les autres suites d'acceptance ; ce scénario n'y touche pas.

- [ ] **Step 5: Vérifier le vert, le typage et le lint**

Run: `npx jest` puis `npx tsc --noEmit -p tsconfig.json` puis `npm run lint`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
npx prettier --write src/Shared/Features/Dtos/SearchResultsDto.ts src/Shared/Features/Queries/SearchPackagesQuery.ts src/Host/Application/Handlers/Packages/SearchPackagesQueryHandler.ts src/Tests/Acceptances/__tests__/PackageSearch.acceptance.test.ts
git add src/Shared/Features src/Host/Application src/Host/Infrastructure/DependencyInjection.ts src/Host/Presentation/nugetWebviewProvider.ts src/Tests/Acceptances
git commit -m "feat: SearchPackagesQuery - exposition de la recherche à la webview"
```

---

### Task 5: Mode recherche dans la liste

**Files:**
- Create: `src/Web/Features/Packages/PackageSearchItem.ts`
- Modify: `src/Web/Features/Packages/PackageList.ts`
- Modify: `src/Web/i18n/locales/fr.json`, `src/Web/i18n/locales/en.json`

**Interfaces:**
- Consumes: `PackageSearchHitDto` (Task 4), icônes existantes de `./Icons` (`searchIcon`, `downloadIcon`, `ellipsisIcon`), `verifiedBadgeIcon` et `VERIFIED_BLUE` de `./VerifiedBadgeIcon`, `defaultPackageIcon` de `./DefaultPackageIcon`.
- Produces: `<package-list>` avec les propriétés `mode: "installed" | "search"`, `searchHits: PackageSearchHitDto[]`, `searchLoading: boolean`, `hasMore: boolean`, et les événements `mode-changed` (`{ mode }`), `search-terms-changed` (`{ terms, includePrerelease }`), `load-more` (sans detail), `package-selected` (`{ packageId }`, existant, réutilisé pour les résultats). Consommés par la Task 6.

- [ ] **Step 1: Ajouter les clés i18n**

Dans `fr.json`, sous `packages.list`, ajouter :

```json
"modeInstalled": "Installés",
"modeSearch": "nuget.org",
"searchPlaceholder": "Rechercher sur nuget.org…",
"searchHint": "Saisissez au moins 2 caractères",
"searching": "Recherche…",
"noResults": "Aucun résultat",
"allSourcesFailed": "Aucune source n'a pu être interrogée",
"loadMore": "Charger plus",
"includePrerelease": "Préversions",
"downloads": "{{count}} téléchargements"
```

Dans `en.json`, les mêmes clés : `"Installed"`, `"nuget.org"`, `"Search nuget.org…"`, `"Type at least 2 characters"`, `"Searching…"`, `"No results"`, `"No source could be queried"`, `"Load more"`, `"Prerelease"`, `"{{count}} downloads"`.

- [ ] **Step 2: Créer la ligne de résultat**

```typescript
// src/Web/Features/Packages/PackageSearchItem.ts
import { html, css, LitElement, nothing } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { container } from "tsyringe";
import { type PackageSearchHitDto } from "@Shared/Features/Dtos/SearchResultsDto";
import { TranslationService } from "../../Core/Services/TranslationService";
import { defaultPackageIcon } from "./DefaultPackageIcon";
import { verifiedBadgeIcon, VERIFIED_BLUE } from "./VerifiedBadgeIcon";

/**
 * Ligne de résultat distant. Volontairement sans badge de compatibilité : la
 * compatibilité dépend du couple package + version, et se lit dans le détail.
 */
@customElement("package-search-item")
export class PackageSearchItem extends LitElement {
  @property({ attribute: false }) hit!: PackageSearchHitDto;
  @property({ type: Boolean }) selected = false;

  @state() private iconFailed = false;

  private i18n!: TranslationService;
  private unsubscribeI18n?: () => void;

  connectedCallback(): void {
    super.connectedCallback();
    this.i18n = container.resolve(TranslationService);
    this.unsubscribeI18n = this.i18n.subscribe(() => this.requestUpdate());
  }

  disconnectedCallback(): void {
    super.disconnectedCallback();
    this.unsubscribeI18n?.();
  }

  protected willUpdate(changed: Map<string, unknown>): void {
    if (changed.has("hit")) {
      this.iconFailed = false;
    }
  }

  static styles = css`
    :host {
      display: block;
    }
    .row {
      display: flex;
      gap: 8px;
      padding: 5px 8px;
      cursor: pointer;
      border-radius: 4px;
      color: var(--vscode-foreground);
    }
    .row:hover {
      background: var(--vscode-list-hoverBackground);
    }
    .row.selected {
      background: var(--vscode-list-activeSelectionBackground);
      color: var(--vscode-list-activeSelectionForeground);
    }
    img.icon,
    .row svg.fallback {
      width: 24px;
      height: 24px;
      flex: none;
    }
    .body {
      flex: 1;
      min-width: 0;
      display: flex;
      flex-direction: column;
      gap: 1px;
    }
    .title {
      display: flex;
      align-items: center;
      gap: 4px;
      min-width: 0;
    }
    .id {
      font-weight: 600;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .version {
      flex: none;
      font-size: 11px;
      color: var(--vscode-descriptionForeground);
    }
    .description {
      font-size: 11px;
      color: var(--vscode-descriptionForeground);
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .meta {
      font-size: 10.5px;
      color: var(--vscode-descriptionForeground);
    }
  `;

  render() {
    const downloads =
      this.hit.totalDownloads === undefined
        ? nothing
        : html`<span class="meta"
            >${this.i18n.t("packages.list.downloads", {
              count: this.hit.totalDownloads.toLocaleString("fr-FR"),
            })}</span
          >`;
    return html`<div
      class="row ${this.selected ? "selected" : ""}"
      @click=${() =>
        this.dispatchEvent(
          new CustomEvent("package-selected", {
            detail: { packageId: this.hit.id },
            bubbles: true,
            composed: true,
          }),
        )}
    >
      ${this.iconFailed || !this.hit.iconUrl
        ? defaultPackageIcon(24)
        : html`<img
            class="icon"
            loading="lazy"
            src=${this.hit.iconUrl}
            @error=${() => (this.iconFailed = true)}
          />`}
      <div class="body">
        <div class="title">
          <span class="id">${this.hit.id}</span>
          ${this.hit.verified
            ? verifiedBadgeIcon(VERIFIED_BLUE, 12, this.i18n.t("packages.detail.verifiedTooltip"))
            : nothing}
          <span class="version">${this.hit.latestVersion}</span>
        </div>
        <div class="description">${this.hit.description}</div>
        ${downloads}
      </div>
    </div>`;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "package-search-item": PackageSearchItem;
  }
}
```

Signature exacte, à respecter dans cet ordre : `verifiedBadgeIcon(fill: string, size: number, title: string)`. La clé `packages.detail.verifiedTooltip` existe déjà et sert au même usage dans le détail.

- [ ] **Step 3: Ajouter le mode à la liste**

Dans `PackageList.ts` :

1. Importer `import { type PackageSearchHitDto } from "@Shared/Features/Dtos/SearchResultsDto";` et `import "./PackageSearchItem";`
2. Ajouter les propriétés et l'état :

```typescript
  /** Source de la liste : packages de la solution, ou résultats distants. */
  @property() mode: "installed" | "search" = "installed";
  @property({ attribute: false }) searchHits: PackageSearchHitDto[] = [];
  @property({ type: Boolean }) searchLoading = false;
  @property({ type: Boolean }) hasMore = false;
  /** Aucune source n'a répondu : à distinguer d'une recherche sans résultat,
   *  sous peine de faire croire que le package n'existe pas. */
  @property({ type: Boolean }) allSourcesFailed = false;

  @state() private searchTerms = "";
  @state() private includePrerelease = false;
  private searchDebounce?: ReturnType<typeof setTimeout>;
```

3. Nettoyer le timer dans `disconnectedCallback` :

```typescript
    if (this.searchDebounce) {
      clearTimeout(this.searchDebounce);
    }
```

4. Ajouter les méthodes :

```typescript
  private static readonly SEARCH_DEBOUNCE_MS = 300;
  private static readonly SEARCH_MIN_LENGTH = 2;

  private onModeChanged(mode: "installed" | "search"): void {
    this.mode = mode;
    this.dispatchEvent(
      new CustomEvent("mode-changed", { detail: { mode }, bubbles: true, composed: true }),
    );
  }

  /** Débounce : une frappe rapide ne doit pas déclencher une requête par caractère. */
  private scheduleSearch(): void {
    if (this.searchDebounce) {
      clearTimeout(this.searchDebounce);
    }
    this.searchDebounce = setTimeout(() => {
      if (this.searchTerms.trim().length < PackageList.SEARCH_MIN_LENGTH) {
        return;
      }
      this.dispatchEvent(
        new CustomEvent("search-terms-changed", {
          detail: { terms: this.searchTerms.trim(), includePrerelease: this.includePrerelease },
          bubbles: true,
          composed: true,
        }),
      );
    }, PackageList.SEARCH_DEBOUNCE_MS);
  }
```

5. Remplacer le bloc `render()` par une version qui branche selon le mode. Le filtre d'état de mise à jour n'est rendu qu'en mode `installed` :

```typescript
  render() {
    return html` <div class="filters">
        <select
          @change=${(e: Event) =>
            this.onModeChanged((e.target as HTMLSelectElement).value as "installed" | "search")}
        >
          <option value="installed">${this.i18n.t("packages.list.modeInstalled")}</option>
          <option value="search">${this.i18n.t("packages.list.modeSearch")}</option>
        </select>
        <div class="search-box">
          ${searchIcon(13)}
          <input
            placeholder=${this.mode === "search"
              ? this.i18n.t("packages.list.searchPlaceholder")
              : this.i18n.t("packages.list.filterPlaceholder")}
            .value=${this.mode === "search" ? this.searchTerms : this.filterText}
            @input=${(e: InputEvent) => {
              const value = (e.target as HTMLInputElement).value;
              if (this.mode === "search") {
                this.searchTerms = value;
                this.scheduleSearch();
              } else {
                this.filterText = value;
              }
            }}
          />
        </div>
        ${this.mode === "installed"
          ? html`<select
              @change=${(e: Event) => (this.filterState = (e.target as HTMLSelectElement).value)}
            >
              <option value="all">${this.i18n.t("packages.list.filterAll")}</option>
              <option value="update">${this.i18n.t("packages.list.badge.update")}</option>
              <option value="updatePartial">
                ${this.i18n.t("packages.list.badge.updatePartial")}
              </option>
              <option value="outOfTfm">${this.i18n.t("packages.list.filterOutOfTfm")}</option>
              <option value="upToDate">${this.i18n.t("packages.list.badge.upToDate")}</option>
              <option value="unknown">${this.i18n.t("packages.list.badge.unknown")}</option>
            </select>`
          : html`<label class="prerelease">
              <input
                type="checkbox"
                .checked=${this.includePrerelease}
                @change=${(e: Event) => {
                  this.includePrerelease = (e.target as HTMLInputElement).checked;
                  this.scheduleSearch();
                }}
              />
              ${this.i18n.t("packages.list.includePrerelease")}
            </label>`}
      </div>
      ${this.uninterrogatedFeeds.length > 0
        ? html`<div class="feeds-banner">
            ${warningIcon(12)} ${this.uninterrogatedFeeds.join(", ")}
          </div>`
        : ""}
      <div class="list">
        ${this.mode === "search" ? this.renderSearchResults() : this.renderInstalled()}
      </div>`;
  }

  private renderInstalled() {
    return repeat(
      this.visiblePackages,
      (p) => p.id,
      (p) =>
        html`<package-list-item
          .package=${p}
          .badge=${this.verdictBadges.get(p.id) ?? "loading"}
          .selected=${p.id === this.selectedId}
        ></package-list-item>`,
    );
  }

  private renderSearchResults() {
    if (this.searchTerms.trim().length < PackageList.SEARCH_MIN_LENGTH) {
      return html`<div class="hint">${this.i18n.t("packages.list.searchHint")}</div>`;
    }
    if (this.searchLoading && this.searchHits.length === 0) {
      return html`<div class="hint">${this.i18n.t("packages.list.searching")}</div>`;
    }
    if (this.searchHits.length === 0) {
      return html`<div class="hint">
        ${this.allSourcesFailed
          ? this.i18n.t("packages.list.allSourcesFailed")
          : this.i18n.t("packages.list.noResults")}
      </div>`;
    }
    return html`${repeat(
      this.searchHits,
      (h) => `${h.sourceName}|${h.id}`,
      (h) =>
        html`<package-search-item
          .hit=${h}
          .selected=${h.id === this.selectedId}
        ></package-search-item>`,
    )}
    ${this.hasMore
      ? html`<button
          class="load-more"
          ?disabled=${this.searchLoading}
          @click=${() =>
            this.dispatchEvent(
              new CustomEvent("load-more", { bubbles: true, composed: true }),
            )}
        >
          ${this.searchLoading
            ? this.i18n.t("packages.list.searching")
            : this.i18n.t("packages.list.loadMore")}
        </button>`
      : nothing}`;
  }
```

6. Importer `nothing` depuis `lit` et ajouter les styles :

```css
    .hint {
      padding: 12px 8px;
      font-size: 12px;
      color: var(--vscode-descriptionForeground);
      text-align: center;
    }
    label.prerelease {
      display: flex;
      align-items: center;
      gap: 4px;
      font-size: 11px;
      color: var(--vscode-descriptionForeground);
      white-space: nowrap;
    }
    button.load-more {
      display: block;
      width: calc(100% - 16px);
      margin: 8px;
      padding: 4px;
      background: var(--vscode-button-secondaryBackground);
      color: var(--vscode-button-secondaryForeground);
      border: 1px solid var(--vscode-button-border, transparent);
      border-radius: 4px;
      cursor: pointer;
    }
    button.load-more:disabled {
      opacity: 0.45;
      cursor: default;
    }
```

- [ ] **Step 4: Build, lint et suite**

Run: `npm run build && npm run lint && npx jest`
Expected: PASS (la webview n'est pas couverte par Jest ; le build valide le typage)

- [ ] **Step 5: Commit**

```bash
npx prettier --write src/Web/Features/Packages/PackageList.ts src/Web/Features/Packages/PackageSearchItem.ts src/Web/i18n/locales/fr.json src/Web/i18n/locales/en.json
git add src/Web
git commit -m "feat: Mode recherche nuget.org dans la liste des packages"
```

---

### Task 6: État de recherche et détail d'un package absent

**Files:**
- Modify: `src/Web/Features/Packages/PackagesView.ts`
- Modify: `src/Web/Features/Packages/PackageDetail.ts`
- Modify: `src/Web/i18n/locales/fr.json`, `src/Web/i18n/locales/en.json`

**Interfaces:**
- Consumes: `SearchPackagesQuery` et `SearchResultsDto` (Task 4) ; les propriétés `mode`, `searchHits`, `searchLoading`, `hasMore`, `allSourcesFailed` et les événements `mode-changed`, `search-terms-changed`, `load-more`, `package-selected` de `<package-list>` (Task 5).
- Produces: rien pour une tâche ultérieure (dernière tâche de code).

**Rien à changer dans `onWriteCommand`** : il appelle déjà `loadPackages()` après une écriture réussie, ce qui remplit `this.data`. `selectedSearchPackage` y retrouve alors le package fraîchement installé et sert ses installations réelles — la carte projet passe de candidat à installé sans code supplémentaire.

- [ ] **Step 1: Ajouter la clé i18n du bandeau des sources en échec**

Dans `fr.json`, sous `packages.list`, ajouter `"failedSources": "Sources injoignables : {{names}}"`. Dans `en.json` : `"Unreachable sources: {{names}}"`.

- [ ] **Step 2: Porter l'état de recherche dans PackagesView**

Ajouter les imports :

```typescript
import { SearchPackagesQuery } from "@Shared/Features/Queries/SearchPackagesQuery";
import {
  type PackageSearchHitDto,
  type SearchResultsDto,
} from "@Shared/Features/Dtos/SearchResultsDto";
```

Ajouter l'état :

```typescript
  private static readonly SEARCH_PAGE_SIZE = 25;

  @state() private mode: "installed" | "search" = "installed";
  @state() private searchHits: PackageSearchHitDto[] = [];
  @state() private searchLoading = false;
  @state() private searchHasMore = false;
  @state() private searchFailedSources: string[] = [];
  private searchTerms = "";
  private searchPrerelease = false;
  /** Invalide les réponses d'une recherche périmée : seule la dernière frappe compte. */
  private searchGeneration = 0;
```

Ajouter les méthodes :

```typescript
  private onModeChanged(mode: "installed" | "search"): void {
    this.mode = mode;
    // La sélection courante n'a pas de sens d'un mode à l'autre : un id installé
    // n'est pas forcément dans les résultats, et inversement.
    this.selectedId = "";
    this.selectedInfo = undefined;
    this.lastWriteResult = undefined;
  }

  private onSearchTermsChanged(terms: string, includePrerelease: boolean): void {
    this.searchTerms = terms;
    this.searchPrerelease = includePrerelease;
    this.searchHits = [];
    void this.runSearch(0);
  }

  private onLoadMore(): void {
    void this.runSearch(this.searchHits.length);
  }

  /** Une génération périmée est ignorée à l'arrivée : pas de résultat en retard
   *  qui écraserait ceux d'une frappe plus récente. */
  private async runSearch(skip: number): Promise<void> {
    const generation = ++this.searchGeneration;
    this.searchLoading = true;
    try {
      const dto = (await this.dispatcher.Send(
        new SearchPackagesQuery(
          this.searchTerms,
          skip,
          PackagesView.SEARCH_PAGE_SIZE,
          this.searchPrerelease,
        ),
      )) as SearchResultsDto;
      if (generation !== this.searchGeneration) {
        return;
      }
      this.searchHits = skip === 0 ? dto.hits : [...this.searchHits, ...dto.hits];
      this.searchHasMore = dto.hasMore;
      this.searchFailedSources = dto.failedSources;
    } catch (error) {
      if (generation !== this.searchGeneration) {
        return;
      }
      this.logger.Error("Échec de la recherche de packages", error as Error);
      this.searchHasMore = false;
    } finally {
      if (generation === this.searchGeneration) {
        this.searchLoading = false;
      }
    }
  }

  /**
   * DTO synthétique pour un résultat de recherche : reprend les installations
   * réelles si le package est déjà dans la solution, sinon aucune. Le détail et
   * ses cartes projet fonctionnent alors sans modification.
   */
  private get selectedSearchPackage(): SolutionPackageDto | undefined {
    const hit = this.searchHits.find((h) => h.id === this.selectedId);
    if (!hit) {
      return undefined;
    }
    const existing = this.data?.packages.find(
      (p) => p.id.toLowerCase() === hit.id.toLowerCase(),
    );
    return {
      id: hit.id,
      iconUrl: hit.iconUrl ?? existing?.iconUrl ?? "",
      installations: existing?.installations ?? [],
    };
  }
```

- [ ] **Step 3: Brancher le rendu**

Dans `render()`, remplacer le calcul de `selected` et le câblage de `<package-list>` :

```typescript
  render() {
    const selected =
      this.mode === "search"
        ? this.selectedSearchPackage
        : this.data?.packages.find((p) => p.id === this.selectedId);
    const feeds =
      this.searchFailedSources.length > 0
        ? [
            ...(this.data?.uninterrogatedFeeds ?? []),
            this.i18n.t("packages.list.failedSources", {
              names: this.searchFailedSources.join(", "),
            }),
          ]
        : (this.data?.uninterrogatedFeeds ?? []);
    return html` <package-list
        .packages=${this.data?.packages ?? []}
        .verdictBadges=${this.verdictBadges}
        .uninterrogatedFeeds=${feeds}
        .selectedId=${this.selectedId}
        .mode=${this.mode}
        .searchHits=${this.searchHits}
        .searchLoading=${this.searchLoading}
        .hasMore=${this.searchHasMore}
        .allSourcesFailed=${this.searchFailedSources.length > 0 && this.searchHits.length === 0}
        style="width: ${this.listWidth}px"
        @package-selected=${this.onPackageSelected}
        @mode-changed=${(e: CustomEvent<{ mode: "installed" | "search" }>) =>
          this.onModeChanged(e.detail.mode)}
        @search-terms-changed=${(e: CustomEvent<{ terms: string; includePrerelease: boolean }>) =>
          this.onSearchTermsChanged(e.detail.terms, e.detail.includePrerelease)}
        @load-more=${() => this.onLoadMore()}
      ></package-list>
```

Puis, sur `<package-detail>`, ajouter la propriété qui pilote le masquage des boutons globaux :

```typescript
              .searchMode=${this.mode === "search"}
```

- [ ] **Step 4: Masquer les boutons globaux dans le détail**

Dans `PackageDetail.ts`, ajouter la propriété :

```typescript
  /** En mode recherche, l'installation globale d'un package absent de la solution
   *  est volontairement indisponible : ajouter une dépendance à tous les projets
   *  d'un coup est rarement l'intention, et se défait projet par projet. */
  @property({ type: Boolean }) searchMode = false;
```

Ajouter le getter :

```typescript
  private get isInstalledSomewhere(): boolean {
    return this.package.installations.length > 0;
  }
```

Puis conditionner les trois boutons de la toolbar : envelopper le bouton `＋` global dans `${this.searchMode ? nothing : html\`…\`}`, et les boutons `⇧` et `🗑` dans `${this.searchMode && !this.isInstalledSomewhere ? nothing : html\`…\`}`.

- [ ] **Step 5: Build, lint et suite**

Run: `npm run build && npm run lint && npx jest`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
npx prettier --write src/Web/Features/Packages/PackagesView.ts src/Web/Features/Packages/PackageDetail.ts src/Web/i18n/locales/fr.json src/Web/i18n/locales/en.json
git add src/Web
git commit -m "feat: Installation d'un package trouvé par recherche"
```

---

### Task 7: Vérification manuelle F5 (Victor)

Aucun fichier — checklist à dérouler dans la fenêtre Extension Development Host, sur une solution réelle :

- [ ] Le sélecteur bascule entre Installés et nuget.org ; le filtre d'état de mise à jour n'apparaît qu'en mode Installés, la case Préversions qu'en mode recherche.
- [ ] Taper un caractère n'appelle rien ; à partir de deux, les résultats arrivent après une courte pause. Taper vite ne produit qu'une seule requête finale.
- [ ] Un résultat affiche icône, id, version, description et nombre de téléchargements — et **aucun** badge de compatibilité.
- [ ] « Charger plus » ajoute une page à la suite sans réinitialiser la liste, et disparaît en fin de résultats.
- [ ] Sélectionner un résultat absent de la solution ouvre le détail : versions, dépendances, et toutes les cartes projet en candidat avec `＋`. Les boutons globaux `＋`, `⇧` et `🗑` sont absents.
- [ ] Installer sur un projet écrit bien le `.csproj`, déclenche le restore, et la carte passe de candidat à installé avec sa version — sans quitter les résultats de recherche.
- [ ] Rechercher un package **déjà installé** montre ses installations réelles dans le détail, et les boutons `⇧` / `🗑` réapparaissent.
- [ ] Couper le réseau puis rechercher : le bandeau signale la source injoignable, sans faire croire à une absence de résultats.
- [ ] Basculer la langue VS Code en anglais : libellés du mode, du champ, des états vides et du bouton traduits.
