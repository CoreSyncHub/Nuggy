import { singleton } from "tsyringe";
import {
  type IPackageSearchSource,
  type PackageSearchOptions,
  type PackageSearchPage,
} from "@/Host/Application/Abstractions/Search/IPackageSearchSource";
import { NuGetV3ApiClient } from "./NuGetV3ApiClient";

/**
 * Source nuget.org : traduit les résultats bruts du client V3 en hits
 * estampillés. Les erreurs ne sont pas rattrapées ici — PackageSearchService
 * les isole, pour qu'une source en panne n'empêche pas les autres de servir.
 */
@singleton()
export class NuGetOrgSearchSource implements IPackageSearchSource {
  public readonly name = "nuget.org";

  constructor(private readonly apiClient: NuGetV3ApiClient) {}

  public async search(terms: string, options: PackageSearchOptions): Promise<PackageSearchPage> {
    const { entries, rawCount } = await this.apiClient.searchPackages(terms, options);
    return {
      hits: entries.map((entry) => ({
        id: entry.id,
        description: entry.description,
        latestVersion: entry.version,
        totalDownloads: entry.totalDownloads,
        verified: entry.verified,
        iconUrl: entry.iconUrl,
        sourceName: this.name,
      })),
      rawCount,
    };
  }
}
