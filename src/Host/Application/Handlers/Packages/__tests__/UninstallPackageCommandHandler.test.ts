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
import { UninstallPackageCommandHandler } from "../UninstallPackageCommandHandler";
import { UninstallPackageCommand } from "@Shared/Features/Commands/UninstallPackageCommand";
import { MsBuildTextEditor } from "@Infrastructure/MsBuild/MsBuildTextEditor";
import { type RestoreScheduler } from "@Infrastructure/MsBuild/RestoreScheduler";
import { PackageMetadataCache } from "@Infrastructure/NuGet/PackageMetadataCache";
import { ProjectTfmCache } from "@Infrastructure/Projects/ProjectTfmCache";
import { type IUserPrompt } from "../../../Abstractions/Prompt/IUserPrompt";
import { type ILogger } from "../../../Abstractions/Log/ILogger";

const mockFs = fs as jest.Mocked<typeof fs>;

const noOpLogger: ILogger = {
  Info: jest.fn(),
  Warning: jest.fn(),
  Error: jest.fn(),
  Debug: jest.fn(),
};

type Fakes = {
  restoreScheduler: { schedule: jest.Mock };
  prompt: { confirm: jest.Mock };
  metadataCache: PackageMetadataCache;
  tfmCache: ProjectTfmCache;
};

function createHandler(overrides?: {
  prompt?: { confirm: jest.Mock };
}): { handler: UninstallPackageCommandHandler } & Fakes {
  const restoreScheduler = { schedule: jest.fn() };
  const prompt = overrides?.prompt ?? { confirm: jest.fn().mockResolvedValue(true) };
  const metadataCache = new PackageMetadataCache();
  const tfmCache = new ProjectTfmCache();

  const handler = new UninstallPackageCommandHandler(
    createPackageWriteTargetResolver(),
    new MsBuildTextEditor(),
    restoreScheduler as unknown as RestoreScheduler,
    metadataCache,
    tfmCache,
    prompt as unknown as IUserPrompt,
    noOpLogger,
  );

  return { handler, restoreScheduler, prompt, metadataCache, tfmCache };
}

/**
 * Contrairement aux autres handlers d'écriture, l'orphelinage CPM exige une
 * RE-résolution des cibles APRÈS écriture : `writeFileSync` doit donc
 * persister dans le même magasin que `readFileSync`, pour que la seconde
 * résolution voie l'état déjà modifié (sans quoi le nettoyage CPM ne pourrait
 * jamais constater qu'un projet ne référence plus le package).
 */
function setFiles(initial: Record<string, string>): Record<string, string> {
  const files: Record<string, string> = { ...initial };
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
  mockFs.writeFileSync.mockImplementation((p, content) => {
    files[p as string] = content as string;
  });
  return files;
}

describe("UninstallPackageCommandHandler - cible explicite", () => {
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

  it("désinstalle du projet cible (écriture disque + restore programmé)", async () => {
    const { handler, restoreScheduler, metadataCache, tfmCache } = createHandler();
    const invalidateMeta = jest.spyOn(metadataCache, "invalidate");
    const invalidateTfm = jest.spyOn(tfmCache, "invalidate");

    const result = await handler.Handle(
      new UninstallPackageCommand("Serilog", "/Solution/My.sln", "/Solution/Api/Api.csproj"),
    );

    const written = mockFs.writeFileSync.mock.calls.find(([p]) => p === "/Solution/Api/Api.csproj");
    expect(written).toBeDefined();
    expect(written![1]).not.toContain("Serilog");

    expect(restoreScheduler.schedule).toHaveBeenCalledWith("/Solution/My.sln");
    expect(invalidateMeta).toHaveBeenCalledWith("/Solution/My.sln::serilog");
    expect(invalidateTfm).toHaveBeenCalledWith("/Solution/My.sln");

    expect(result).toEqual({
      status: "Ok",
      filesChanged: ["/Solution/Api/Api.csproj"],
      affectedProjects: ["/Solution/Api/Api.csproj"],
      skipped: [],
    });
  });

  it("packageId invalide (caractère d'injection XML) → Error sans résolution ni écriture (Finding 3a)", async () => {
    const { handler, restoreScheduler } = createHandler();

    const result = await handler.Handle(
      new UninstallPackageCommand(
        'Evil" Foo="bar',
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

  it("package non installé sur la cible → skipped", async () => {
    const { handler, restoreScheduler } = createHandler();

    const result = await handler.Handle(
      new UninstallPackageCommand("Serilog", "/Solution/My.sln", "/Solution/Core/Core.csproj"),
    );

    expect(mockFs.writeFileSync).not.toHaveBeenCalled();
    expect(restoreScheduler.schedule).not.toHaveBeenCalled();
    expect(result).toEqual({
      status: "Ok",
      filesChanged: [],
      affectedProjects: [],
      skipped: [{ projectPath: "/Solution/Core/Core.csproj", reason: "not installed" }],
    });
  });
});

describe("UninstallPackageCommandHandler - désinstallation globale", () => {
  const SLN = `Microsoft Visual Studio Solution File, Format Version 12.00
Project("{FAE04EC0-301F-11D3-BF4B-00C04F79EFBC}") = "CandidateA", "CandidateA\\CandidateA.csproj", "{11111111-1111-1111-1111-111111111111}"
EndProject
Project("{FAE04EC0-301F-11D3-BF4B-00C04F79EFBC}") = "CandidateB", "CandidateB\\CandidateB.csproj", "{22222222-2222-2222-2222-222222222222}"
EndProject
Project("{FAE04EC0-301F-11D3-BF4B-00C04F79EFBC}") = "NotInstalled", "NotInstalled\\NotInstalled.csproj", "{33333333-3333-3333-3333-333333333333}"
EndProject
`;

  const CANDIDATE_A_CSPROJ = `<Project Sdk="Microsoft.NET.Sdk">
  <PropertyGroup><TargetFramework>net8.0</TargetFramework></PropertyGroup>
  <ItemGroup>
    <PackageReference Include="Newtonsoft.Json" Version="12.0.3" />
  </ItemGroup>
</Project>`;

  const CANDIDATE_B_CSPROJ = `<Project Sdk="Microsoft.NET.Sdk">
  <PropertyGroup><TargetFramework>net8.0</TargetFramework></PropertyGroup>
  <ItemGroup>
    <PackageReference Include="Newtonsoft.Json" Version="12.0.3" />
  </ItemGroup>
</Project>`;

  const NOT_INSTALLED_CSPROJ = `<Project Sdk="Microsoft.NET.Sdk">
  <PropertyGroup><TargetFramework>net8.0</TargetFramework></PropertyGroup>
</Project>`;

  beforeEach(() => {
    jest.clearAllMocks();
    (vscode.workspace as unknown as { workspaceFolders?: unknown }).workspaceFolders = undefined;
    setFiles({
      "/Solution/My.sln": SLN,
      "/Solution/CandidateA/CandidateA.csproj": CANDIDATE_A_CSPROJ,
      "/Solution/CandidateB/CandidateB.csproj": CANDIDATE_B_CSPROJ,
      "/Solution/NotInstalled/NotInstalled.csproj": NOT_INSTALLED_CSPROJ,
    });
  });

  it("désinstallation globale : confirme si plus d'un projet candidat, puis retire de tous", async () => {
    const { handler, prompt, restoreScheduler } = createHandler();

    const result = await handler.Handle(
      new UninstallPackageCommand("Newtonsoft.Json", "/Solution/My.sln"),
    );

    expect(prompt.confirm).toHaveBeenCalledWith("Uninstall Newtonsoft.Json from 2 projects?");

    const writtenA = mockFs.writeFileSync.mock.calls.find(
      ([p]) => p === "/Solution/CandidateA/CandidateA.csproj",
    );
    const writtenB = mockFs.writeFileSync.mock.calls.find(
      ([p]) => p === "/Solution/CandidateB/CandidateB.csproj",
    );
    expect(writtenA![1]).not.toContain("Newtonsoft.Json");
    expect(writtenB![1]).not.toContain("Newtonsoft.Json");

    expect(result).toEqual({
      status: "Ok",
      filesChanged: [
        "/Solution/CandidateA/CandidateA.csproj",
        "/Solution/CandidateB/CandidateB.csproj",
      ],
      affectedProjects: [
        "/Solution/CandidateA/CandidateA.csproj",
        "/Solution/CandidateB/CandidateB.csproj",
      ],
      skipped: [],
    });
    expect(restoreScheduler.schedule).toHaveBeenCalledWith("/Solution/My.sln");
  });
});

describe("UninstallPackageCommandHandler - CPM (Directory.Packages.props)", () => {
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

  it("CPM : dernier consommateur retiré → le PackageVersion orphelin est retiré (deux fichiers dans filesChanged)", async () => {
    const CPM_SLN = `Microsoft Visual Studio Solution File, Format Version 12.00
Project("{FAE04EC0-301F-11D3-BF4B-00C04F79EFBC}") = "Api", "Api\\Api.csproj", "{11111111-1111-1111-1111-111111111111}"
EndProject
`;
    const API_CSPROJ_CPM = `<Project Sdk="Microsoft.NET.Sdk">
  <PropertyGroup><TargetFramework>net8.0</TargetFramework></PropertyGroup>
  <ItemGroup>
    <PackageReference Include="Microsoft.Extensions.Logging" />
  </ItemGroup>
</Project>`;
    setFiles({
      "/Solution/My.sln": CPM_SLN,
      "/Solution/Api/Api.csproj": API_CSPROJ_CPM,
      "/Solution/Directory.Packages.props": DIRECTORY_PACKAGES_PROPS,
    });

    const { handler, restoreScheduler } = createHandler();

    const result = await handler.Handle(
      new UninstallPackageCommand(
        "Microsoft.Extensions.Logging",
        "/Solution/My.sln",
        "/Solution/Api/Api.csproj",
      ),
    );

    expect(result.status).toBe("Ok");
    expect(result.affectedProjects).toEqual(["/Solution/Api/Api.csproj"]);
    expect(result.filesChanged).toEqual([
      "/Solution/Api/Api.csproj",
      "/Solution/Directory.Packages.props",
    ]);
    expect(result.skipped).toEqual([]);

    const csprojWrite = mockFs.writeFileSync.mock.calls.find(
      ([p]) => p === "/Solution/Api/Api.csproj",
    );
    expect(csprojWrite![1]).not.toContain("Microsoft.Extensions.Logging");

    const cpmWrite = mockFs.writeFileSync.mock.calls.find(
      ([p]) => p === "/Solution/Directory.Packages.props",
    );
    expect(cpmWrite![1]).not.toContain("Microsoft.Extensions.Logging");

    expect(restoreScheduler.schedule).toHaveBeenCalledWith("/Solution/My.sln");
  });

  it("CPM : un consommateur restant → le PackageVersion central est conservé", async () => {
    const CPM_SLN = `Microsoft Visual Studio Solution File, Format Version 12.00
Project("{FAE04EC0-301F-11D3-BF4B-00C04F79EFBC}") = "Api", "Api\\Api.csproj", "{11111111-1111-1111-1111-111111111111}"
EndProject
Project("{FAE04EC0-301F-11D3-BF4B-00C04F79EFBC}") = "Worker", "Worker\\Worker.csproj", "{22222222-2222-2222-2222-222222222222}"
EndProject
`;
    const API_CSPROJ_CPM = `<Project Sdk="Microsoft.NET.Sdk">
  <PropertyGroup><TargetFramework>net8.0</TargetFramework></PropertyGroup>
  <ItemGroup>
    <PackageReference Include="Microsoft.Extensions.Logging" />
  </ItemGroup>
</Project>`;
    const WORKER_CSPROJ_CPM = `<Project Sdk="Microsoft.NET.Sdk">
  <PropertyGroup><TargetFramework>net8.0</TargetFramework></PropertyGroup>
  <ItemGroup>
    <PackageReference Include="Microsoft.Extensions.Logging" />
  </ItemGroup>
</Project>`;
    setFiles({
      "/Solution/My.sln": CPM_SLN,
      "/Solution/Api/Api.csproj": API_CSPROJ_CPM,
      "/Solution/Worker/Worker.csproj": WORKER_CSPROJ_CPM,
      "/Solution/Directory.Packages.props": DIRECTORY_PACKAGES_PROPS,
    });

    const { handler, restoreScheduler } = createHandler();

    const result = await handler.Handle(
      new UninstallPackageCommand(
        "Microsoft.Extensions.Logging",
        "/Solution/My.sln",
        "/Solution/Api/Api.csproj",
      ),
    );

    expect(result.status).toBe("Ok");
    expect(result.affectedProjects).toEqual(["/Solution/Api/Api.csproj"]);
    expect(result.filesChanged).toEqual(["/Solution/Api/Api.csproj"]);
    expect(result.skipped).toEqual([]);

    // Une seule écriture : le csproj retiré, jamais le fichier central puisque
    // Worker référence toujours le package.
    expect(mockFs.writeFileSync).toHaveBeenCalledTimes(1);
    const cpmWrite = mockFs.writeFileSync.mock.calls.find(
      ([p]) => p === "/Solution/Directory.Packages.props",
    );
    expect(cpmWrite).toBeUndefined();

    expect(restoreScheduler.schedule).toHaveBeenCalledWith("/Solution/My.sln");
  });
});
