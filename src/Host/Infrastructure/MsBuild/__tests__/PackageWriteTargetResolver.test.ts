import * as fs from "fs";
import * as vscode from "vscode";
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

import { createPackageWriteTargetResolver } from "../../../../Tests/Helpers/createHandlers";

const mockFs = fs as jest.Mocked<typeof fs>;

const SLN = `Microsoft Visual Studio Solution File, Format Version 12.00
Project("{FAE04EC0-301F-11D3-BF4B-00C04F79EFBC}") = "Api", "Api\\Api.csproj", "{11111111-1111-1111-1111-111111111111}"
EndProject
Project("{FAE04EC0-301F-11D3-BF4B-00C04F79EFBC}") = "Core", "Core\\Core.csproj", "{22222222-2222-2222-2222-222222222222}"
EndProject
`;

const API_CSPROJ = `<Project Sdk="Microsoft.NET.Sdk">
  <PropertyGroup><TargetFramework>net8.0</TargetFramework></PropertyGroup>
  <ItemGroup>
    <PackageReference Include="Serilog" Version="3.1.0" />
  </ItemGroup>
</Project>`;

const CORE_CSPROJ = `<Project Sdk="Microsoft.NET.Sdk">
  <PropertyGroup><TargetFramework>net8.0</TargetFramework></PropertyGroup>
</Project>`;

describe("PackageWriteTargetResolver", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    // Pas de dossier de workspace ouvert => BuildConfigDetector.findAllConfigFiles
    // court-circuite avant d'appeler vscode.workspace.findFiles : aucun fichier
    // CPM ne peut donc être détecté dans ce describe.
    (vscode.workspace as unknown as { workspaceFolders?: unknown }).workspaceFolders = undefined;
    const files: Record<string, string> = {
      "/Solution/My.sln": SLN,
      "/Solution/Api/Api.csproj": API_CSPROJ,
      "/Solution/Core/Core.csproj": CORE_CSPROJ,
    };
    mockFs.existsSync.mockImplementation((p) => (p as string) in files);
    mockFs.statSync.mockImplementation(
      (p) => ({ isFile: () => (p as string) in files }) as unknown as fs.Stats,
    );
    mockFs.readFileSync.mockImplementation((p) => {
      const content = files[p as string];
      if (content === undefined) {
        throw new Error(`ENOENT: ${p}`);
      }
      return content;
    });
  });

  it("résout un target par projet avec style et version installée", async () => {
    const resolver = createPackageWriteTargetResolver();
    const { targets, cpmFilePath } = await resolver.resolveTargets("/Solution/My.sln", "Serilog");
    expect(cpmFilePath).toBeUndefined();
    expect(targets).toEqual([
      {
        projectPath: "/Solution/Api/Api.csproj",
        style: "PackageReference",
        installedVersion: "3.1.0",
      },
      { projectPath: "/Solution/Core/Core.csproj", style: "PackageReference" },
    ]);
  });
});

describe("PackageWriteTargetResolver - CPM (Directory.Packages.props)", () => {
  const CPM_SLN = `Microsoft Visual Studio Solution File, Format Version 12.00
Project("{FAE04EC0-301F-11D3-BF4B-00C04F79EFBC}") = "Api", "Api\\Api.csproj", "{11111111-1111-1111-1111-111111111111}"
EndProject
Project("{FAE04EC0-301F-11D3-BF4B-00C04F79EFBC}") = "Core", "Core\\Core.csproj", "{22222222-2222-2222-2222-222222222222}"
EndProject
`;

  // En CPM, les PackageReference n'ont plus d'attribut Version (délégué au
  // Directory.Packages.props).
  const API_CSPROJ_CPM = `<Project Sdk="Microsoft.NET.Sdk">
  <PropertyGroup><TargetFramework>net8.0</TargetFramework></PropertyGroup>
  <ItemGroup>
    <PackageReference Include="Serilog" />
  </ItemGroup>
</Project>`;

  const DIRECTORY_PACKAGES_PROPS = `<Project>
  <PropertyGroup>
    <ManagePackageVersionsCentrally>true</ManagePackageVersionsCentrally>
  </PropertyGroup>
  <ItemGroup>
    <PackageVersion Include="Serilog" Version="3.1.0" />
  </ItemGroup>
</Project>`;

  beforeEach(() => {
    jest.clearAllMocks();
    // Un dossier de workspace est requis pour que BuildConfigDetector
    // interroge vscode.workspace.findFiles.
    (vscode.workspace as unknown as { workspaceFolders?: unknown }).workspaceFolders = [
      { uri: { fsPath: "/Solution" } },
    ];
    const files: Record<string, string> = {
      "/Solution/My.sln": CPM_SLN,
      "/Solution/Api/Api.csproj": API_CSPROJ_CPM,
      "/Solution/Core/Core.csproj": CORE_CSPROJ,
      "/Solution/Directory.Packages.props": DIRECTORY_PACKAGES_PROPS,
    };
    mockFs.existsSync.mockImplementation((p) => (p as string) in files);
    mockFs.statSync.mockImplementation(
      (p) => ({ isFile: () => (p as string) in files }) as unknown as fs.Stats,
    );
    mockFs.readFileSync.mockImplementation((p) => {
      const content = files[p as string];
      if (content === undefined) {
        throw new Error(`ENOENT: ${p}`);
      }
      return content;
    });

    // BuildConfigDetector.findAllConfigFiles interroge trois patterns
    // (Directory.Build.props, Directory.Build.targets, Directory.Packages.props) ;
    // seul le dernier doit renvoyer une correspondance ici.
    (vscode.workspace.findFiles as jest.Mock).mockImplementation((pattern: string) => {
      if (pattern.includes("Directory.Packages.props")) {
        return Promise.resolve([vscode.Uri.file("/Solution/Directory.Packages.props")]);
      }
      return Promise.resolve([]);
    });
  });

  it("résout des targets CpmManaged avec la version issue du PackageVersion central", async () => {
    const resolver = createPackageWriteTargetResolver();
    const { targets, cpmFilePath } = await resolver.resolveTargets("/Solution/My.sln", "Serilog");

    expect(cpmFilePath).toBe("/Solution/Directory.Packages.props");
    expect(targets).toEqual([
      {
        projectPath: "/Solution/Api/Api.csproj",
        style: "CpmManaged",
        installedVersion: "3.1.0",
        cpmFilePath: "/Solution/Directory.Packages.props",
      },
      {
        projectPath: "/Solution/Core/Core.csproj",
        style: "CpmManaged",
        cpmFilePath: "/Solution/Directory.Packages.props",
      },
    ]);
  });
});

describe("PackageWriteTargetResolver - legacy (packages.config)", () => {
  const LEGACY_SLN = `Microsoft Visual Studio Solution File, Format Version 12.00
Project("{FAE04EC0-301F-11D3-BF4B-00C04F79EFBC}") = "Legacy", "Legacy\\Legacy.csproj", "{33333333-3333-3333-3333-333333333333}"
EndProject
Project("{FAE04EC0-301F-11D3-BF4B-00C04F79EFBC}") = "Modern", "Modern\\Modern.csproj", "{44444444-4444-4444-4444-444444444444}"
EndProject
`;

  const LEGACY_CSPROJ = `<Project ToolsVersion="15.0" DefaultTargets="Build" xmlns="http://schemas.microsoft.com/developer/msbuild/2003">
  <PropertyGroup><TargetFrameworkVersion>v4.8</TargetFrameworkVersion></PropertyGroup>
</Project>`;

  const PACKAGES_CONFIG = `<?xml version="1.0" encoding="utf-8"?>
<packages>
  <package id="Serilog" version="2.10.0" targetFramework="net48" />
</packages>`;

  const MODERN_CSPROJ = `<Project Sdk="Microsoft.NET.Sdk">
  <PropertyGroup><TargetFramework>net8.0</TargetFramework></PropertyGroup>
  <ItemGroup>
    <PackageReference Include="Serilog" Version="2.0.0" />
  </ItemGroup>
</Project>`;

  beforeEach(() => {
    jest.clearAllMocks();
    (vscode.workspace as unknown as { workspaceFolders?: unknown }).workspaceFolders = undefined;
    const files: Record<string, string> = {
      "/Solution/Legacy.sln": LEGACY_SLN,
      "/Solution/Legacy/Legacy.csproj": LEGACY_CSPROJ,
      "/Solution/Legacy/packages.config": PACKAGES_CONFIG,
      "/Solution/Modern/Modern.csproj": MODERN_CSPROJ,
    };
    mockFs.existsSync.mockImplementation((p) => (p as string) in files);
    mockFs.statSync.mockImplementation(
      (p) => ({ isFile: () => (p as string) in files }) as unknown as fs.Stats,
    );
    mockFs.readFileSync.mockImplementation((p) => {
      const content = files[p as string];
      if (content === undefined) {
        throw new Error(`ENOENT: ${p}`);
      }
      return content;
    });
  });

  it("résout un projet packages.config en style PackagesConfig, sans toucher aux projets SDK voisins", async () => {
    const resolver = createPackageWriteTargetResolver();
    const { targets, cpmFilePath } = await resolver.resolveTargets(
      "/Solution/Legacy.sln",
      "Serilog",
    );

    expect(cpmFilePath).toBeUndefined();
    expect(targets).toEqual([
      { projectPath: "/Solution/Legacy/Legacy.csproj", style: "PackagesConfig" },
      {
        projectPath: "/Solution/Modern/Modern.csproj",
        style: "PackageReference",
        installedVersion: "2.0.0",
      },
    ]);
  });
});
