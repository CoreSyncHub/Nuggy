import * as fs from "fs";
jest.mock("fs");
jest.mock("path", () => jest.requireActual("path").posix);
jest.mock(
  "vscode",
  () => ({
    workspace: { findFiles: jest.fn().mockResolvedValue([]) },
    Uri: { file: (p: string) => ({ fsPath: p }) },
  }),
  { virtual: true },
);

import { ProjectTfmResolutionService } from "../ProjectTfmResolutionService";
import { SlnParser } from "../../Solution/SlnParser";
import { SlnxParser } from "../../Solution/SlnxParser";
import { BuildConfigDetector } from "../../Build/BuildConfigDetector";
import { BuildConfigParser } from "../../Build/BuildConfigParser";
import { TfmResolver } from "../TfmResolver";
import { CsprojParser } from "../CsprojParser";
import { type ILogger } from "@/Host/Application/Abstractions/Log/ILogger";

const mockFs = fs as jest.Mocked<typeof fs>;
const mockVscode = jest.requireMock("vscode") as {
  workspace: { findFiles: jest.Mock; workspaceFolders?: Array<{ uri: { fsPath: string } }> };
};

const noOpLogger: ILogger = {
  Info: jest.fn(),
  Warning: jest.fn(),
  Error: jest.fn(),
  Debug: jest.fn(),
};

const SLN = `Microsoft Visual Studio Solution File, Format Version 12.00
Project("{FAE04EC0-301F-11D3-BF4B-00C04F79EFBC}") = "Api", "Api\\Api.csproj", "{11111111-1111-1111-1111-111111111111}"
EndProject
Project("{FAE04EC0-301F-11D3-BF4B-00C04F79EFBC}") = "Core", "Core\\Core.csproj", "{22222222-2222-2222-2222-222222222222}"
EndProject
`;

const SLNX = `<Solution>
  <Project Path="Api/Api.csproj" />
</Solution>`;

const API_CSPROJ = `<Project Sdk="Microsoft.NET.Sdk">
  <PropertyGroup><TargetFramework>net8.0</TargetFramework></PropertyGroup>
</Project>`;

const CORE_CSPROJ = `<Project Sdk="Microsoft.NET.Sdk">
  <PropertyGroup><TargetFrameworks>net6.0;net8.0</TargetFrameworks></PropertyGroup>
</Project>`;

const DIRECTORY_BUILD_PROPS = `<Project>
  <PropertyGroup><LangVersion>latest</LangVersion></PropertyGroup>
</Project>`;

function createService(): ProjectTfmResolutionService {
  return new ProjectTfmResolutionService(
    new SlnParser(),
    new SlnxParser(),
    new BuildConfigDetector(),
    new BuildConfigParser(noOpLogger),
    new TfmResolver(new CsprojParser(), noOpLogger),
  );
}

describe("ProjectTfmResolutionService", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockVscode.workspace.workspaceFolders = undefined;
    mockVscode.workspace.findFiles.mockResolvedValue([]);
    const files: Record<string, string> = {
      "/Solution/MySolution.sln": SLN,
      "/Solution/MySolution.SLN": SLN,
      "/Solution/MySolution.slnx": SLNX,
      "/Solution/Api/Api.csproj": API_CSPROJ,
      "/Solution/Core/Core.csproj": CORE_CSPROJ,
      "/Solution/Directory.Build.props": DIRECTORY_BUILD_PROPS,
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
  });

  describe("parseProjectPaths", () => {
    it("reads the projects of a .sln solution", () => {
      expect(createService().parseProjectPaths("/Solution/MySolution.sln")).toEqual([
        "/Solution/Api/Api.csproj",
        "/Solution/Core/Core.csproj",
      ]);
    });

    it("reads the projects of a .slnx solution", () => {
      expect(createService().parseProjectPaths("/Solution/MySolution.slnx")).toEqual([
        "/Solution/Api/Api.csproj",
      ]);
    });

    it("throws on an unknown extension rather than treating it as a .sln", () => {
      // Two of the four original copies silently fell back on the .sln parser: a file
      // with no projects then returned an empty list, without saying anything.
      expect(() => createService().parseProjectPaths("/Solution/MySolution.txt")).toThrow(
        "Unsupported solution format: .txt",
      );
    });

    it("is insensitive to the extension casing", () => {
      expect(createService().parseProjectPaths("/Solution/MySolution.SLN")).toHaveLength(2);
    });
  });

  describe("loadBuildConfigFiles", () => {
    it("returns an empty list when no workspace is open", async () => {
      await expect(createService().loadBuildConfigFiles()).resolves.toEqual([]);
    });

    it("discovers the configuration files and parses their contents", async () => {
      mockVscode.workspace.workspaceFolders = [{ uri: { fsPath: "/Solution" } }];
      mockVscode.workspace.findFiles.mockImplementation((pattern: string) =>
        Promise.resolve(
          pattern.includes("Directory.Build.props")
            ? [{ fsPath: "/Solution/Directory.Build.props" }]
            : [],
        ),
      );

      const files = await createService().loadBuildConfigFiles();

      expect(files.map((f) => f.path)).toEqual(["/Solution/Directory.Build.props"]);
      // The contents were indeed parsed: without the parsing step, no property at all.
      expect(files[0].properties.size).toBeGreaterThan(0);
    });
  });

  describe("resolveProjectTfms", () => {
    it("returns the effective TFMs of every project, multi-TFM included", async () => {
      const tfms = await createService().resolveProjectTfms("/Solution/MySolution.sln");

      expect(tfms.get("/Solution/Api/Api.csproj")).toEqual(["net8.0"]);
      expect(tfms.get("/Solution/Core/Core.csproj")).toEqual(["net6.0", "net8.0"]);
    });

    it("propagates the unknown-extension error", async () => {
      await expect(createService().resolveProjectTfms("/Solution/MySolution.txt")).rejects.toThrow(
        "Unsupported solution format",
      );
    });
  });
});
