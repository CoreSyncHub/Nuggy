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
