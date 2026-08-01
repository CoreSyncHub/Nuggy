import { ProjectTfmCache } from "../ProjectTfmCache";

describe("ProjectTfmCache", () => {
  let cache: ProjectTfmCache;

  beforeEach(() => {
    cache = new ProjectTfmCache();
    jest.spyOn(Date, "now").mockReturnValue(1_000_000);
  });

  afterEach(() => jest.restoreAllMocks());

  it("resolves only once for two successive reads of the same solution", async () => {
    const resolver = jest.fn().mockResolvedValue(new Map([["/A.csproj", ["net8.0"]]]));
    await cache.getOrResolve("/Solution/A.sln", resolver);
    await cache.getOrResolve("/Solution/A.sln", resolver);
    expect(resolver).toHaveBeenCalledTimes(1);
  });

  it("resolves separately for two distinct solutions", async () => {
    const resolver = jest.fn().mockResolvedValue(new Map());
    await cache.getOrResolve("/Solution/A.sln", resolver);
    await cache.getOrResolve("/Solution/B.sln", resolver);
    expect(resolver).toHaveBeenCalledTimes(2);
  });

  it("re-resolves after the TTL expires (60 s)", async () => {
    const resolver = jest.fn().mockResolvedValue(new Map());
    await cache.getOrResolve("/Solution/A.sln", resolver);

    (Date.now as jest.Mock).mockReturnValue(1_000_000 + 61 * 1000);
    await cache.getOrResolve("/Solution/A.sln", resolver);

    expect(resolver).toHaveBeenCalledTimes(2);
  });

  it("does not cache a rejected resolver, and allows a retry", async () => {
    const resolver = jest
      .fn()
      .mockRejectedValueOnce(new Error("solution introuvable"))
      .mockResolvedValueOnce(new Map([["/A.csproj", ["net8.0"]]]));

    await expect(cache.getOrResolve("/Solution/A.sln", resolver)).rejects.toThrow(
      "solution introuvable",
    );
    const data = await cache.getOrResolve("/Solution/A.sln", resolver);
    expect(data.get("/A.csproj")).toEqual(["net8.0"]);
    expect(resolver).toHaveBeenCalledTimes(2);
  });

  it("invalidate() drops the entry: the next call re-resolves", async () => {
    const resolver = jest.fn().mockResolvedValue(new Map([["/A.csproj", ["net8.0"]]]));
    await cache.getOrResolve("/Solution/A.sln", resolver);

    cache.invalidate("/Solution/A.sln");
    await cache.getOrResolve("/Solution/A.sln", resolver);

    expect(resolver).toHaveBeenCalledTimes(2);
  });

  it("invalidate() does not affect the other solutions", async () => {
    const resolver = jest.fn().mockResolvedValue(new Map());
    await cache.getOrResolve("/Solution/A.sln", resolver);
    await cache.getOrResolve("/Solution/B.sln", resolver);

    cache.invalidate("/Solution/A.sln");
    await cache.getOrResolve("/Solution/B.sln", resolver);

    expect(resolver).toHaveBeenCalledTimes(2); // A then B, B not re-resolved
  });
});
