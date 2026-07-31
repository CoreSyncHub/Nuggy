import { NuGetOrgSearchSource } from "../NuGetOrgSearchSource";
import { type NuGetV3ApiClient } from "../NuGetV3ApiClient";

function createSource(searchPackages: jest.Mock): NuGetOrgSearchSource {
  return new NuGetOrgSearchSource({ searchPackages } as unknown as NuGetV3ApiClient);
}

describe("NuGetOrgSearchSource", () => {
  it("s'annonce sous le nom nuget.org", () => {
    expect(createSource(jest.fn()).name).toBe("nuget.org");
  });

  it("transmet les termes et les options au client, et estampille la source", async () => {
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

  it("propage rawCount du client tel quel, même quand des entrées ont été filtrées côté client", async () => {
    // Le client renvoie 2 entrées exploitables mais rawCount=3 : une entrée
    // sans version a été écartée en amont. La source doit transmettre ce
    // rawCount BRUT sans le recalculer sur les hits survivants.
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

  it("laisse remonter l'erreur du client : c'est le service qui décide de l'isoler", async () => {
    const source = createSource(jest.fn().mockRejectedValue(new Error("hors ligne")));
    await expect(
      source.search("refit", { skip: 0, take: 25, includePrerelease: false }),
    ).rejects.toThrow("hors ligne");
  });
});
