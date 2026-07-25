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

  it("appelle le fetcher une seule fois pour deux lectures successives", async () => {
    const fetcher = jest.fn().mockResolvedValue(dto());
    await cache.getOrFetch("X", fetcher);
    await cache.getOrFetch("X", fetcher);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it("dédoublonne les requêtes simultanées (une seule en vol)", async () => {
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

  it("refetch après expiration du TTL (30 min)", async () => {
    const fetcher = jest.fn().mockResolvedValue(dto());
    await cache.getOrFetch("X", fetcher);

    (Date.now as jest.Mock).mockReturnValue(1_000_000 + 31 * 60 * 1000);
    await cache.getOrFetch("X", fetcher);

    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it("ne met pas en cache les résultats en échec", async () => {
    const fetcher = jest
      .fn()
      .mockResolvedValueOnce(dto("Offline"))
      .mockResolvedValueOnce(dto("Ok"));

    expect((await cache.getOrFetch("X", fetcher)).fetchStatus).toBe("Offline");
    expect((await cache.getOrFetch("X", fetcher)).fetchStatus).toBe("Ok");
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it("propage le rejet du fetcher et permet une nouvelle tentative", async () => {
    const fetcher = jest
      .fn()
      .mockRejectedValueOnce(new Error("réseau"))
      .mockResolvedValueOnce(dto());

    await expect(cache.getOrFetch("X", fetcher)).rejects.toThrow("réseau");
    expect((await cache.getOrFetch("X", fetcher)).fetchStatus).toBe("Ok");
    expect(fetcher).toHaveBeenCalledTimes(2);
  });
});
