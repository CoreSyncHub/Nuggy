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

    // Jugé sur la taille de la page BRUTE (rawCount), avant déduplication ET
    // avant le filtrage des entrées non installables fait par la source : ni
    // l'un ni l'autre ne doit pouvoir raccourcir artificiellement le compte et
    // faire conclure à tort à la fin des résultats.
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
