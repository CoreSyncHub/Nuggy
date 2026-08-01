import { singleton } from "tsyringe";
import { injectAllTokens } from "@Shared/DependencyInjection/inject";
import {
  PACKAGE_SEARCH_SOURCES,
  type IPackageSearchSource,
  type PackageSearchHit,
  type PackageSearchOptions,
  type PackageSearchPage,
} from "@/Host/Application/Abstractions/Search/IPackageSearchSource";
import { type ILogger, LOGGER } from "@/Host/Application/Abstractions/Log/ILogger";
import { injectToken } from "@Shared/DependencyInjection/inject";

export interface PackageSearchOutcome {
  hits: PackageSearchHit[];
  hasMore: boolean;
  failedSources: string[];
}

/**
 * Queries every source in parallel and serves a single result.
 *
 * Never throws: a failing source is logged and named in `failedSources`, the
 * others still serve. The UI can therefore tell "no results" apart from
 * "nothing could be queried".
 */
@singleton()
export class PackageSearchService {
  constructor(
    @injectAllTokens(PACKAGE_SEARCH_SOURCES) private readonly sources: IPackageSearchSource[],
    @injectToken(LOGGER) private readonly logger: ILogger,
  ) {}

  public async search(terms: string, options: PackageSearchOptions): Promise<PackageSearchOutcome> {
    const settled = await Promise.all(
      this.sources.map(async (source) => {
        try {
          return { name: source.name, page: await source.search(terms, options) };
        } catch (error) {
          this.logger.Warning("Source de recherche injoignable", {
            source: source.name,
            error: error instanceof Error ? error.message : String(error),
          });
          return { name: source.name, page: undefined };
        }
      }),
    );

    const failedSources = settled.filter((r) => r.page === undefined).map((r) => r.name);
    const succeeded = settled.filter(
      (r): r is { name: string; page: PackageSearchPage } => r.page !== undefined,
    );

    // Judged on the RAW page size (rawCount), before deduplication AND before the
    // source filters out non-installable entries: neither may artificially shorten
    // the count and wrongly suggest the results have run out.
    const hasMore = succeeded.some((r) => r.page.rawCount >= options.take);

    const seen = new Set<string>();
    const hits: PackageSearchHit[] = [];
    for (const result of succeeded) {
      for (const candidate of result.page.hits) {
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
