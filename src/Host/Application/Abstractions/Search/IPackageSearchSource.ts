import { InjectionToken } from "@/Shared";

/**
 * A search result, stamped by the source that provided it.
 */
export interface PackageSearchHit {
  /**
   * The package ID, which is the unique identifier for the package in the source.
   */
  id: string;
  /**
   * A brief description of the package.
   */
  description: string;
  /**
   * The latest version of the package available in the source.
   */
  latestVersion: string;
  /**
   * The total number of downloads for the package across all versions, if available.
   */
  totalDownloads?: number;
  /**
   * Whether the package is verified by the source, if applicable. This may indicate that the package is from a trusted publisher or has passed certain quality checks.
   */
  verified: boolean;
  /**
   * An optional URL to an icon representing the package, if available. This can be used in UI displays to provide a visual representation of the package.
   */
  iconUrl?: string;
  /** The name of the source that provided the result : displayed, and used to arbitrate duplicates. */
  sourceName: string;
}

/**
 * Options for searching packages, including pagination and pre-release inclusion.
 */
export interface PackageSearchOptions {
  /**
   * The number of results to skip for pagination purposes. This allows the caller to retrieve subsequent pages of results.
   */
  skip: number;
  /**
   * The number of results to take for pagination purposes. This allows the caller to limit the number of results returned in a single query.
   */
  take: number;
  /**
   * Whether to include pre-release versions of packages in the search results. If true, pre-release versions will be included; if false, only stable versions will be returned.
   */
  includePrerelease: boolean;
}

/**
 * A page of search results, stamped by the source that provided it.
 */
export interface PackageSearchPage {
  /**
   * The actual search results, filtered and sorted by the source.
   */
  hits: PackageSearchHit[];
  /**
   * The actual number of items returned by the source before any filtering
   * (e.g., non-installable entries filtered out on the client). The only judge of
   * "the raw page is full": `hits.length` may be shorter once unusable entries
   * are removed, without meaning that there are no more results downstream.
   */
  rawCount: number;
}

/**
 * An interface representing a package search source, which can be queried for packages based on search terms and options.
 * Implementations of this interface can provide search functionality for different package sources, such as NuGet.org or private feeds.
 */
export interface IPackageSearchSource {
  readonly name: string;
  search(terms: string, options: PackageSearchOptions): Promise<PackageSearchPage>;
}

export const PACKAGE_SEARCH_SOURCES = new InjectionToken<IPackageSearchSource>(
  "IPackageSearchSource",
);
