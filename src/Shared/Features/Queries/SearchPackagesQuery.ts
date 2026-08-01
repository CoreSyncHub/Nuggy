import { type IQuery } from "../../Abstractions/Messaging/IQuery";
import { type SearchResultsDto } from "../Dtos/SearchResultsDto";

/**
 * Paginated free-text search across the configured sources.
 */
export class SearchPackagesQuery implements IQuery<SearchResultsDto> {
  constructor(
    public readonly terms: string,
    public readonly skip: number,
    public readonly take: number,
    public readonly includePrerelease: boolean,
  ) {}
}
