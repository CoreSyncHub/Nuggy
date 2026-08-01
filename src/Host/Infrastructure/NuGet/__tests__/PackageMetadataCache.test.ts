import { PackageMetadataCache } from "../PackageMetadataCache";
import { type PackageUpdateInfoDto } from "@Shared/Features/Dtos/PackageUpdateInfoDto";

function dto(status: PackageUpdateInfoDto["fetchStatus"] = "Ok"): PackageUpdateInfoDto {
  return {
    id: "X",
    verified: false,
    isMicrosoft: false,
    authors: "",
    tags: [],
    links: { nugetPage: "" },
    versions: [],
    fetchStatus: status,
  };
}

describe("PackageMetadataCache", () => {
  let cache: PackageMetadataCache;

  beforeEach(() => {
    cache = new PackageMetadataCache();
    jest.spyOn(Date, "now").mockReturnValue(1_000_000);
  });

  afterEach(() => jest.restoreAllMocks());

  it("calls the fetcher only once for two successive reads", async () => {
    const fetcher = jest.fn().mockResolvedValue(dto());
    await cache.getOrFetch("X", fetcher);
    await cache.getOrFetch("X", fetcher);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it("deduplicates simultaneous requests (a single one in flight)", async () => {
    let resolveFetch!: (v: PackageUpdateInfoDto) => void;
    const fetcher = jest.fn().mockReturnValue(
      new Promise((r) => {
        resolveFetch = r;
      }),
    );

    const p1 = cache.getOrFetch("X", fetcher);
    const p2 = cache.getOrFetch("X", fetcher);
    resolveFetch(dto());

    expect(await p1).toEqual(await p2);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it("refetches after the TTL expires (30 min)", async () => {
    const fetcher = jest.fn().mockResolvedValue(dto());
    await cache.getOrFetch("X", fetcher);

    (Date.now as jest.Mock).mockReturnValue(1_000_000 + 31 * 60 * 1000);
    await cache.getOrFetch("X", fetcher);

    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it("does not cache failed results", async () => {
    const fetcher = jest
      .fn()
      .mockResolvedValueOnce(dto("Offline"))
      .mockResolvedValueOnce(dto("Ok"));

    expect((await cache.getOrFetch("X", fetcher)).fetchStatus).toBe("Offline");
    expect((await cache.getOrFetch("X", fetcher)).fetchStatus).toBe("Ok");
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it("propagates the fetcher rejection and allows a retry", async () => {
    const fetcher = jest
      .fn()
      .mockRejectedValueOnce(new Error("network"))
      .mockResolvedValueOnce(dto());

    await expect(cache.getOrFetch("X", fetcher)).rejects.toThrow("network");
    expect((await cache.getOrFetch("X", fetcher)).fetchStatus).toBe("Ok");
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it("invalidate() drops the entry: the next call refetches", async () => {
    const fetcher = jest.fn().mockResolvedValue(dto());
    await cache.getOrFetch("X", fetcher);

    cache.invalidate("X");
    await cache.getOrFetch("X", fetcher);

    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it("invalidate() does not affect the other keys", async () => {
    const fetcher = jest.fn().mockResolvedValue(dto());
    await cache.getOrFetch("X", fetcher);
    await cache.getOrFetch("Y", fetcher);

    cache.invalidate("X");
    await cache.getOrFetch("Y", fetcher);

    expect(fetcher).toHaveBeenCalledTimes(2); // X then Y, Y not refetched
  });

  it("invalidate() also clears an in-flight request: a new request does not await the old promise", async () => {
    let resolveFirst!: (v: PackageUpdateInfoDto) => void;
    const firstFetcher = jest.fn().mockReturnValue(
      new Promise<PackageUpdateInfoDto>((r) => {
        resolveFirst = r;
      }),
    );
    const p1 = cache.getOrFetch("X", firstFetcher);

    cache.invalidate("X");

    const secondFetcher = jest.fn().mockResolvedValue(dto());
    const p2 = cache.getOrFetch("X", secondFetcher);

    resolveFirst(dto());
    await p1;

    expect(await p2).toEqual(dto());
    expect(secondFetcher).toHaveBeenCalledTimes(1);
  });
});
