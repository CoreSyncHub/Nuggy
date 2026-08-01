import { singleton } from "tsyringe";
import {
  type IPackageSearchSource,
  type PackageSearchOptions,
  type PackageSearchPage,
} from "@/Host/Application/Abstractions/Search/IPackageSearchSource";
import { NuGetV3ApiClient } from "./NuGetV3ApiClient";

/**
 * nuget.org source: turns the raw V3 client results into stamped hits. Errors
 * are not caught here — PackageSearchService isolates them, so that one broken
 * source never stops the others from serving.
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
