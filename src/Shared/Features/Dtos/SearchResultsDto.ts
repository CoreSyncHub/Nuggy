export interface PackageSearchHitDto {
  id: string;
  description: string;
  latestVersion: string;
  totalDownloads?: number;
  verified: boolean;
  iconUrl?: string;
  /** Source the result came from. */
  sourceName: string;
}

export interface SearchResultsDto {
  hits: PackageSearchHitDto[];
  /** At least one source returned a full page: "Load more" makes sense. */
  hasMore: boolean;
  /** Sources unreachable during this search. */
  failedSources: string[];
}
