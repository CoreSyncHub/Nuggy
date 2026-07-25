import * as fs from "fs";
jest.mock("fs");
// Force POSIX path semantics so the mocked-fs fixtures behave identically on
// every OS (path.win32.join would rewrite '/' to '\\' and break exact-string
// mocks). Platform-specific production code uses path.win32 explicitly.
jest.mock("path", () => jest.requireActual("path").posix);
jest.mock(
  "vscode",
  () => ({
    workspace: { findFiles: jest.fn().mockResolvedValue([]) },
    Uri: { file: (p: string) => ({ fsPath: p }) },
  }),
  { virtual: true },
);

import { GetPackageUpdateInfoQuery } from "@Shared/Features/Queries/GetPackageUpdateInfoQuery";
import {
  GetPackageUpdateInfoQueryHandler,
  compareVersionsDesc,
} from "../GetPackageUpdateInfoQueryHandler";
import { PackageMetadataCache } from "@Infrastructure/NuGet/PackageMetadataCache";
import {
  NuGetApiError,
  type NuGetV3ApiClient,
  type RegistrationLeaf,
  type SearchResult,
} from "@Infrastructure/NuGet/NuGetV3ApiClient";
import { TfmCompatibilityService } from "@Infrastructure/Projects/TfmCompatibilityService";
import { SlnParser } from "@Infrastructure/Solution/SlnParser";
import { SlnxParser } from "@Infrastructure/Solution/SlnxParser";
import { BuildConfigDetector } from "@Infrastructure/Build/BuildConfigDetector";
import { BuildConfigParser } from "@Infrastructure/Build/BuildConfigParser";
import { CsprojParser } from "@Infrastructure/Projects/CsprojParser";
import { TfmResolver } from "@Infrastructure/Projects/TfmResolver";
import { ProjectTfmCache } from "@Infrastructure/Projects/ProjectTfmCache";
import { type ILogger } from "@/Host/Application/Abstractions/Log/ILogger";

const mockFs = fs as jest.Mocked<typeof fs>;
const noOpLogger: ILogger = {
  Info: jest.fn(),
  Warning: jest.fn(),
  Error: jest.fn(),
  Debug: jest.fn(),
};

const SLN = `Microsoft Visual Studio Solution File, Format Version 12.00
Project("{FAE04EC0-301F-11D3-BF4B-00C04F79EFBC}") = "Api", "Api\\Api.csproj", "{11111111-1111-1111-1111-111111111111}"
EndProject
Project("{FAE04EC0-301F-11D3-BF4B-00C04F79EFBC}") = "Legacy", "Legacy\\Legacy.csproj", "{22222222-2222-2222-2222-222222222222}"
EndProject
`;

// Solution distincte, un seul projet, pour vérifier l'isolation par solutionPath (clé de cache et TFM).
const SLN2 = `Microsoft Visual Studio Solution File, Format Version 12.00
Project("{FAE04EC0-301F-11D3-BF4B-00C04F79EFBC}") = "Api", "Api\\Api.csproj", "{33333333-3333-3333-3333-333333333333}"
EndProject
`;

const API_CSPROJ = `<Project Sdk="Microsoft.NET.Sdk">
  <PropertyGroup><TargetFramework>net8.0</TargetFramework></PropertyGroup>
</Project>`;

const LEGACY_CSPROJ = `<Project ToolsVersion="15.0">
  <PropertyGroup><TargetFrameworkVersion>v4.7.2</TargetFrameworkVersion></PropertyGroup>
</Project>`;

const LEAVES: RegistrationLeaf[] = [
  {
    version: "1.0.2",
    publishedUtc: "2019-04-21T14:44:00Z",
    listed: true,
    dependencyGroups: [
      {
        targetFramework: ".NETStandard2.0",
        dependencies: [{ id: "Newtonsoft.Json", versionRange: "[12.0.1, )" }],
      },
    ],
  },
  {
    version: "2.0.0",
    publishedUtc: "2024-06-08T10:00:00Z",
    listed: true,
    dependencyGroups: [{ targetFramework: "net6.0", dependencies: [] }],
  },
  {
    version: "2.1.0-beta.1",
    publishedUtc: "2024-09-01T10:00:00Z",
    listed: true,
    dependencyGroups: [],
  },
  { version: "0.9.0", listed: false, dependencyGroups: [] },
];

const SEARCH: SearchResult = {
  verified: true,
  authors: "James Newton-King",
  owners: ["jamesnk"],
  totalDownloads: 47312456,
  iconUrl: "https://example.test/icon",
  projectUrl: "https://example.test/project",
  licenseUrl: "https://licenses.nuget.org/MIT",
  tags: ["bson"],
};

function createHandler(
  apiClient: Partial<NuGetV3ApiClient>,
  overrides?: { slnParser?: SlnParser; tfmCache?: ProjectTfmCache },
): GetPackageUpdateInfoQueryHandler {
  return new GetPackageUpdateInfoQueryHandler(
    apiClient as NuGetV3ApiClient,
    new PackageMetadataCache(),
    new TfmCompatibilityService(),
    overrides?.slnParser ?? new SlnParser(),
    new SlnxParser(),
    new BuildConfigDetector(),
    new BuildConfigParser(noOpLogger),
    new TfmResolver(new CsprojParser(), noOpLogger),
    overrides?.tfmCache ?? new ProjectTfmCache(),
    noOpLogger,
  );
}

describe("GetPackageUpdateInfoQueryHandler", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    const files: Record<string, string> = {
      "/Solution/MySolution.sln": SLN,
      "/Solution/Api/Api.csproj": API_CSPROJ,
      "/Solution/Legacy/Legacy.csproj": LEGACY_CSPROJ,
      "/Solution2/MySolution2.sln": SLN2,
      "/Solution2/Api/Api.csproj": API_CSPROJ,
    };
    mockFs.existsSync.mockImplementation((p) => (p as string) in files);
    mockFs.readFileSync.mockImplementation((p) => {
      const content = files[p as string];
      if (content === undefined) {
        throw new Error(`ENOENT: ${p}`);
      }
      return content;
    });
  });

  it("assemble versions triées, verdicts par projet et métadonnées", async () => {
    const handler = createHandler({
      getRegistrationLeaves: jest.fn().mockResolvedValue(LEAVES),
      searchPackage: jest.fn().mockResolvedValue(SEARCH),
    });

    const dto = await handler.Handle(
      new GetPackageUpdateInfoQuery("Newtonsoft.Json.Bson", "/Solution/MySolution.sln"),
    );

    expect(dto.fetchStatus).toBe("Ok");
    expect(dto.versions.map((v) => v.version)).toEqual(["2.1.0-beta.1", "2.0.0", "1.0.2"]);
    expect(dto.latestStable).toBe("2.0.0");
    expect(dto.latestIncludingPrerelease).toBe("2.1.0-beta.1");
    expect(dto.verified).toBe(true);
    expect(dto.isMicrosoft).toBe(false);
    expect(dto.links.nugetPage).toBe("https://www.nuget.org/packages/Newtonsoft.Json.Bson");
    expect(dto.links.license).toEqual({ url: "https://licenses.nuget.org/MIT", expression: "MIT" });

    // v2.0.0 cible net6.0 : Api (net8.0) compatible, Legacy (net472) incompatible
    const v2 = dto.versions.find((v) => v.version === "2.0.0")!;
    expect(v2.verdictsByProject).toEqual([
      { projectPath: "/Solution/Api/Api.csproj", verdict: "Compatible" },
      {
        projectPath: "/Solution/Legacy/Legacy.csproj",
        verdict: "Incompatible",
        reason: expect.stringContaining("net6.0"),
      },
    ]);

    // v1.0.2 (netstandard2.0) : compatible avec les deux
    const v1 = dto.versions.find((v) => v.version === "1.0.2")!;
    expect(v1.verdictsByProject.every((p) => p.verdict === "Compatible")).toBe(true);
  });

  it("détecte les packages Microsoft via owners", async () => {
    const handler = createHandler({
      getRegistrationLeaves: jest.fn().mockResolvedValue(LEAVES),
      searchPackage: jest
        .fn()
        .mockResolvedValue({ ...SEARCH, owners: ["Microsoft", "dotnetframework"] }),
    });
    const dto = await handler.Handle(
      new GetPackageUpdateInfoQuery("X", "/Solution/MySolution.sln"),
    );
    expect(dto.isMicrosoft).toBe(true);
  });

  it("ne détecte PAS Microsoft sur simple correspondance de sous-chaîne dans authors ('NotMicrosoft Ltd')", async () => {
    const handler = createHandler({
      getRegistrationLeaves: jest.fn().mockResolvedValue(LEAVES),
      searchPackage: jest
        .fn()
        .mockResolvedValue({ ...SEARCH, owners: [], authors: "NotMicrosoft Ltd" }),
    });
    const dto = await handler.Handle(
      new GetPackageUpdateInfoQuery("X", "/Solution/MySolution.sln"),
    );
    expect(dto.isMicrosoft).toBe(false);
  });

  it("détecte Microsoft via authors quand c'est un jeton exact parmi plusieurs ('Microsoft, aspnet')", async () => {
    const handler = createHandler({
      getRegistrationLeaves: jest.fn().mockResolvedValue(LEAVES),
      searchPackage: jest
        .fn()
        .mockResolvedValue({ ...SEARCH, owners: [], authors: "Microsoft, aspnet" }),
    });
    const dto = await handler.Handle(
      new GetPackageUpdateInfoQuery("X", "/Solution/MySolution.sln"),
    );
    expect(dto.isMicrosoft).toBe(true);
  });

  it.each([
    ["NotFound", "NotFound"],
    ["RateLimited", "RateLimited"],
    ["Offline", "Offline"],
  ] as const)("NuGetApiError %s → fetchStatus %s, jamais de rejet", async (kind, status) => {
    const handler = createHandler({
      getRegistrationLeaves: jest.fn().mockRejectedValue(new NuGetApiError(kind, "boom")),
      searchPackage: jest.fn(),
    });
    const dto = await handler.Handle(
      new GetPackageUpdateInfoQuery("X", "/Solution/MySolution.sln"),
    );
    expect(dto.fetchStatus).toBe(status);
    expect(dto.versions).toEqual([]);
  });

  it("utilise le cache : deux appels, un seul fetch", async () => {
    const getLeaves = jest.fn().mockResolvedValue(LEAVES);
    const handler = createHandler({
      getRegistrationLeaves: getLeaves,
      searchPackage: jest.fn().mockResolvedValue(SEARCH),
    });
    const query = new GetPackageUpdateInfoQuery("Newtonsoft.Json.Bson", "/Solution/MySolution.sln");
    await handler.Handle(query);
    await handler.Handle(query);
    expect(getLeaves).toHaveBeenCalledTimes(1);
  });

  it("clé de cache par solution : même package, deux solutions → deux fetches, verdicts propres à chaque solution", async () => {
    const getLeaves = jest.fn().mockResolvedValue(LEAVES);
    const handler = createHandler({
      getRegistrationLeaves: getLeaves,
      searchPackage: jest.fn().mockResolvedValue(SEARCH),
    });

    const dto1 = await handler.Handle(
      new GetPackageUpdateInfoQuery("Newtonsoft.Json.Bson", "/Solution/MySolution.sln"),
    );
    const dto2 = await handler.Handle(
      new GetPackageUpdateInfoQuery("Newtonsoft.Json.Bson", "/Solution2/MySolution2.sln"),
    );

    expect(getLeaves).toHaveBeenCalledTimes(2);

    // Solution 1 : deux projets (Api + Legacy)
    const v2_1 = dto1.versions.find((v) => v.version === "2.0.0")!;
    expect(v2_1.verdictsByProject.map((p) => p.projectPath)).toEqual([
      "/Solution/Api/Api.csproj",
      "/Solution/Legacy/Legacy.csproj",
    ]);

    // Solution 2 : un seul projet (Api)
    const v2_2 = dto2.versions.find((v) => v.version === "2.0.0")!;
    expect(v2_2.verdictsByProject.map((p) => p.projectPath)).toEqual(["/Solution2/Api/Api.csproj"]);
  });

  it("mémorise les TFM résolus par solution : deux packages, même solution → sln parsé une seule fois", async () => {
    const slnParser = new SlnParser();
    const parseSpy = jest.spyOn(slnParser, "parse");
    const handler = createHandler(
      {
        getRegistrationLeaves: jest.fn().mockResolvedValue(LEAVES),
        searchPackage: jest.fn().mockResolvedValue(SEARCH),
      },
      { slnParser, tfmCache: new ProjectTfmCache() },
    );

    await handler.Handle(new GetPackageUpdateInfoQuery("PackageA", "/Solution/MySolution.sln"));
    await handler.Handle(new GetPackageUpdateInfoQuery("PackageB", "/Solution/MySolution.sln"));

    expect(parseSpy).toHaveBeenCalledTimes(1);
  });

  it("ne rejette jamais quand le fichier solution est introuvable/invalide : continue avec un Map vide", async () => {
    const handler = createHandler({
      getRegistrationLeaves: jest.fn().mockResolvedValue(LEAVES),
      searchPackage: jest.fn().mockResolvedValue(SEARCH),
    });

    const dto = await handler.Handle(
      new GetPackageUpdateInfoQuery("Newtonsoft.Json.Bson", "/Solution/DoesNotExist.sln"),
    );

    expect(dto.fetchStatus).toBe("Ok");
    expect(dto.versions.map((v) => v.version)).toEqual(["2.1.0-beta.1", "2.0.0", "1.0.2"]);
    expect(dto.versions.every((v) => v.verdictsByProject.length === 0)).toBe(true);
    expect(noOpLogger.Error).toHaveBeenCalled();
  });
});

describe("compareVersionsDesc", () => {
  it("trie les préversions numériquement (SemVer), pas lexicographiquement", () => {
    const sorted = ["2.0.0-beta.2", "2.0.0-beta.10"].sort(compareVersionsDesc);
    expect(sorted).toEqual(["2.0.0-beta.10", "2.0.0-beta.2"]);
  });

  it("un identifiant de préversion supplémentaire est plus grand quand les identifiants partagés sont égaux", () => {
    const sorted = ["1.0.0-alpha", "1.0.0-alpha.1"].sort(compareVersionsDesc);
    expect(sorted).toEqual(["1.0.0-alpha.1", "1.0.0-alpha"]);
  });

  it("ignore les métadonnées de build (+) lors de la comparaison, sans produire NaN", () => {
    expect(compareVersionsDesc("1.0.0+abc123", "1.0.1")).toBeGreaterThan(0);
    const sorted = ["1.0.0+meta", "1.0.1", "1.0.0"].sort(compareVersionsDesc);
    expect(sorted[0]).toBe("1.0.1");
  });
});
