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

import { GetSolutionPackagesQuery } from "@Shared/Features/Queries/GetSolutionPackagesQuery";
import { GetPackageUpdateInfoQuery } from "@Shared/Features/Queries/GetPackageUpdateInfoQuery";
import { createSolutionPackagesHandler } from "../../Helpers/createHandlers";
import { GetPackageUpdateInfoQueryHandler } from "@Application/Handlers/Packages/GetPackageUpdateInfoQueryHandler";
import { NuGetV3ApiClient } from "@Infrastructure/NuGet/NuGetV3ApiClient";
import { PackageMetadataCache } from "@Infrastructure/NuGet/PackageMetadataCache";
import { TfmCompatibilityService } from "@Infrastructure/Projects/TfmCompatibilityService";
import { SlnParser } from "@Infrastructure/Solution/SlnParser";
import { SlnxParser } from "@Infrastructure/Solution/SlnxParser";
import { BuildConfigDetector } from "@Infrastructure/Build/BuildConfigDetector";
import { BuildConfigParser } from "@Infrastructure/Build/BuildConfigParser";
import { CsprojParser } from "@Infrastructure/Projects/CsprojParser";
import { TfmResolver } from "@Infrastructure/Projects/TfmResolver";
import { ProjectTfmCache } from "@Infrastructure/Projects/ProjectTfmCache";
import { ProjectTfmResolutionService } from "@Infrastructure/Projects/ProjectTfmResolutionService";
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
`;

const API_CSPROJ = `<Project Sdk="Microsoft.NET.Sdk">
  <PropertyGroup><TargetFramework>net8.0</TargetFramework></PropertyGroup>
  <ItemGroup>
    <PackageReference Include="Serilog" Version="3.1.0" />
  </ItemGroup>
</Project>`;

const SERVICE_INDEX = {
  resources: [
    { "@id": "https://search.test/query", "@type": "SearchQueryService/3.5.0" },
    { "@id": "https://registration.test/", "@type": "RegistrationsBaseUrl/3.6.0" },
  ],
};
const REGISTRATION = {
  items: [
    {
      items: [
        {
          catalogEntry: {
            version: "3.1.0",
            listed: true,
            dependencyGroups: [{ targetFramework: ".NETStandard2.0", dependencies: [] }],
          },
        },
        {
          catalogEntry: {
            version: "4.3.0",
            listed: true,
            dependencyGroups: [{ targetFramework: "net6.0", dependencies: [] }],
          },
        },
      ],
    },
  ],
};
const SEARCH = {
  data: [{ verified: true, authors: "Serilog Contributors", owners: ["serilog"], tags: [] }],
};

describe("Acceptance: Package updates (Epic 2)", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    const files: Record<string, string> = {
      "/Solution/MySolution.sln": SLN,
      "/Solution/Api/Api.csproj": API_CSPROJ,
    };
    mockFs.existsSync.mockImplementation((p) => (p as string) in files);
    mockFs.readFileSync.mockImplementation((p) => {
      const content = files[p as string];
      if (content === undefined) {
        throw new Error(`ENOENT: ${p}`);
      }
      return content;
    });
    // NuGetConfigParser.findSolutionLocalConfigs statSync()'s the start path to detect
    // whether it's a file (walk up from parent dir) or already a directory. Our fixtures
    // are files, so mirror that here.
    mockFs.statSync.mockImplementation(
      (p) => ({ isFile: () => (p as string) in files }) as fs.Stats,
    );

    jest.spyOn(globalThis, "fetch").mockImplementation(async (url) => {
      const u = String(url);
      const body =
        u.includes("index.json") && u.includes("api.nuget.org")
          ? SERVICE_INDEX
          : u.startsWith("https://registration.test/")
            ? REGISTRATION
            : SEARCH;
      return { ok: true, status: 200, json: async () => body } as unknown as Response;
    });
  });

  afterEach(() => jest.restoreAllMocks());

  it("local list then network verdicts, end to end", async () => {
    const listHandler = createSolutionPackagesHandler();
    const list = await listHandler.Handle(new GetSolutionPackagesQuery("/Solution/MySolution.sln"));

    expect(list.packages.map((p) => p.id)).toEqual(["Serilog"]);
    expect(list.packages[0].installations[0].effectiveTfms).toEqual(["net8.0"]);

    const infoHandler = new GetPackageUpdateInfoQueryHandler(
      new NuGetV3ApiClient(noOpLogger),
      new PackageMetadataCache(),
      new TfmCompatibilityService(),
      new ProjectTfmResolutionService(
        new SlnParser(),
        new SlnxParser(),
        new BuildConfigDetector(),
        new BuildConfigParser(noOpLogger),
        new TfmResolver(new CsprojParser(), noOpLogger),
      ),
      new ProjectTfmCache(),
      noOpLogger,
    );
    const info = await infoHandler.Handle(
      new GetPackageUpdateInfoQuery("Serilog", "/Solution/MySolution.sln"),
    );

    expect(info.fetchStatus).toBe("Ok");
    expect(info.latestStable).toBe("4.3.0");
    const latest = info.versions.find((v) => v.version === "4.3.0")!;
    expect(latest.verdictsByProject).toEqual([
      { projectPath: "/Solution/Api/Api.csproj", verdict: "Compatible" },
    ]);
  });
});
