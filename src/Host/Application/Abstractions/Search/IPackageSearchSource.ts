import { InjectionToken } from "@/Shared";

/** Un résultat de recherche, estampillé par la source qui l'a fourni. */
export interface PackageSearchHit {
  id: string;
  description: string;
  latestVersion: string;
  totalDownloads?: number;
  verified: boolean;
  iconUrl?: string;
  /** Nom de la source d'origine : affiché, et utilisé pour arbitrer les doublons. */
  sourceName: string;
}

export interface PackageSearchOptions {
  skip: number;
  take: number;
  includePrerelease: boolean;
}

export interface PackageSearchPage {
  hits: PackageSearchHit[];
  /** Nombre d'éléments réellement renvoyés par la source avant tout filtrage
   *  (par ex. les entrées non installables écartées côté client). Seul juge de
   *  « la page brute est pleine » : `hits.length` peut être plus court une fois
   *  des entrées inutilisables retirées, sans que cela signifie qu'il n'y a
   *  plus de résultats en aval. */
  rawCount: number;
}

/**
 * Une source interrogeable. Une seule implémentation est livrée (nuget.org) ;
 * les feeds privés viendront s'ajouter sans toucher au service ni à l'UI.
 */
export interface IPackageSearchSource {
  readonly name: string;
  search(terms: string, options: PackageSearchOptions): Promise<PackageSearchPage>;
}

export const PACKAGE_SEARCH_SOURCES = new InjectionToken<IPackageSearchSource>(
  "IPackageSearchSource",
);
