import { singleton } from 'tsyringe';
import { type ILogger, LOGGER } from '../../Application/Abstractions/Log/ILogger';
import { injectToken } from '@Shared/DependencyInjection/inject';

export type NuGetApiErrorKind = 'Offline' | 'NotFound' | 'RateLimited';

export class NuGetApiError extends Error {
  constructor(public readonly kind: NuGetApiErrorKind, message: string) {
    super(message);
    this.name = 'NuGetApiError';
  }
}

export interface RegistrationDependency { id: string; versionRange: string; }
export interface RegistrationDependencyGroup { targetFramework: string; dependencies: RegistrationDependency[]; }
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

const SERVICE_INDEX_URL = 'https://api.nuget.org/v3/index.json';
const REQUEST_TIMEOUT_MS = 10_000;

/**
 * Client minimal pour l'API NuGet V3 (nuget.org uniquement en v1).
 * Découvre les URLs des ressources via le service index (contrat officiel V3).
 */
@singleton()
export class NuGetV3ApiClient {
  private serviceIndexPromise?: Promise<{ registrationsBaseUrl: string; searchQueryUrl: string }>;

  constructor(@injectToken(LOGGER) private readonly logger: ILogger) {}

  public async getRegistrationLeaves(packageId: string): Promise<RegistrationLeaf[]> {
    const { registrationsBaseUrl } = await this.getServiceIndex();
    const url = `${registrationsBaseUrl}${packageId.toLowerCase()}/index.json`;
    const index = (await this.fetchJson(url)) as {
      items?: Array<{ '@id'?: string; items?: Array<{ catalogEntry: RawCatalogEntry }> }>;
    };

    const leaves: RegistrationLeaf[] = [];
    for (const page of index.items ?? []) {
      // Les grosses registrations paginent : items absent → charger la page
      const pageItems =
        page.items ??
        ((await this.fetchJson(page['@id'] as string)) as { items: Array<{ catalogEntry: RawCatalogEntry }> }).items;
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
    if (!entry) return undefined;

    return {
      verified: entry.verified === true,
      authors: Array.isArray(entry.authors) ? entry.authors.join(', ') : (entry.authors ?? ''),
      owners: Array.isArray(entry.owners) ? entry.owners : entry.owners ? [entry.owners] : [],
      totalDownloads: entry.totalDownloads,
      iconUrl: entry.iconUrl,
      projectUrl: entry.projectUrl,
      licenseUrl: entry.licenseUrl,
      tags: entry.tags ?? [],
    };
  }

  private getServiceIndex(): Promise<{ registrationsBaseUrl: string; searchQueryUrl: string }> {
    this.serviceIndexPromise ??= (async () => {
      const body = (await this.fetchJson(SERVICE_INDEX_URL)) as {
        resources: Array<{ '@id': string; '@type': string }>;
      };
      const find = (type: string) => body.resources.find((r) => r['@type'] === type)?.['@id'];
      // Préférer la registration SemVer 2 (3.6.0) : l'endpoint non versionné est
      // SemVer 1 et renvoie 404 pour les packages dont toutes les versions sont
      // SemVer 2 (préversions à identifiants pointés comme 1.14.0-beta.1).
      const registrationsBaseUrl =
        find('RegistrationsBaseUrl/3.6.0') ??
        find('RegistrationsBaseUrl/3.4.0') ??
        find('RegistrationsBaseUrl');
      const searchQueryUrl = find('SearchQueryService/3.5.0') ?? find('SearchQueryService');
      if (!registrationsBaseUrl || !searchQueryUrl) {
        throw new NuGetApiError('Offline', 'Service index nuget.org incomplet');
      }
      return { registrationsBaseUrl, searchQueryUrl };
    })();
    // En cas d'échec, permettre une nouvelle tentative au prochain appel
    this.serviceIndexPromise.catch(() => { this.serviceIndexPromise = undefined; });
    return this.serviceIndexPromise;
  }

  private async fetchJson(url: string): Promise<unknown> {
    let response: Response;
    try {
      response = await fetch(url, { signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });
    } catch (error) {
      this.logger.Warning('NuGet API unreachable', { url, error });
      throw new NuGetApiError('Offline', `nuget.org injoignable : ${url}`);
    }
    if (response.status === 404) throw new NuGetApiError('NotFound', `404 : ${url}`);
    if (response.status === 429) throw new NuGetApiError('RateLimited', `429 : ${url}`);
    if (!response.ok) {
      this.logger.Warning('NuGet API error status', { url, status: response.status });
      throw new NuGetApiError('Offline', `HTTP ${response.status} : ${url}`);
    }
    return response.json();
  }

  private toLeaf(entry: RawCatalogEntry): RegistrationLeaf {
    return {
      version: entry.version,
      publishedUtc: entry.published,
      listed: entry.listed !== false,
      dependencyGroups: (entry.dependencyGroups ?? []).map((g) => ({
        targetFramework: g.targetFramework ?? '',
        dependencies: (g.dependencies ?? []).map((d) => ({ id: d.id, versionRange: d.range ?? '' })),
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
  verified?: boolean;
  authors?: string | string[];
  owners?: string | string[];
  totalDownloads?: number;
  iconUrl?: string;
  projectUrl?: string;
  licenseUrl?: string;
  tags?: string[];
}
