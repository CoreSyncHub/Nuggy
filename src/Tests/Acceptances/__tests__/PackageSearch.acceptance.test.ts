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

import { SearchPackagesQuery } from "@Shared/Features/Queries/SearchPackagesQuery";
import { SearchPackagesQueryHandler } from "@Application/Handlers/Packages/SearchPackagesQueryHandler";
import { InstallPackageCommandHandler } from "@Application/Handlers/Packages/InstallPackageCommandHandler";
import { InstallPackageCommand } from "@Shared/Features/Commands/InstallPackageCommand";
import { GetSolutionPackagesQuery } from "@Shared/Features/Queries/GetSolutionPackagesQuery";
import { PackageSearchService } from "@Infrastructure/NuGet/PackageSearchService";
import { RestoreScheduler } from "@Infrastructure/MsBuild/RestoreScheduler";
import { OperationLogStore } from "@Infrastructure/MsBuild/OperationLogStore";
import { MsBuildTextEditor } from "@Infrastructure/MsBuild/MsBuildTextEditor";
import { PackageMetadataCache } from "@Infrastructure/NuGet/PackageMetadataCache";
import { ProjectTfmCache } from "@Infrastructure/Projects/ProjectTfmCache";
import { TfmCompatibilityService } from "@Infrastructure/Projects/TfmCompatibilityService";
import { SlnParser } from "@Infrastructure/Solution/SlnParser";
import { SlnxParser } from "@Infrastructure/Solution/SlnxParser";
import { BuildConfigDetector } from "@Infrastructure/Build/BuildConfigDetector";
import { BuildConfigParser } from "@Infrastructure/Build/BuildConfigParser";
import { TfmResolver } from "@Infrastructure/Projects/TfmResolver";
import { ProjectTfmResolutionService } from "@Infrastructure/Projects/ProjectTfmResolutionService";
import { CsprojParser } from "@Infrastructure/Projects/CsprojParser";
import { type IProcessRunner } from "@Infrastructure/MsBuild/ProcessRunner";
import { type NuGetV3ApiClient } from "@Infrastructure/NuGet/NuGetV3ApiClient";
import { type IUserPrompt } from "@Application/Abstractions/Prompt/IUserPrompt";
import { type IPackageSearchSource } from "@/Host/Application/Abstractions/Search/IPackageSearchSource";
import { type ILogger } from "@/Host/Application/Abstractions/Log/ILogger";
import {
  createPackageWriteTargetResolver,
  createSolutionPackagesHandler,
} from "../../Helpers/createHandlers";

const mockFs = fs as jest.Mocked<typeof fs>;

const noOpLogger: ILogger = {
  Info: jest.fn(),
  Warning: jest.fn(),
  Error: jest.fn(),
  Debug: jest.fn(),
};

/** Source factice servant les résultats : l'acceptance ne touche jamais le réseau. */
const fakeSource: IPackageSearchSource = {
  name: "nuget.org",
  search: jest.fn().mockResolvedValue({
    hits: [
      {
        id: "Refit",
        description: "REST library",
        latestVersion: "7.0.0",
        totalDownloads: 120,
        verified: true,
        sourceName: "nuget.org",
      },
    ],
    rawCount: 1,
  }),
};

/** Source factice qui échoue toujours : couvre réellement le chemin de la
 *  source en échec plutôt que de se contenter d'un intitulé de test qui le
 *  prétend sans qu'aucune source ne rejette jamais. */
const failingSource: IPackageSearchSource = {
  name: "interne",
  search: jest.fn().mockRejectedValue(new Error("feed interne injoignable")),
};

const SLN = `Microsoft Visual Studio Solution File, Format Version 12.00
Project("{FAE04EC0-301F-11D3-BF4B-00C04F79EFBC}") = "Api", "Api\\Api.csproj", "{11111111-1111-1111-1111-111111111111}"
EndProject
`;

const API_CSPROJ = `<Project Sdk="Microsoft.NET.Sdk">
  <PropertyGroup><TargetFramework>net8.0</TargetFramework></PropertyGroup>
</Project>`;

/** Même socle que PackageWrites.acceptance.test.ts : les écritures persistent
 *  dans le même magasin que les lectures, pour que GetSolutionPackagesQuery
 *  relise exactement ce que l'installation vient d'écrire. */
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

describe("Acceptance : recherche de packages", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("sert les résultats, la pagination et les sources en échec", async () => {
    const handler = new SearchPackagesQueryHandler(
      new PackageSearchService([fakeSource, failingSource], noOpLogger),
    );

    const dto = await handler.Handle(new SearchPackagesQuery("refit", 0, 25, false));

    expect(dto.hits).toEqual([
      {
        id: "Refit",
        description: "REST library",
        latestVersion: "7.0.0",
        totalDownloads: 120,
        verified: true,
        sourceName: "nuget.org",
      },
    ]);
    expect(dto.hasMore).toBe(false);
    expect(dto.failedSources).toEqual(["interne"]);
    expect(fakeSource.search).toHaveBeenCalledWith("refit", {
      skip: 0,
      take: 25,
      includePrerelease: false,
    });
  });

  it("recherche, sélectionne un résultat, l'installe sur un projet puis le retrouve dans les packages installés de la solution", async () => {
    const files = setFiles({
      "/Solution/My.sln": SLN,
      "/Solution/Api/Api.csproj": API_CSPROJ,
    });

    // ---- Recherche ----
    const searchHandler = new SearchPackagesQueryHandler(
      new PackageSearchService([fakeSource], noOpLogger),
    );
    const searchDto = await searchHandler.Handle(new SearchPackagesQuery("refit", 0, 25, false));

    // ---- Sélection du résultat trouvé ----
    const selected = searchDto.hits.find((h) => h.id === "Refit");
    expect(selected).toBeDefined();

    // ---- Installation sur le projet Api ----
    const processRunner: IProcessRunner = {
      run: jest.fn().mockResolvedValue({ exitCode: 0, output: "", timedOut: false }),
    };
    const operationLog = new OperationLogStore();
    const restoreScheduler = new RestoreScheduler(operationLog, processRunner, noOpLogger);
    const metadataCache = new PackageMetadataCache();
    const tfmCache = new ProjectTfmCache();
    const prompt: IUserPrompt = { confirm: jest.fn().mockResolvedValue(true) };
    // Registration introuvable → verdict Unknown → jamais bloquant (même motif
    // que InstallPackageCommandHandler.test.ts et PackageWrites.acceptance.test.ts).
    const apiClient = { getRegistrationLeaves: jest.fn().mockResolvedValue([]) };

    const installHandler = new InstallPackageCommandHandler(
      operationLog,
      createPackageWriteTargetResolver(),
      new MsBuildTextEditor(),
      restoreScheduler,
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
      prompt,
      noOpLogger,
    );

    const installResult = await installHandler.Handle(
      new InstallPackageCommand(
        selected!.id,
        selected!.latestVersion,
        "/Solution/My.sln",
        "/Solution/Api/Api.csproj",
      ),
    );

    expect(installResult).toEqual({
      status: "Ok",
      filesChanged: ["/Solution/Api/Api.csproj"],
      affectedProjects: ["/Solution/Api/Api.csproj"],
      skipped: [],
    });
    expect(files["/Solution/Api/Api.csproj"]).toContain(
      '<PackageReference Include="Refit" Version="7.0.0" />',
    );

    // ---- Vérification : le package installé apparaît bien dans la solution ----
    const solutionPackagesHandler = createSolutionPackagesHandler();
    const solutionDto = await solutionPackagesHandler.Handle(
      new GetSolutionPackagesQuery("/Solution/My.sln"),
    );

    const installedPackage = solutionDto.packages.find((p) => p.id === "Refit");
    expect(installedPackage).toBeDefined();
    expect(installedPackage?.installations).toEqual([
      expect.objectContaining({
        projectPath: "/Solution/Api/Api.csproj",
        installedVersion: "7.0.0",
      }),
    ]);
  });
});
