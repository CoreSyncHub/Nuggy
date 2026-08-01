import { singleton } from "tsyringe";
import { type PackageUpdateInfoDto } from "@Shared/Features/Dtos/PackageUpdateInfoDto";

const TTL_MS = 30 * 60 * 1000;

/**
 * In-memory cache of nuget.org metadata: 30 min TTL, in-flight request
 * deduplication. Failed results (fetchStatus !== 'Ok') are not kept, so they are
 * retried.
 */
@singleton()
export class PackageMetadataCache {
  private readonly entries = new Map<string, { data: PackageUpdateInfoDto; fetchedAt: number }>();
  private readonly inFlight = new Map<string, Promise<PackageUpdateInfoDto>>();

  public async getOrFetch(
    key: string,
    fetcher: () => Promise<PackageUpdateInfoDto>,
  ): Promise<PackageUpdateInfoDto> {
    const cached = this.entries.get(key);
    if (cached && Date.now() - cached.fetchedAt < TTL_MS) {
      return cached.data;
    }

    const pending = this.inFlight.get(key);
    if (pending) {
      return pending;
    }

    const promise = fetcher()
      .then((data) => {
        if (data.fetchStatus === "Ok") {
          this.entries.set(key, { data, fetchedAt: Date.now() });
        }
        return data;
      })
      .finally(() => this.inFlight.delete(key));

    this.inFlight.set(key, promise);
    return promise;
  }

  /** Drops the cached entry (and any in-flight request) for this key. */
  public invalidate(key: string): void {
    this.entries.delete(key);
    this.inFlight.delete(key);
  }
}
