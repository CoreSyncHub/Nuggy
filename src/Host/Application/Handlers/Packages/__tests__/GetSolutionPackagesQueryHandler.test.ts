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
import { createSolutionPackagesHandler } from "../../../../../Tests/Helpers/createHandlers";

const mockFs = fs as jest.Mocked<typeof fs>;

/** `BuildConfigDetector.findAllConfigFiles` rend [] tant qu'aucun workspace n'est ouvert :
 *  les scénarios qui ont besoin d'un Directory.Packages.props doivent donc peupler les deux. */
const mockVscode = jest.requireMock("vscode") as {
  workspace: { findFiles: jest.Mock; workspaceFolders?: Array<{ uri: { fsPath: string } }> };
};

const SLN = `Microsoft Visual Studio Solution File, Format Version 12.00
Project("{FAE04EC0-301F-11D3-BF4B-00C04F79EFBC}") = "Api", "Api\\Api.csproj", "{11111111-1111-1111-1111-111111111111}"
EndProject
Project("{FAE04EC0-301F-11D3-BF4B-00C04F79EFBC}") = "Core", "Core\\Core.csproj", "{22222222-2222-2222-2222-222222222222}"
EndProject
`;

const API_CSPROJ = `<Project Sdk="Microsoft.NET.Sdk">
  <PropertyGroup><TargetFramework>net8.0</TargetFramework></PropertyGroup>
  <ItemGroup>
    <PackageReference Include="Newtonsoft.Json.Bson" Version="1.0.2" />
    <PackageReference Include="Serilog" Version="3.1.0" />
  </ItemGroup>
</Project>`;

const CORE_CSPROJ = `<Project Sdk="Microsoft.NET.Sdk">
  <PropertyGroup><TargetFramework>net6.0</TargetFramework></PropertyGroup>
  <ItemGroup>
    <PackageReference Include="Newtonsoft.Json.Bson" Version="1.0.3" />
  </ItemGroup>
</Project>`;

describe("GetSolutionPackagesQueryHandler", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockVscode.workspace.workspaceFolders = undefined;
    mockVscode.workspace.findFiles.mockResolvedValue([]);
    const files: Record<string, string> = {
      "/Solution/MySolution.sln": SLN,
      "/Solution/Api/Api.csproj": API_CSPROJ,
      "/Solution/Core/Core.csproj": CORE_CSPROJ,
    };
    mockFs.existsSync.mockImplementation((p) => (p as string) in files);
    mockFs.readFileSync.mockImplementation((p) => {
      const content = files[p as string];
      if (content === undefined) {
        throw new Error(`ENOENT: ${p}`);
      }
      return content;
    });
    // NuGetConfigParser.findSolutionLocalConfigs walks up from the solution
    // path and calls statSync(...).isFile() on it before searching for
    // NuGet.Config files in each ancestor directory.
    mockFs.statSync.mockImplementation(
      (p) => ({ isFile: () => (p as string) in files }) as fs.Stats,
    );
  });

  it("consolide les packages par id avec installations par projet", async () => {
    const handler = createSolutionPackagesHandler();
    const dto = await handler.Handle(new GetSolutionPackagesQuery("/Solution/MySolution.sln"));

    expect(dto.packages.map((p) => p.id)).toEqual(["Newtonsoft.Json.Bson", "Serilog"]);

    const bson = dto.packages[0];
    expect(bson.installations).toHaveLength(2);
    expect(bson.installations[0]).toEqual({
      projectPath: "/Solution/Api/Api.csproj",
      projectName: "Api",
      effectiveTfms: ["net8.0"],
      installedVersion: "1.0.2",
      referenceStyle: "PackageReference",
    });
    expect(bson.installations[1].installedVersion).toBe("1.0.3");
    expect(bson.iconUrl).toBe(
      "https://api.nuget.org/v3-flatcontainer/newtonsoft.json.bson/1.0.2/icon",
    );
  });

  it("expose tous les projets de la solution, y compris ceux sans le package", async () => {
    const handler = createSolutionPackagesHandler();
    const dto = await handler.Handle(new GetSolutionPackagesQuery("/Solution/MySolution.sln"));

    // Serilog n'est référencé que par Api : sans cette liste, l'UI ne pourrait jamais
    // proposer de l'installer sur Core (bouton ＋ par projet inatteignable).
    expect(dto.packages.find((p) => p.id === "Serilog")!.installations).toHaveLength(1);
    expect(dto.projects).toEqual([
      {
        projectPath: "/Solution/Api/Api.csproj",
        projectName: "Api",
        effectiveTfms: ["net8.0"],
        referenceStyle: "PackageReference",
      },
      {
        projectPath: "/Solution/Core/Core.csproj",
        projectName: "Core",
        effectiveTfms: ["net6.0"],
        referenceStyle: "PackageReference",
      },
    ]);
  });

  it("annonce le style CpmManaged quand la solution porte un Directory.Packages.props", async () => {
    const CPM_PROPS = `<Project>
  <PropertyGroup><ManagePackageVersionsCentrally>true</ManagePackageVersionsCentrally></PropertyGroup>
  <ItemGroup><PackageVersion Include="Serilog" Version="3.1.0" /></ItemGroup>
</Project>`;
    const files: Record<string, string> = {
      "/Solution/MySolution.sln": SLN,
      "/Solution/Api/Api.csproj": API_CSPROJ,
      "/Solution/Core/Core.csproj": CORE_CSPROJ,
      "/Solution/Directory.Packages.props": CPM_PROPS,
    };
    mockFs.existsSync.mockImplementation((p) => (p as string) in files);
    mockFs.readFileSync.mockImplementation((p) => {
      const content = files[p as string];
      if (content === undefined) {
        throw new Error(`ENOENT: ${p}`);
      }
      return content;
    });
    mockFs.statSync.mockImplementation(
      (p) => ({ isFile: () => (p as string) in files }) as fs.Stats,
    );
    mockVscode.workspace.workspaceFolders = [{ uri: { fsPath: "/Solution" } }];
    mockVscode.workspace.findFiles.mockImplementation((pattern: string) =>
      Promise.resolve(
        pattern.includes("Directory.Packages.props")
          ? [{ fsPath: "/Solution/Directory.Packages.props" }]
          : [],
      ),
    );

    const handler = createSolutionPackagesHandler();
    const dto = await handler.Handle(new GetSolutionPackagesQuery("/Solution/MySolution.sln"));

    // Installer ici créera une <PackageReference> sans Version + un <PackageVersion> :
    // même sémantique que PackageWriteTargetResolver, dont dépendent les boutons de l'UI.
    expect(dto.projects.map((p) => p.referenceStyle)).toEqual(["CpmManaged", "CpmManaged"]);
  });

  it("sans NuGet.Config, aucun feed non interrogé", async () => {
    const handler = createSolutionPackagesHandler();
    const dto = await handler.Handle(new GetSolutionPackagesQuery("/Solution/MySolution.sln"));
    expect(dto.uninterrogatedFeeds).toEqual([]);
  });

  it("consolide un même package référencé avec des casses d'id différentes selon les projets", async () => {
    const API_CASING_CSPROJ = `<Project Sdk="Microsoft.NET.Sdk">
  <PropertyGroup><TargetFramework>net8.0</TargetFramework></PropertyGroup>
  <ItemGroup>
    <PackageReference Include="Serilog" Version="3.1.0" />
  </ItemGroup>
</Project>`;
    const CORE_CASING_CSPROJ = `<Project Sdk="Microsoft.NET.Sdk">
  <PropertyGroup><TargetFramework>net6.0</TargetFramework></PropertyGroup>
  <ItemGroup>
    <PackageReference Include="serilog" Version="3.1.0" />
  </ItemGroup>
</Project>`;
    const files: Record<string, string> = {
      "/Solution/MySolution.sln": SLN,
      "/Solution/Api/Api.csproj": API_CASING_CSPROJ,
      "/Solution/Core/Core.csproj": CORE_CASING_CSPROJ,
    };
    mockFs.existsSync.mockImplementation((p) => (p as string) in files);
    mockFs.readFileSync.mockImplementation((p) => {
      const content = files[p as string];
      if (content === undefined) {
        throw new Error(`ENOENT: ${p}`);
      }
      return content;
    });
    mockFs.statSync.mockImplementation(
      (p) => ({ isFile: () => (p as string) in files }) as fs.Stats,
    );

    const handler = createSolutionPackagesHandler();
    const dto = await handler.Handle(new GetSolutionPackagesQuery("/Solution/MySolution.sln"));

    expect(dto.packages).toHaveLength(1);
    expect(dto.packages[0].id).toBe("Serilog");
    expect(dto.packages[0].installations).toHaveLength(2);
  });
});
