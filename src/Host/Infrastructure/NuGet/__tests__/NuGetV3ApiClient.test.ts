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

  it("getRegistrationLeaves découvre le service index puis lit la registration", async () => {
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

  it("le service index est mis en cache (un seul fetch pour deux appels)", async () => {
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

  it("searchPackage renvoie les métadonnées", async () => {
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

  it("404 sur la registration → NuGetApiError NotFound", async () => {
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

  it("échec réseau → NuGetApiError Offline", async () => {
    fetchMock.mockRejectedValueOnce(new TypeError("fetch failed"));

    await expect(client.getRegistrationLeaves("X")).rejects.toMatchObject({ kind: "Offline" });
    expect(noOpLogger.Warning).toHaveBeenCalled();
  });

  it("pagination : une page sans items déclenche un fetch de la page dédiée", async () => {
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

  it("le service index est retenté après un échec réseau", async () => {
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

  it("404 sur la recherche → NuGetApiError NotFound", async () => {
    fetchMock
      .mockResolvedValueOnce(okResponse(fixture("service-index.json")))
      .mockResolvedValueOnce({ ok: false, status: 404 } as unknown as Response);

    await expect(client.searchPackage("Paquet.Prive")).rejects.toMatchObject({ kind: "NotFound" });
  });
});
