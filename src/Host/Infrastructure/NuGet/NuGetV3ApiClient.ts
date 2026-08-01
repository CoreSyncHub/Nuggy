import { singleton } from "tsyringe";
import { type ILogger, LOGGER } from "../../Application/Abstractions/Log/ILogger";
import { injectToken } from "@Shared/DependencyInjection/inject";

export type NuGetApiErrorKind = "Offline" | "NotFound" | "RateLimited";

export class NuGetApiError extends Error {
  constructor(
    public readonly kind: NuGetApiErrorKind,
    message: string,
  ) {
    super(message);
    this.name = "NuGetApiError";
  }
}

export interface RegistrationDependency {
  id: string;
  versionRange: string;
}
export interface RegistrationDependencyGroup {
  targetFramework: string;
  dependencies: RegistrationDependency[];
}
export interface RegistrationLeaf {
  version: string;
  publishedUtc?: string;
  listed: boolean;
  dependencyGroups: RegistrationDependencyGroup[];
}
export interface SearchResult {
  verified: boolean;
  authors: string;
  owners: string[];
  totalDownloads?: number;
  iconUrl?: string;
  projectUrl?: string;
  licenseUrl?: string;
  tags: string[];
}
/** Raw SearchQueryService result, before a source stamps its origin on it. */
export interface SearchPackagesEntry {
  id: string;
  version: string;
  description: string;
  totalDownloads?: number;
  verified: boolean;
  iconUrl?: string;
}

export interface SearchPackagesPage {
  entries: SearchPackagesEntry[];
  /** Length of the `data` array received from the API, before entries without
   *  `id`/`version` are filtered out: the only judge of whether the raw page is full. */
  rawCount: number;
}

const SERVICE_INDEX_URL = "https://api.nuget.org/v3/index.json";
const REQUEST_TIMEOUT_MS = 10_000;

/**
 * Minimal client for the NuGet V3 API (nuget.org only in v1).
 * Discovers resource URLs through the service index (official V3 contract).
 */
@singleton()
export class NuGetV3ApiClient {
  private serviceIndexPromise?: Promise<{ registrationsBaseUrl: string; searchQueryUrl: string }>;

  constructor(@injectToken(LOGGER) private readonly logger: ILogger) {}

  public async getRegistrationLeaves(packageId: string): Promise<RegistrationLeaf[]> {
    const { registrationsBaseUrl } = await this.getServiceIndex();
    const url = `${registrationsBaseUrl}${packageId.toLowerCase()}/index.json`;
    const index = (await this.fetchJson(url)) as {
      items?: Array<{ "@id"?: string; items?: Array<{ catalogEntry: RawCatalogEntry }> }>;
    };

    const leaves: RegistrationLeaf[] = [];
    for (const page of index.items ?? []) {
      // Large registrations are paginated: items missing → load the page
      const pageItems =
        page.items ??
        (
          (await this.fetchJson(page["@id"] as string)) as {
            items: Array<{ catalogEntry: RawCatalogEntry }>;
          }
        ).items;
      for (const item of pageItems) {
        leaves.push(this.toLeaf(item.catalogEntry));
      }
    }
    return leaves;
  }

  public async searchPackage(packageId: string): Promise<SearchResult | undefined> {
    const { searchQueryUrl } = await this.getServiceIndex();
    const url = `${searchQueryUrl}?q=packageid:${packageId.toLowerCase()}&prerelease=true&semVerLevel=2.0.0&take=1`;
    const body = (await this.fetchJson(url)) as { data?: RawSearchEntry[] };
    const entry = body.data?.[0];
    if (!entry) {
      return undefined;
    }

    return {
      verified: entry.verified === true,
      authors: Array.isArray(entry.authors) ? entry.authors.join(", ") : (entry.authors ?? ""),
      owners: Array.isArray(entry.owners) ? entry.owners : entry.owners ? [entry.owners] : [],
      totalDownloads: entry.totalDownloads,
      iconUrl: entry.iconUrl,
      projectUrl: entry.projectUrl,
      licenseUrl: entry.licenseUrl,
      tags: entry.tags ?? [],
    };
  }

  /**
   * Paginated free-text search. Unlike `searchPackage`, which resolves an exact
   * id, this one feeds the webview result list.
   */
  public async searchPackages(
    terms: string,
    options: { skip: number; take: number; includePrerelease: boolean },
  ): Promise<SearchPackagesPage> {
    const { searchQueryUrl } = await this.getServiceIndex();
    const url =
      `${searchQueryUrl}?q=${encodeURIComponent(terms)}` +
      `&skip=${options.skip}&take=${options.take}` +
      `&prerelease=${options.includePrerelease}&semVerLevel=2.0.0`;
    const body = (await this.fetchJson(url)) as { data?: RawSearchEntry[] };
    const rawEntries = body.data ?? [];
    const entries = rawEntries
      // A result without a version is not installable: dropping it here avoids
      // propagating an unusable hit all the way to the install buttons. The count
      // BEFORE this filter is kept separately (rawCount): that is what judges whether
      // the raw page is full, not the number of surviving entries.
      .filter(
        (entry): entry is RawSearchEntry & { id: string; version: string } =>
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
    return { entries, rawCount: rawEntries.length };
  }

  private getServiceIndex(): Promise<{ registrationsBaseUrl: string; searchQueryUrl: string }> {
    this.serviceIndexPromise ??= (async () => {
      const body = (await this.fetchJson(SERVICE_INDEX_URL)) as {
        resources: Array<{ "@id": string; "@type": string }>;
      };
      const find = (type: string) => body.resources.find((r) => r["@type"] === type)?.["@id"];
      // Prefer the SemVer 2 registration (3.6.0): the unversioned endpoint is
      // SemVer 1 and returns 404 for packages whose versions are all SemVer 2
      // (prereleases with dotted identifiers such as 1.14.0-beta.1).
      const registrationsBaseUrl =
        find("RegistrationsBaseUrl/3.6.0") ??
        find("RegistrationsBaseUrl/3.4.0") ??
        find("RegistrationsBaseUrl");
      const searchQueryUrl = find("SearchQueryService/3.5.0") ?? find("SearchQueryService");
      if (!registrationsBaseUrl || !searchQueryUrl) {
        throw new NuGetApiError("Offline", "Service index nuget.org incomplet");
      }
      return { registrationsBaseUrl, searchQueryUrl };
    })();
    // On failure, allow a fresh attempt on the next call
    this.serviceIndexPromise.catch(() => {
      this.serviceIndexPromise = undefined;
    });
    return this.serviceIndexPromise;
  }

  private async fetchJson(url: string): Promise<unknown> {
    let response: Response;
    try {
      response = await fetch(url, { signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });
    } catch (error) {
      this.logger.Warning("NuGet API unreachable", { url, error });
      throw new NuGetApiError("Offline", `nuget.org injoignable : ${url}`);
    }
    if (response.status === 404) {
      throw new NuGetApiError("NotFound", `404 : ${url}`);
    }
    if (response.status === 429) {
      throw new NuGetApiError("RateLimited", `429 : ${url}`);
    }
    if (!response.ok) {
      this.logger.Warning("NuGet API error status", { url, status: response.status });
      throw new NuGetApiError("Offline", `HTTP ${response.status} : ${url}`);
    }
    return response.json();
  }

  private toLeaf(entry: RawCatalogEntry): RegistrationLeaf {
    return {
      version: entry.version,
      publishedUtc: entry.published,
      listed: entry.listed !== false,
      dependencyGroups: (entry.dependencyGroups ?? []).map((g) => ({
        targetFramework: g.targetFramework ?? "",
        dependencies: (g.dependencies ?? []).map((d) => ({
          id: d.id,
          versionRange: d.range ?? "",
        })),
      })),
    };
  }
}

interface RawCatalogEntry {
  version: string;
  published?: string;
  listed?: boolean;
  dependencyGroups?: Array<{
    targetFramework?: string;
    dependencies?: Array<{ id: string; range?: string }>;
  }>;
}
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
