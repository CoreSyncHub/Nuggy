import * as fs from "fs";
import * as path from "path";
import { NuGetV3ApiClient, NuGetApiError } from "../NuGetV3ApiClient";
import { type ILogger } from "@/Host/Application/Abstractions/Log/ILogger";

const noOpLogger: ILogger = {
  Info: jest.fn(),
  Warning: jest.fn(),
  Error: jest.fn(),
  Debug: jest.fn(),
};

function fixture(name: string): unknown {
  return JSON.parse(
    fs.readFileSync(path.resolve(__dirname, "../../../../Tests/Fixtures/NuGetApi", name), "utf8"),
  );
}

function okResponse(body: unknown): Response {
  return { ok: true, status: 200, json: async () => body } as unknown as Response;
}

describe("NuGetV3ApiClient", () => {
  let client: NuGetV3ApiClient;
  let fetchMock: jest.SpyInstance;

  beforeEach(() => {
    client = new NuGetV3ApiClient(noOpLogger);
    fetchMock = jest.spyOn(globalThis, "fetch");
  });

  afterEach(() => jest.restoreAllMocks());

  it("getRegistrationLeaves discovers the service index then reads the registration", async () => {
    fetchMock
      .mockResolvedValueOnce(okResponse(fixture("service-index.json")))
      .mockResolvedValueOnce(okResponse(fixture("registration-newtonsoft.json.bson.json")));

    const leaves = await client.getRegistrationLeaves("Newtonsoft.Json.Bson");

    expect(fetchMock.mock.calls[0][0]).toBe("https://api.nuget.org/v3/index.json");
    expect(fetchMock.mock.calls[1][0]).toBe(
      "https://api.nuget.org/v3/registration5-gz-semver2/newtonsoft.json.bson/index.json",
    );
    expect(leaves).toHaveLength(3);
    expect(leaves[1].version).toBe("1.0.3");
    expect(leaves[1].dependencyGroups).toHaveLength(3);
    expect(leaves[1].dependencyGroups[0].dependencies[0].versionRange).toBe("[13.0.1, )");
  });

  it("the service index is cached (a single fetch for two calls)", async () => {
    fetchMock
      .mockResolvedValueOnce(okResponse(fixture("service-index.json")))
      .mockResolvedValueOnce(okResponse(fixture("registration-newtonsoft.json.bson.json")))
      .mockResolvedValueOnce(okResponse(fixture("registration-newtonsoft.json.bson.json")));

    await client.getRegistrationLeaves("Newtonsoft.Json.Bson");
    await client.getRegistrationLeaves("Newtonsoft.Json.Bson");

    const indexCalls = fetchMock.mock.calls.filter(
      (c) => c[0] === "https://api.nuget.org/v3/index.json",
    );
    expect(indexCalls).toHaveLength(1);
  });

  it("searchPackage returns the metadata", async () => {
    fetchMock
      .mockResolvedValueOnce(okResponse(fixture("service-index.json")))
      .mockResolvedValueOnce(okResponse(fixture("search-newtonsoft.json.bson.json")));

    const result = await client.searchPackage("Newtonsoft.Json.Bson");

    expect(fetchMock.mock.calls[1][0]).toBe(
      "https://azuresearch-usnc.nuget.org/query?q=packageid:newtonsoft.json.bson&prerelease=true&semVerLevel=2.0.0&take=1",
    );
    expect(result).toEqual({
      verified: true,
      authors: "James Newton-King",
      owners: ["jamesnk", "newtonsoft"],
      totalDownloads: 47312456,
      iconUrl: "https://api.nuget.org/v3-flatcontainer/newtonsoft.json.bson/1.0.3/icon",
      projectUrl: "https://github.com/JamesNK/Newtonsoft.Json.Bson",
      licenseUrl: "https://licenses.nuget.org/MIT",
      tags: ["bson", "json", "serializer"],
    });
  });

  it("404 on the registration → NuGetApiError NotFound", async () => {
    fetchMock
      .mockResolvedValueOnce(okResponse(fixture("service-index.json")))
      .mockResolvedValueOnce({ ok: false, status: 404 } as unknown as Response);

    await expect(client.getRegistrationLeaves("Paquet.Prive")).rejects.toMatchObject({
      kind: "NotFound",
    });
  });

  it("429 → NuGetApiError RateLimited", async () => {
    fetchMock
      .mockResolvedValueOnce(okResponse(fixture("service-index.json")))
      .mockResolvedValueOnce({ ok: false, status: 429 } as unknown as Response);

    await expect(client.getRegistrationLeaves("X")).rejects.toMatchObject({ kind: "RateLimited" });
  });

  it("network failure → NuGetApiError Offline", async () => {
    fetchMock.mockRejectedValueOnce(new TypeError("fetch failed"));

    await expect(client.getRegistrationLeaves("X")).rejects.toMatchObject({ kind: "Offline" });
    expect(noOpLogger.Warning).toHaveBeenCalled();
  });

  it("pagination: a page without items triggers a fetch of the dedicated page", async () => {
    const pageUrl =
      "https://api.nuget.org/v3/registration5-gz-semver2/big.package/page/1.0.0/2.0.0.json";
    const registrationIndex = {
      count: 1,
      items: [{ "@id": pageUrl, lower: "1.0.0", upper: "2.0.0" }],
    };
    const pageContent = {
      items: [
        {
          catalogEntry: {
            id: "Big.Package",
            version: "1.5.0",
            published: "2023-01-01T00:00:00Z",
            listed: true,
            dependencyGroups: [],
          },
        },
      ],
    };

    fetchMock
      .mockResolvedValueOnce(okResponse(fixture("service-index.json")))
      .mockResolvedValueOnce(okResponse(registrationIndex))
      .mockResolvedValueOnce(okResponse(pageContent));

    const leaves = await client.getRegistrationLeaves("Big.Package");

    expect(fetchMock.mock.calls[2][0]).toBe(pageUrl);
    expect(leaves).toHaveLength(1);
    expect(leaves[0].version).toBe("1.5.0");
  });

  it("the service index is retried after a network failure", async () => {
    fetchMock.mockRejectedValueOnce(new TypeError("fetch failed"));

    await expect(client.getRegistrationLeaves("Newtonsoft.Json.Bson")).rejects.toMatchObject({
      kind: "Offline",
    });

    fetchMock
      .mockResolvedValueOnce(okResponse(fixture("service-index.json")))
      .mockResolvedValueOnce(okResponse(fixture("registration-newtonsoft.json.bson.json")));

    const leaves = await client.getRegistrationLeaves("Newtonsoft.Json.Bson");

    expect(leaves).toHaveLength(3);
    const indexCalls = fetchMock.mock.calls.filter(
      (c) => c[0] === "https://api.nuget.org/v3/index.json",
    );
    expect(indexCalls).toHaveLength(2);
  });

  it("404 on the search → NuGetApiError NotFound", async () => {
    fetchMock
      .mockResolvedValueOnce(okResponse(fixture("service-index.json")))
      .mockResolvedValueOnce({ ok: false, status: 404 } as unknown as Response);

    await expect(client.searchPackage("Paquet.Prive")).rejects.toMatchObject({ kind: "NotFound" });
  });

  it("searchPackages builds the paginated search URL and maps the results", async () => {
    fetchMock
      .mockResolvedValueOnce(okResponse(fixture("service-index.json")))
      .mockResolvedValueOnce(okResponse(fixture("search-refit.json")));

    const page = await client.searchPackages("refit", {
      skip: 0,
      take: 25,
      includePrerelease: false,
    });

    expect(fetchMock.mock.calls[1][0]).toBe(
      "https://azuresearch-usnc.nuget.org/query?q=refit&skip=0&take=25&prerelease=false&semVerLevel=2.0.0",
    );
    expect(page.entries).toEqual([
      {
        id: "Refit",
        version: "7.0.0",
        description: "The automatic type-safe REST library for .NET",
        totalDownloads: 120000000,
        verified: true,
        iconUrl: "https://api.nuget.org/v3-flatcontainer/refit/7.0.0/icon",
      },
      {
        id: "Refit.HttpClientFactory",
        version: "7.0.0",
        description: "HttpClientFactory support for Refit",
        totalDownloads: 80000000,
        verified: true,
        iconUrl: undefined,
      },
    ]);
    // The fixture holds 3 raw entries, one of them without a version (hence not
    // installable, filtered out of `entries`): rawCount must stay at 3, the only
    // judge of whether the page is full — not the post-filter length.
    expect(page.rawCount).toBe(3);
  });

  it("searchPackages encodes the terms and passes pagination and prereleases through", async () => {
    fetchMock
      .mockResolvedValueOnce(okResponse(fixture("service-index.json")))
      .mockResolvedValueOnce(okResponse({ totalHits: 0, data: [] }));

    await client.searchPackages("entity framework", {
      skip: 50,
      take: 25,
      includePrerelease: true,
    });

    expect(fetchMock.mock.calls[1][0]).toBe(
      "https://azuresearch-usnc.nuget.org/query?q=entity%20framework&skip=50&take=25&prerelease=true&semVerLevel=2.0.0",
    );
  });

  it("searchPackages returns an empty list when the response has no data", async () => {
    fetchMock
      .mockResolvedValueOnce(okResponse(fixture("service-index.json")))
      .mockResolvedValueOnce(okResponse({ totalHits: 0 }));

    await expect(
      client.searchPackages("rien", { skip: 0, take: 25, includePrerelease: false }),
    ).resolves.toEqual({ entries: [], rawCount: 0 });
  });
});
