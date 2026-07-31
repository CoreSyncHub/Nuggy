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

/** Registration factice avec un seul leaf pour `version`, ciblant `targetFrameworks`. */
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

  it("installe sur le projet cible (écriture disque + restore programmé)", async () => {
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

  it("verdict Incompatible pour la version demandée → skipped avec raison", async () => {
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

  it("packageId invalide (caractère d'injection XML) → Error sans résolution ni écriture (Finding 3a)", async () => {
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

  it("version invalide (caractère d'injection XML) → Error sans résolution ni écriture (Finding 3a)", async () => {
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

  it("journalise l'opération dans OperationLogStore avec les données du DTO", async () => {
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

  it("journalise aussi les erreurs de validation", async () => {
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

  it("registration inaccessible → Unknown → installation autorisée", async () => {
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

  it("install global : saute les projets déjà équipés et les legacy, confirme si >1 cible", async () => {
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

  it("refus de confirmation → aucune écriture", async () => {
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

  // En CPM, les PackageReference n'ont plus d'attribut Version (délégué au
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
    // Un dossier de workspace est requis pour que BuildConfigDetector
    // interroge vscode.workspace.findFiles.
    (vscode.workspace as unknown as { workspaceFolders?: unknown }).workspaceFolders = [
      { uri: { fsPath: "/Solution" } },
    ];
    setFiles({
      "/Solution/My.sln": CPM_SLN,
      "/Solution/Api/Api.csproj": API_CSPROJ_CPM,
      "/Solution/Directory.Packages.props": DIRECTORY_PACKAGES_PROPS,
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

  it("CPM : ajoute la référence sans Version et crée le PackageVersion manquant une seule fois", async () => {
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

    // Exactement une écriture par fichier : la version centrale n'est créée qu'une fois.
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

  it("échec de lecture du fichier CPM → résultat Error, pas de succès silencieux malgré le csproj déjà écrit", async () => {
    const { handler, restoreScheduler, metadataCache, tfmCache } = createHandler({
      apiClient: {
        getRegistrationLeaves: jest.fn().mockResolvedValue(leavesFor("3.1.0", ["netstandard2.0"])),
      },
    });
    const invalidateMeta = jest.spyOn(metadataCache, "invalidate");
    const invalidateTfm = jest.spyOn(tfmCache, "invalidate");

    // La résolution des cibles (PackageWriteTargetResolver → BuildConfigParser +
    // CpmDiagnosticService) lit déjà le fichier CPM plusieurs fois pour détecter les
    // versions centrales existantes : ces lectures-là (toutes AVANT toute écriture)
    // doivent réussir, sans quoi aucune cible ne serait même résolue. Seule la
    // relecture faite par ensureCpmVersion — après que le csproj a déjà été écrit,
    // juste avant l'édition du fichier CPM lui-même — doit échouer ici, ex. fichier
    // verrouillé/supprimé entre-temps. On distingue les deux par ordre d'exécution
    // réel plutôt que par un nombre d'appels fragile et couplé aux détails internes
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

    // Le csproj a bien été écrit avant l'échec du fichier CPM : jamais perdu de l'écriture réussie.
    expect(mockFs.writeFileSync).toHaveBeenCalledTimes(1);
    expect(mockFs.writeFileSync).toHaveBeenCalledWith(
      "/Solution/Api/Api.csproj",
      expect.stringContaining('<PackageReference Include="Serilog" />'),
    );

    expect(result.status).toBe("Error");
    expect(result.error).toContain("/Solution/Directory.Packages.props");
    expect(result.filesChanged).toEqual(["/Solution/Api/Api.csproj"]);
    expect(result.affectedProjects).toEqual(["/Solution/Api/Api.csproj"]);

    // Le csproj a été modifié avec succès : les caches et le restore doivent quand
    // même être déclenchés malgré l'échec du fichier CPM.
    expect(invalidateMeta).toHaveBeenCalledWith("/Solution/My.sln::serilog");
    expect(invalidateTfm).toHaveBeenCalledWith("/Solution/My.sln");
    expect(restoreScheduler.schedule).toHaveBeenCalledWith("/Solution/My.sln");
  });

  it("install global sur 2 projets CPM avec échec de l'écriture du PackageVersion central → le 1er csproj reste dans filesChanged, le 2e projet est skipped SANS écriture (Finding 5)", async () => {
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

    // Un seul csproj écrit (ApiA, avant que l'échec CPM ne soit connu) : jamais un
    // second csproj écrit après que l'écriture centrale a échoué (Finding 5).
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

    // Deux entrées skipped : le fichier CPM (échec d'écriture) et ApiB (jamais tenté,
    // car l'écriture centrale dont il dépend a déjà échoué pour ApiA).
    expect(result.skipped).toHaveLength(2);
    expect(result.skipped).toContainEqual(
      expect.objectContaining({ path: "/Solution/Directory.Packages.props" }),
    );
    const apiBSkipped = result.skipped.find((s) => s.path === "/Solution/ApiB/ApiB.csproj");
    expect(apiBSkipped).toBeDefined();
    expect(apiBSkipped!.reason).toContain("Serilog");

    expect(restoreScheduler.schedule).toHaveBeenCalledWith("/Solution/My.sln");
  });

  it("échec d'écriture du fichier CPM → aucune exception ne s'échappe de Handle(), résultat Error, caches et restore quand même déclenchés", async () => {
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

    // Si l'écriture du fichier CPM n'était pas protégée, cet appel rejetterait :
    // le simple fait que `await` se résout ici prouve qu'aucune exception ne fuit.
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

    // Le csproj a été modifié avec succès : les caches et le restore doivent quand
    // même être déclenchés malgré l'échec d'écriture du fichier CPM.
    expect(invalidateMeta).toHaveBeenCalledWith("/Solution/My.sln::serilog");
    expect(invalidateTfm).toHaveBeenCalledWith("/Solution/My.sln");
    expect(restoreScheduler.schedule).toHaveBeenCalledWith("/Solution/My.sln");
  });
});
