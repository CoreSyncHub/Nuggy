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
