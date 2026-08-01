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

import { createPackageWriteTargetResolver } from "../../../../../Tests/Helpers/createHandlers";
import { InstallPackageCommandHandler } from "../InstallPackageCommandHandler";
import { InstallPackageCommand } from "@Shared/Features/Commands/InstallPackageCommand";
import { MsBuildTextEditor } from "@Infrastructure/MsBuild/MsBuildTextEditor";
import { type RestoreScheduler } from "@Infrastructure/MsBuild/RestoreScheduler";
import { OperationLogStore } from "@Infrastructure/MsBuild/OperationLogStore";
import { type WriteOperationEntryDto } from "@Shared/Features/Dtos/OperationLogDto";
import { PackageMetadataCache } from "@Infrastructure/NuGet/PackageMetadataCache";
import { ProjectTfmCache } from "@Infrastructure/Projects/ProjectTfmCache";
import {
  type NuGetV3ApiClient,
  type RegistrationLeaf,
} from "@Infrastructure/NuGet/NuGetV3ApiClient";
import { TfmCompatibilityService } from "@Infrastructure/Projects/TfmCompatibilityService";
import { SlnParser } from "@Infrastructure/Solution/SlnParser";
import { SlnxParser } from "@Infrastructure/Solution/SlnxParser";
import { BuildConfigDetector } from "@Infrastructure/Build/BuildConfigDetector";
import { BuildConfigParser } from "@Infrastructure/Build/BuildConfigParser";
import { CsprojParser } from "@Infrastructure/Projects/CsprojParser";
import { TfmResolver } from "@Infrastructure/Projects/TfmResolver";
import { ProjectTfmResolutionService } from "@Infrastructure/Projects/ProjectTfmResolutionService";
import { type IUserPrompt } from "../../../Abstractions/Prompt/IUserPrompt";
import { type ILogger } from "../../../Abstractions/Log/ILogger";

const mockFs = fs as jest.Mocked<typeof fs>;

const noOpLogger: ILogger = {
  Info: jest.fn(),
  Warning: jest.fn(),
  Error: jest.fn(),
  Debug: jest.fn(),
};

/** Fake registration with a single leaf for `version`, targeting `targetFrameworks`. */
function leavesFor(version: string, targetFrameworks: string[]): RegistrationLeaf[] {
  return [
    {
      version,
      listed: true,
      dependencyGroups: targetFrameworks.map((tf) => ({ targetFramework: tf, dependencies: [] })),
    },
  ];
}

type Fakes = {
  restoreScheduler: { schedule: jest.Mock };
  prompt: { confirm: jest.Mock };
  apiClient: { getRegistrationLeaves: jest.Mock };
  metadataCache: PackageMetadataCache;
  tfmCache: ProjectTfmCache;
  operationLog: OperationLogStore;
};

function createHandler(overrides?: {
  apiClient?: { getRegistrationLeaves: jest.Mock };
  prompt?: { confirm: jest.Mock };
}): { handler: InstallPackageCommandHandler } & Fakes {
  const restoreScheduler = { schedule: jest.fn() };
  const prompt = overrides?.prompt ?? { confirm: jest.fn().mockResolvedValue(true) };
  const apiClient = overrides?.apiClient ?? {
    getRegistrationLeaves: jest.fn().mockResolvedValue([]),
  };
  const metadataCache = new PackageMetadataCache();
  const tfmCache = new ProjectTfmCache();
  const operationLog = new OperationLogStore();

  const handler = new InstallPackageCommandHandler(
    operationLog,
    createPackageWriteTargetResolver(),
    new MsBuildTextEditor(),
    restoreScheduler as unknown as RestoreScheduler,
    metadataCache,
    tfmCache,
    apiClient as unknown as NuGetV3ApiClient,
    new TfmCompatibilityService(),
    new ProjectTfmResolutionService(
      new SlnParser(),
      new SlnxParser(),
      new BuildConfigDetector(),
      new BuildConfigParser(noOpLogger),
      new TfmResolver(new CsprojParser(), noOpLogger),
    ),
    prompt as unknown as IUserPrompt,
    noOpLogger,
  );

  return { handler, restoreScheduler, prompt, apiClient, metadataCache, tfmCache, operationLog };
}

function setFiles(files: Record<string, string>): void {
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
}

describe("InstallPackageCommandHandler - cible explicite", () => {
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

  beforeEach(() => {
    jest.clearAllMocks();
    (vscode.workspace as unknown as { workspaceFolders?: unknown }).workspaceFolders = undefined;
    setFiles({
      "/Solution/My.sln": SLN,
      "/Solution/Api/Api.csproj": API_CSPROJ,
      "/Solution/Core/Core.csproj": CORE_CSPROJ,
    });
  });

  it("installs on the target project (disk write + scheduled restore)", async () => {
    const { handler, restoreScheduler, metadataCache, tfmCache } = createHandler({
      apiClient: {
        getRegistrationLeaves: jest.fn().mockResolvedValue(leavesFor("13.0.3", ["netstandard2.0"])),
      },
    });
    const invalidateMeta = jest.spyOn(metadataCache, "invalidate");
    const invalidateTfm = jest.spyOn(tfmCache, "invalidate");

    const result = await handler.Handle(
      new InstallPackageCommand(
        "Newtonsoft.Json",
        "13.0.3",
        "/Solution/My.sln",
        "/Solution/Api/Api.csproj",
      ),
    );

    const written = mockFs.writeFileSync.mock.calls.find(([p]) => p === "/Solution/Api/Api.csproj");
    expect(written).toBeDefined();
    expect(written![1]).toContain(
      '<PackageReference Include="Newtonsoft.Json" Version="13.0.3" />',
    );

    expect(restoreScheduler.schedule).toHaveBeenCalledWith("/Solution/My.sln");
    expect(invalidateMeta).toHaveBeenCalledWith("/Solution/My.sln::newtonsoft.json");
    expect(invalidateTfm).toHaveBeenCalledWith("/Solution/My.sln");

    expect(result).toEqual({
      status: "Ok",
      filesChanged: ["/Solution/Api/Api.csproj"],
      affectedProjects: ["/Solution/Api/Api.csproj"],
      skipped: [],
    });
  });

  it("Incompatible verdict for the requested version → skipped with a reason", async () => {
    const { handler, restoreScheduler } = createHandler({
      apiClient: {
        getRegistrationLeaves: jest.fn().mockResolvedValue(leavesFor("13.0.3", ["net9.0"])),
      },
    });

    const result = await handler.Handle(
      new InstallPackageCommand(
        "Newtonsoft.Json",
        "13.0.3",
        "/Solution/My.sln",
        "/Solution/Api/Api.csproj",
      ),
    );

    expect(mockFs.writeFileSync).not.toHaveBeenCalled();
    expect(restoreScheduler.schedule).not.toHaveBeenCalled();
    expect(result.status).toBe("Ok");
    expect(result.filesChanged).toEqual([]);
    expect(result.affectedProjects).toEqual([]);
    expect(result.skipped).toEqual([
      {
        path: "/Solution/Api/Api.csproj",
        reason: expect.stringContaining("net9.0"),
      },
    ]);
  });

  it("invalid packageId (XML injection character) → Error with no resolution and no write (Finding 3a)", async () => {
    const { handler, restoreScheduler } = createHandler();

    const result = await handler.Handle(
      new InstallPackageCommand(
        'Evil" Foo="bar',
        "13.0.3",
        "/Solution/My.sln",
        "/Solution/Api/Api.csproj",
      ),
    );

    expect(mockFs.writeFileSync).not.toHaveBeenCalled();
    expect(restoreScheduler.schedule).not.toHaveBeenCalled();
    expect(result.status).toBe("Error");
    expect(result.filesChanged).toEqual([]);
    expect(result.affectedProjects).toEqual([]);
    expect(result.skipped).toEqual([]);
    expect(result.error).toBeDefined();
  });

  it("invalid version (XML injection character) → Error with no resolution and no write (Finding 3a)", async () => {
    const { handler, restoreScheduler } = createHandler();

    const result = await handler.Handle(
      new InstallPackageCommand(
        "Newtonsoft.Json",
        '13.0.3" Foo="bar',
        "/Solution/My.sln",
        "/Solution/Api/Api.csproj",
      ),
    );

    expect(mockFs.writeFileSync).not.toHaveBeenCalled();
    expect(restoreScheduler.schedule).not.toHaveBeenCalled();
    expect(result.status).toBe("Error");
    expect(result.filesChanged).toEqual([]);
    expect(result.affectedProjects).toEqual([]);
    expect(result.skipped).toEqual([]);
    expect(result.error).toBeDefined();
  });

  it("journals the operation into OperationLogStore with the DTO data", async () => {
    const { handler, operationLog } = createHandler({
      apiClient: {
        getRegistrationLeaves: jest.fn().mockResolvedValue(leavesFor("13.0.3", ["netstandard2.0"])),
      },
    });

    const result = await handler.Handle(
      new InstallPackageCommand(
        "Newtonsoft.Json",
        "13.0.3",
        "/Solution/My.sln",
        "/Solution/Api/Api.csproj",
      ),
    );

    const [entry] = operationLog.getEntries() as WriteOperationEntryDto[];
    expect(entry).toMatchObject({
      kind: "write",
      operation: "install",
      packageId: "Newtonsoft.Json",
      status: result.status,
      affectedProjects: result.affectedProjects,
      filesChanged: result.filesChanged,
    });
    expect(entry.version).toBe("13.0.3");
  });

  it("journals validation errors as well", async () => {
    const { handler, operationLog } = createHandler();

    await handler.Handle(
      new InstallPackageCommand(
        'Evil" Foo="bar',
        "13.0.3",
        "/Solution/My.sln",
        "/Solution/Api/Api.csproj",
      ),
    );

    const [entry] = operationLog.getEntries() as WriteOperationEntryDto[];
    expect(entry.status).toBe("Error");
    expect(entry.error).toContain("identifiant ou version de package invalide");
  });

  it("unreachable registration → Unknown → installation allowed", async () => {
    const { handler, restoreScheduler } = createHandler({
      apiClient: {
        getRegistrationLeaves: jest.fn().mockRejectedValue(new Error("nuget.org injoignable")),
      },
    });

    const result = await handler.Handle(
      new InstallPackageCommand(
        "Newtonsoft.Json",
        "13.0.3",
        "/Solution/My.sln",
        "/Solution/Api/Api.csproj",
      ),
    );

    const written = mockFs.writeFileSync.mock.calls.find(([p]) => p === "/Solution/Api/Api.csproj");
    expect(written).toBeDefined();
    expect(written![1]).toContain(
      '<PackageReference Include="Newtonsoft.Json" Version="13.0.3" />',
    );
    expect(restoreScheduler.schedule).toHaveBeenCalledWith("/Solution/My.sln");
    expect(noOpLogger.Warning).toHaveBeenCalled();

    expect(result).toEqual({
      status: "Ok",
      filesChanged: ["/Solution/Api/Api.csproj"],
      affectedProjects: ["/Solution/Api/Api.csproj"],
      skipped: [],
    });
  });
});

describe("InstallPackageCommandHandler - installation globale", () => {
  const SLN = `Microsoft Visual Studio Solution File, Format Version 12.00
Project("{FAE04EC0-301F-11D3-BF4B-00C04F79EFBC}") = "Legacy", "Legacy\\Legacy.csproj", "{11111111-1111-1111-1111-111111111111}"
EndProject
Project("{FAE04EC0-301F-11D3-BF4B-00C04F79EFBC}") = "AlreadyInstalled", "AlreadyInstalled\\AlreadyInstalled.csproj", "{22222222-2222-2222-2222-222222222222}"
EndProject
Project("{FAE04EC0-301F-11D3-BF4B-00C04F79EFBC}") = "CandidateA", "CandidateA\\CandidateA.csproj", "{33333333-3333-3333-3333-333333333333}"
EndProject
Project("{FAE04EC0-301F-11D3-BF4B-00C04F79EFBC}") = "CandidateB", "CandidateB\\CandidateB.csproj", "{44444444-4444-4444-4444-444444444444}"
EndProject
`;

  const LEGACY_CSPROJ = `<Project ToolsVersion="15.0" DefaultTargets="Build" xmlns="http://schemas.microsoft.com/developer/msbuild/2003">
  <PropertyGroup><TargetFrameworkVersion>v4.8</TargetFrameworkVersion></PropertyGroup>
</Project>`;

  const LEGACY_PACKAGES_CONFIG = `<?xml version="1.0" encoding="utf-8"?>
<packages>
  <package id="Newtonsoft.Json" version="9.0.1" targetFramework="net48" />
</packages>`;

  const ALREADY_INSTALLED_CSPROJ = `<Project Sdk="Microsoft.NET.Sdk">
  <PropertyGroup><TargetFramework>net8.0</TargetFramework></PropertyGroup>
  <ItemGroup>
    <PackageReference Include="Newtonsoft.Json" Version="12.0.3" />
  </ItemGroup>
</Project>`;

  const CANDIDATE_CSPROJ = `<Project Sdk="Microsoft.NET.Sdk">
  <PropertyGroup><TargetFramework>net8.0</TargetFramework></PropertyGroup>
</Project>`;

  beforeEach(() => {
    jest.clearAllMocks();
    (vscode.workspace as unknown as { workspaceFolders?: unknown }).workspaceFolders = undefined;
    setFiles({
      "/Solution/My.sln": SLN,
      "/Solution/Legacy/Legacy.csproj": LEGACY_CSPROJ,
      "/Solution/Legacy/packages.config": LEGACY_PACKAGES_CONFIG,
      "/Solution/AlreadyInstalled/AlreadyInstalled.csproj": ALREADY_INSTALLED_CSPROJ,
      "/Solution/CandidateA/CandidateA.csproj": CANDIDATE_CSPROJ,
      "/Solution/CandidateB/CandidateB.csproj": CANDIDATE_CSPROJ,
    });
  });

  it("global install: skips projects already equipped and legacy ones, confirms when >1 target", async () => {
    const { handler, prompt, restoreScheduler } = createHandler({
      apiClient: {
        getRegistrationLeaves: jest.fn().mockResolvedValue(leavesFor("13.0.3", ["netstandard2.0"])),
      },
    });

    const result = await handler.Handle(
      new InstallPackageCommand("Newtonsoft.Json", "13.0.3", "/Solution/My.sln"),
    );

    expect(prompt.confirm).toHaveBeenCalledWith("Install Newtonsoft.Json 13.0.3 on 2 projects?");
    expect(result.skipped).toEqual([
      { path: "/Solution/Legacy/Legacy.csproj", reason: "legacy project" },
      {
        path: "/Solution/AlreadyInstalled/AlreadyInstalled.csproj",
        reason: "already installed",
      },
    ]);
    expect(result.status).toBe("Ok");
    expect(result.filesChanged).toEqual([
      "/Solution/CandidateA/CandidateA.csproj",
      "/Solution/CandidateB/CandidateB.csproj",
    ]);
    expect(result.affectedProjects).toEqual(result.filesChanged);
    expect(restoreScheduler.schedule).toHaveBeenCalledWith("/Solution/My.sln");
  });

  it("confirmation refused → no write", async () => {
    const { handler, prompt, restoreScheduler, metadataCache, tfmCache } = createHandler({
      apiClient: {
        getRegistrationLeaves: jest.fn().mockResolvedValue(leavesFor("13.0.3", ["netstandard2.0"])),
      },
      prompt: { confirm: jest.fn().mockResolvedValue(false) },
    });
    const invalidateMeta = jest.spyOn(metadataCache, "invalidate");
    const invalidateTfm = jest.spyOn(tfmCache, "invalidate");

    const result = await handler.Handle(
      new InstallPackageCommand("Newtonsoft.Json", "13.0.3", "/Solution/My.sln"),
    );

    expect(prompt.confirm).toHaveBeenCalledTimes(1);
    expect(mockFs.writeFileSync).not.toHaveBeenCalled();
    expect(restoreScheduler.schedule).not.toHaveBeenCalled();
    expect(invalidateMeta).not.toHaveBeenCalled();
    expect(invalidateTfm).not.toHaveBeenCalled();
    expect(result).toEqual({
      status: "Ok",
      filesChanged: [],
      affectedProjects: [],
      skipped: [],
    });
  });
});

describe("InstallPackageCommandHandler - CPM (Directory.Packages.props)", () => {
  const CPM_SLN = `Microsoft Visual Studio Solution File, Format Version 12.00
Project("{FAE04EC0-301F-11D3-BF4B-00C04F79EFBC}") = "Api", "Api\\Api.csproj", "{11111111-1111-1111-1111-111111111111}"
EndProject
`;

  // Under CPM, PackageReference elements no longer carry a Version attribute (delegated to
  // Directory.Packages.props).
  const API_CSPROJ_CPM = `<Project Sdk="Microsoft.NET.Sdk">
  <PropertyGroup><TargetFramework>net8.0</TargetFramework></PropertyGroup>
  <ItemGroup>
    <PackageReference Include="Microsoft.Extensions.Logging" />
  </ItemGroup>
</Project>`;

  const DIRECTORY_PACKAGES_PROPS = `<Project>
  <PropertyGroup>
    <ManagePackageVersionsCentrally>true</ManagePackageVersionsCentrally>
  </PropertyGroup>
  <ItemGroup>
    <PackageVersion Include="Microsoft.Extensions.Logging" Version="8.0.0" />
  </ItemGroup>
</Project>`;

  beforeEach(() => {
    jest.clearAllMocks();
    // A workspace folder is required for BuildConfigDetector
    // interroge vscode.workspace.findFiles.
    (vscode.workspace as unknown as { workspaceFolders?: unknown }).workspaceFolders = [
      { uri: { fsPath: "/Solution" } },
    ];
    setFiles({
      "/Solution/My.sln": CPM_SLN,
      "/Solution/Api/Api.csproj": API_CSPROJ_CPM,
      "/Solution/Directory.Packages.props": DIRECTORY_PACKAGES_PROPS,
    });

    // BuildConfigDetector.findAllConfigFiles queries three patterns
    // (Directory.Build.props, Directory.Build.targets, Directory.Packages.props);
    // only the last one must return a match here.
    (vscode.workspace.findFiles as jest.Mock).mockImplementation((pattern: string) => {
      if (pattern.includes("Directory.Packages.props")) {
        return Promise.resolve([vscode.Uri.file("/Solution/Directory.Packages.props")]);
      }
      return Promise.resolve([]);
    });
  });

  it("CPM: adds the reference without a Version and creates the missing PackageVersion only once", async () => {
    const { handler, restoreScheduler } = createHandler({
      apiClient: {
        getRegistrationLeaves: jest.fn().mockResolvedValue(leavesFor("3.1.0", ["netstandard2.0"])),
      },
    });

    const result = await handler.Handle(
      new InstallPackageCommand("Serilog", "3.1.0", "/Solution/My.sln", "/Solution/Api/Api.csproj"),
    );

    expect(result.status).toBe("Ok");
    expect(result.affectedProjects).toEqual(["/Solution/Api/Api.csproj"]);
    expect(result.filesChanged).toEqual([
      "/Solution/Api/Api.csproj",
      "/Solution/Directory.Packages.props",
    ]);

    // Exactly one write per file: the central version is created only once.
    expect(mockFs.writeFileSync).toHaveBeenCalledTimes(2);

    const csprojWrite = mockFs.writeFileSync.mock.calls.find(
      ([p]) => p === "/Solution/Api/Api.csproj",
    );
    expect(csprojWrite![1]).toContain('<PackageReference Include="Serilog" />');
    expect(csprojWrite![1]).not.toMatch(/Serilog"[^>]*Version=/);

    const cpmWrite = mockFs.writeFileSync.mock.calls.find(
      ([p]) => p === "/Solution/Directory.Packages.props",
    );
    expect(cpmWrite![1]).toContain('<PackageVersion Include="Serilog" Version="3.1.0" />');

    expect(restoreScheduler.schedule).toHaveBeenCalledWith("/Solution/My.sln");
  });

  it("CPM file read failure → Error result, no silent success even though the csproj was already written", async () => {
    const { handler, restoreScheduler, metadataCache, tfmCache } = createHandler({
      apiClient: {
        getRegistrationLeaves: jest.fn().mockResolvedValue(leavesFor("3.1.0", ["netstandard2.0"])),
      },
    });
    const invalidateMeta = jest.spyOn(metadataCache, "invalidate");
    const invalidateTfm = jest.spyOn(tfmCache, "invalidate");

    // Target resolution (PackageWriteTargetResolver → BuildConfigParser +
    // CpmDiagnosticService) already reads the CPM file several times to detect the
    // existing central versions: those reads (all BEFORE any write) must succeed, or
    // no target would even be resolved. Only the re-read performed by ensureCpmVersion —
    // after the csproj has already been written, right before editing the CPM file
    // itself — must fail here, e.g. file locked or deleted in the meantime. The two are
    // told apart by actual execution order rather than by a call count, which would be
    // brittle and coupled to internal details
    // du resolver.
    mockFs.readFileSync.mockImplementation((p) => {
      if (p === "/Solution/Directory.Packages.props") {
        const csprojAlreadyWritten = mockFs.writeFileSync.mock.calls.some(
          ([writtenPath]) => writtenPath === "/Solution/Api/Api.csproj",
        );
        if (csprojAlreadyWritten) {
          throw new Error("EACCES: permission denied");
        }
        return DIRECTORY_PACKAGES_PROPS;
      }
      const files: Record<string, string> = {
        "/Solution/My.sln": CPM_SLN,
        "/Solution/Api/Api.csproj": API_CSPROJ_CPM,
      };
      const content = files[p as string];
      if (content === undefined) {
        throw new Error(`ENOENT: ${p}`);
      }
      return content;
    });

    const result = await handler.Handle(
      new InstallPackageCommand("Serilog", "3.1.0", "/Solution/My.sln", "/Solution/Api/Api.csproj"),
    );

    // The csproj was written before the CPM failure: a successful write is never lost.
    expect(mockFs.writeFileSync).toHaveBeenCalledTimes(1);
    expect(mockFs.writeFileSync).toHaveBeenCalledWith(
      "/Solution/Api/Api.csproj",
      expect.stringContaining('<PackageReference Include="Serilog" />'),
    );

    expect(result.status).toBe("Error");
    expect(result.error).toContain("/Solution/Directory.Packages.props");
    expect(result.filesChanged).toEqual(["/Solution/Api/Api.csproj"]);
    expect(result.affectedProjects).toEqual(["/Solution/Api/Api.csproj"]);

    // The csproj was modified successfully: caches and restore must still be
    // triggered despite the CPM file failure.
    expect(invalidateMeta).toHaveBeenCalledWith("/Solution/My.sln::serilog");
    expect(invalidateTfm).toHaveBeenCalledWith("/Solution/My.sln");
    expect(restoreScheduler.schedule).toHaveBeenCalledWith("/Solution/My.sln");
  });

  it("global install on 2 CPM projects with a central PackageVersion write failure → the 1st csproj stays in filesChanged, the 2nd project is skipped WITHOUT a write (Finding 5)", async () => {
    const TWO_PROJECTS_SLN = `Microsoft Visual Studio Solution File, Format Version 12.00
Project("{FAE04EC0-301F-11D3-BF4B-00C04F79EFBC}") = "ApiA", "ApiA\\ApiA.csproj", "{11111111-1111-1111-1111-111111111111}"
EndProject
Project("{FAE04EC0-301F-11D3-BF4B-00C04F79EFBC}") = "ApiB", "ApiB\\ApiB.csproj", "{22222222-2222-2222-2222-222222222222}"
EndProject
`;
    const API_A_CSPROJ_CPM = `<Project Sdk="Microsoft.NET.Sdk">
  <PropertyGroup><TargetFramework>net8.0</TargetFramework></PropertyGroup>
</Project>`;
    const API_B_CSPROJ_CPM = `<Project Sdk="Microsoft.NET.Sdk">
  <PropertyGroup><TargetFramework>net8.0</TargetFramework></PropertyGroup>
</Project>`;

    setFiles({
      "/Solution/My.sln": TWO_PROJECTS_SLN,
      "/Solution/ApiA/ApiA.csproj": API_A_CSPROJ_CPM,
      "/Solution/ApiB/ApiB.csproj": API_B_CSPROJ_CPM,
      "/Solution/Directory.Packages.props": DIRECTORY_PACKAGES_PROPS,
    });

    mockFs.writeFileSync.mockImplementation((p) => {
      if (p === "/Solution/Directory.Packages.props") {
        throw new Error("ENOSPC: no space left on device");
      }
      return undefined;
    });

    const { handler, prompt, restoreScheduler } = createHandler({
      apiClient: {
        getRegistrationLeaves: jest.fn().mockResolvedValue(leavesFor("3.1.0", ["netstandard2.0"])),
      },
    });

    const result = await handler.Handle(
      new InstallPackageCommand("Serilog", "3.1.0", "/Solution/My.sln"),
    );

    expect(prompt.confirm).toHaveBeenCalledWith("Install Serilog 3.1.0 on 2 projects?");

    // A single csproj written (ApiA, before the CPM failure was known): never a
    // second csproj written after the central write has failed (Finding 5).
    const apiAWrite = mockFs.writeFileSync.mock.calls.find(
      ([p]) => p === "/Solution/ApiA/ApiA.csproj",
    );
    const apiBWrite = mockFs.writeFileSync.mock.calls.find(
      ([p]) => p === "/Solution/ApiB/ApiB.csproj",
    );
    expect(apiAWrite).toBeDefined();
    expect(apiBWrite).toBeUndefined();

    expect(result.status).toBe("Ok");
    expect(result.filesChanged).toEqual(["/Solution/ApiA/ApiA.csproj"]);
    expect(result.affectedProjects).toEqual(["/Solution/ApiA/ApiA.csproj"]);

    // Two skipped entries: the CPM file (write failure) and ApiB (never attempted,
    // because the central write it depends on had already failed for ApiA).
    expect(result.skipped).toHaveLength(2);
    expect(result.skipped).toContainEqual(
      expect.objectContaining({ path: "/Solution/Directory.Packages.props" }),
    );
    const apiBSkipped = result.skipped.find((s) => s.path === "/Solution/ApiB/ApiB.csproj");
    expect(apiBSkipped).toBeDefined();
    expect(apiBSkipped!.reason).toContain("Serilog");

    expect(restoreScheduler.schedule).toHaveBeenCalledWith("/Solution/My.sln");
  });

  it("CPM file write failure → no exception escapes Handle(), Error result, caches and restore still triggered", async () => {
    const { handler, restoreScheduler, metadataCache, tfmCache } = createHandler({
      apiClient: {
        getRegistrationLeaves: jest.fn().mockResolvedValue(leavesFor("3.1.0", ["netstandard2.0"])),
      },
    });
    const invalidateMeta = jest.spyOn(metadataCache, "invalidate");
    const invalidateTfm = jest.spyOn(tfmCache, "invalidate");

    mockFs.writeFileSync.mockImplementation((p) => {
      if (p === "/Solution/Directory.Packages.props") {
        throw new Error("ENOSPC: no space left on device");
      }
      return undefined;
    });

    // If the CPM file write were not guarded, this call would reject: the mere fact
    // that `await` resolves here proves no exception leaks.
    const result = await handler.Handle(
      new InstallPackageCommand("Serilog", "3.1.0", "/Solution/My.sln", "/Solution/Api/Api.csproj"),
    );

    const csprojWrite = mockFs.writeFileSync.mock.calls.find(
      ([p]) => p === "/Solution/Api/Api.csproj",
    );
    expect(csprojWrite).toBeDefined();

    expect(result.status).toBe("Error");
    expect(result.error).toContain("/Solution/Directory.Packages.props");
    expect(result.filesChanged).toEqual(["/Solution/Api/Api.csproj"]);
    expect(result.affectedProjects).toEqual(["/Solution/Api/Api.csproj"]);

    // The csproj was modified successfully: caches and restore must still be
    // triggered despite the CPM file write failure.
    expect(invalidateMeta).toHaveBeenCalledWith("/Solution/My.sln::serilog");
    expect(invalidateTfm).toHaveBeenCalledWith("/Solution/My.sln");
    expect(restoreScheduler.schedule).toHaveBeenCalledWith("/Solution/My.sln");
  });
});
