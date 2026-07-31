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
