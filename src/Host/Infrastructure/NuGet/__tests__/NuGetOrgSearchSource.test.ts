import { NuGetOrgSearchSource } from "../NuGetOrgSearchSource";
import { type NuGetV3ApiClient } from "../NuGetV3ApiClient";

function createSource(searchPackages: jest.Mock): NuGetOrgSearchSource {
  return new NuGetOrgSearchSource({ searchPackages } as unknown as NuGetV3ApiClient);
}

describe("NuGetOrgSearchSource", () => {
  it("announces itself under the nuget.org name", () => {
    expect(createSource(jest.fn()).name).toBe("nuget.org");
  });

  it("passes the terms and options to the client, and stamps the source", async () => {
    const searchPackages = jest.fn().mockResolvedValue({
      entries: [
        {
          id: "Refit",
          version: "7.0.0",
          description: "REST library",
          totalDownloads: 120,
          verified: true,
          iconUrl: "https://example.test/icon",
        },
      ],
      rawCount: 1,
    });
    const source = createSource(searchPackages);

    const page = await source.search("refit", { skip: 25, take: 25, includePrerelease: true });

    expect(searchPackages).toHaveBeenCalledWith("refit", {
      skip: 25,
      take: 25,
      includePrerelease: true,
    });
    expect(page.hits).toEqual([
      {
        id: "Refit",
        description: "REST library",
        latestVersion: "7.0.0",
        totalDownloads: 120,
        verified: true,
        iconUrl: "https://example.test/icon",
        sourceName: "nuget.org",
      },
    ]);
    expect(page.rawCount).toBe(1);
  });

  it("propagates the client rawCount as is, even when entries were filtered client-side", async () => {
    // The client returns 2 usable entries but rawCount=3: an entry without a
    // version was dropped upstream. The source must pass that RAW rawCount along
    // without recomputing it from the surviving hits.
    const searchPackages = jest.fn().mockResolvedValue({
      entries: [
        { id: "Refit", version: "7.0.0", description: "REST library", verified: true },
        { id: "Refit.Xml", version: "7.0.0", description: "Xml support", verified: false },
      ],
      rawCount: 3,
    });
    const source = createSource(searchPackages);

    const page = await source.search("refit", { skip: 0, take: 25, includePrerelease: false });

    expect(page.hits).toHaveLength(2);
    expect(page.rawCount).toBe(3);
  });

  it("lets the client error propagate: it is the service that decides to isolate it", async () => {
    const source = createSource(jest.fn().mockRejectedValue(new Error("hors ligne")));
    await expect(
      source.search("refit", { skip: 0, take: 25, includePrerelease: false }),
    ).rejects.toThrow("hors ligne");
  });
});
