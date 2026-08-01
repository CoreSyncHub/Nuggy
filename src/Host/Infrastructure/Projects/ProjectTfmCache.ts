import { singleton } from "tsyringe";

const TTL_MS = 60 * 1000;

/**
 * In-memory cache of project TFMs resolved per solution (60 s TTL). Avoids
 * re-parsing the solution file and re-resolving every .csproj for EVERY package
 * queried (otherwise O(packages × projects) of disk work per view). The TTL is
 * short because these resolutions depend on files that may change between two
 * user interactions. Failed resolutions are never cached, so they are retried
 * on the next call.
 *
 * Registered as a tsyringe singleton: unlike handlers (resolved transiently on
 * each request through the container), this cache has to survive across
 * requests to be of any use — hence its extraction into an injected service
 * rather than an instance field on the handler.
 */
@singleton()
export class ProjectTfmCache {
  private readonly entries = new Map<string, { data: Map<string, string[]>; fetchedAt: number }>();

  public async getOrResolve(
    solutionPath: string,
    resolver: () => Promise<Map<string, string[]>>,
  ): Promise<Map<string, string[]>> {
    const cached = this.entries.get(solutionPath);
    if (cached && Date.now() - cached.fetchedAt < TTL_MS) {
      return cached.data;
    }

    const data = await resolver();
    this.entries.set(solutionPath, { data, fetchedAt: Date.now() });
    return data;
  }

  /** Drops the cached entry for this solution. */
  public invalidate(key: string): void {
    this.entries.delete(key);
  }
}
