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

import { createPackageWriteTargetResolver } from "../../Helpers/createHandlers";
import { InstallPackageCommandHandler } from "@Application/Handlers/Packages/InstallPackageCommandHandler";
import { UpgradePackageCommandHandler } from "@Application/Handlers/Packages/UpgradePackageCommandHandler";
import { UninstallPackageCommandHandler } from "@Application/Handlers/Packages/UninstallPackageCommandHandler";
import { GetRestoreStatusQueryHandler } from "@Application/Handlers/Packages/GetRestoreStatusQueryHandler";
import { GetOperationLogQueryHandler } from "@Application/Handlers/Packages/GetOperationLogQueryHandler";
import { InstallPackageCommand } from "@Shared/Features/Commands/InstallPackageCommand";
import { UpgradePackageCommand } from "@Shared/Features/Commands/UpgradePackageCommand";
import { UninstallPackageCommand } from "@Shared/Features/Commands/UninstallPackageCommand";
import { GetRestoreStatusQuery } from "@Shared/Features/Queries/GetRestoreStatusQuery";
import { GetOperationLogQuery } from "@Shared/Features/Queries/GetOperationLogQuery";
import { MsBuildTextEditor } from "@Infrastructure/MsBuild/MsBuildTextEditor";
import { RestoreScheduler } from "@Infrastructure/MsBuild/RestoreScheduler";
import { OperationLogStore } from "@Infrastructure/MsBuild/OperationLogStore";
import { type IProcessRunner } from "@Infrastructure/MsBuild/ProcessRunner";
import { PackageMetadataCache } from "@Infrastructure/NuGet/PackageMetadataCache";
import { ProjectTfmCache } from "@Infrastructure/Projects/ProjectTfmCache";
import { type NuGetV3ApiClient } from "@Infrastructure/NuGet/NuGetV3ApiClient";
import { TfmCompatibilityService } from "@Infrastructure/Projects/TfmCompatibilityService";
import { SlnParser } from "@Infrastructure/Solution/SlnParser";
import { SlnxParser } from "@Infrastructure/Solution/SlnxParser";
import { BuildConfigDetector } from "@Infrastructure/Build/BuildConfigDetector";
import { BuildConfigParser } from "@Infrastructure/Build/BuildConfigParser";
import { CsprojParser } from "@Infrastructure/Projects/CsprojParser";
import { TfmResolver } from "@Infrastructure/Projects/TfmResolver";
import { ProjectTfmResolutionService } from "@Infrastructure/Projects/ProjectTfmResolutionService";
import { type IUserPrompt } from "@Application/Abstractions/Prompt/IUserPrompt";
import { type ILogger } from "@Application/Abstractions/Log/ILogger";

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
Project("{FAE04EC0-301F-11D3-BF4B-00C04F79EFBC}") = "Core", "Core\\Core.csproj", "{22222222-2222-2222-2222-222222222222}"
EndProject
`;

const API_CSPROJ = `<Project Sdk="Microsoft.NET.Sdk">
  <PropertyGroup><TargetFramework>net8.0</TargetFramework></PropertyGroup>
</Project>`;

const CORE_CSPROJ = `<Project Sdk="Microsoft.NET.Sdk">
  <PropertyGroup><TargetFramework>net8.0</TargetFramework></PropertyGroup>
</Project>`;

/**
 * Same foundation as `UninstallPackageCommandHandler.test.ts`: writes persist
 * into the same store as reads, so every step of the scenario
 * (install → upgrade → uninstall) starts from the state actually written by the
 * previous step, exactly as the disk would.
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

describe("Acceptance: package writes (Epic 5)", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.useFakeTimers();
    (vscode.workspace as unknown as { workspaceFolders?: unknown }).workspaceFolders = undefined;
  });

  afterEach(() => jest.useRealTimers());

  it("installs, updates then uninstalls Serilog on Core, with a debounced restore end to end", async () => {
    const files = setFiles({
      "/Solution/My.sln": SLN,
      "/Solution/Api/Api.csproj": API_CSPROJ,
      "/Solution/Core/Core.csproj": CORE_CSPROJ,
    });

    // A fake ProcessRunner injected into a real RestoreScheduler: the debounce,
    // the status tracking and the serialisation of runs are therefore tested
    // with the real component, not a stand-in.
    const processRunner: IProcessRunner = {
      run: jest.fn().mockResolvedValue({ exitCode: 0, output: "", timedOut: false }),
    };
    const operationLog = new OperationLogStore();
    const restoreScheduler = new RestoreScheduler(operationLog, processRunner, noOpLogger);
    const restoreStatusHandler = new GetRestoreStatusQueryHandler(restoreScheduler);
    const operationLogHandler = new GetOperationLogQueryHandler(operationLog);

    const metadataCache = new PackageMetadataCache();
    const tfmCache = new ProjectTfmCache();
    const prompt: IUserPrompt = { confirm: jest.fn().mockResolvedValue(true) };
    // Registration not found → Unknown verdict → never blocking (same pattern
    // as the "unreachable registration" test of InstallPackageCommandHandler).
    const apiClient = { getRegistrationLeaves: jest.fn().mockResolvedValue([]) };

    expect((await restoreStatusHandler.Handle(new GetRestoreStatusQuery())).status).toBe("Idle");

    // ---- Install ----
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
        "Serilog",
        "3.1.0",
        "/Solution/My.sln",
        "/Solution/Core/Core.csproj",
      ),
    );

    expect(installResult).toEqual({
      status: "Ok",
      filesChanged: ["/Solution/Core/Core.csproj"],
      affectedProjects: ["/Solution/Core/Core.csproj"],
      skipped: [],
    });
    expect(files["/Solution/Core/Core.csproj"]).toContain(
      '<PackageReference Include="Serilog" Version="3.1.0" />',
    );
    // The restore is scheduled but debounced: still pending.
    expect((await restoreStatusHandler.Handle(new GetRestoreStatusQuery())).status).toBe("Running");

    // ---- Upgrade ----
    const upgradeHandler = new UpgradePackageCommandHandler(
      operationLog,
      createPackageWriteTargetResolver(),
      new MsBuildTextEditor(),
      restoreScheduler,
      metadataCache,
      tfmCache,
      prompt,
      noOpLogger,
    );

    const upgradeResult = await upgradeHandler.Handle(
      new UpgradePackageCommand(
        "Serilog",
        "3.1.1",
        "/Solution/My.sln",
        "/Solution/Core/Core.csproj",
      ),
    );

    expect(upgradeResult).toEqual({
      status: "Ok",
      filesChanged: ["/Solution/Core/Core.csproj"],
      affectedProjects: ["/Solution/Core/Core.csproj"],
      skipped: [],
    });
    expect(files["/Solution/Core/Core.csproj"]).toContain(
      '<PackageReference Include="Serilog" Version="3.1.1" />',
    );
    expect(files["/Solution/Core/Core.csproj"]).not.toContain('Version="3.1.0"');
    expect((await restoreStatusHandler.Handle(new GetRestoreStatusQuery())).status).toBe("Running");

    // ---- Uninstall ----
    const uninstallHandler = new UninstallPackageCommandHandler(
      operationLog,
      createPackageWriteTargetResolver(),
      new MsBuildTextEditor(),
      restoreScheduler,
      metadataCache,
      tfmCache,
      prompt,
      noOpLogger,
    );

    const uninstallResult = await uninstallHandler.Handle(
      new UninstallPackageCommand("Serilog", "/Solution/My.sln", "/Solution/Core/Core.csproj"),
    );

    expect(uninstallResult).toEqual({
      status: "Ok",
      filesChanged: ["/Solution/Core/Core.csproj"],
      affectedProjects: ["/Solution/Core/Core.csproj"],
      skipped: [],
    });
    expect(files["/Solution/Core/Core.csproj"]).not.toContain("Serilog");
    expect(files["/Solution/Core/Core.csproj"]).toBe(CORE_CSPROJ);

    // Three writes chained one after the other, all debounced together: a single
    // restore scheduled so far.
    expect((await restoreStatusHandler.Handle(new GetRestoreStatusQuery())).status).toBe("Running");
    expect(processRunner.run).not.toHaveBeenCalled();

    // ---- Debounced restore cycle: Running → Succeeded ----
    await jest.advanceTimersByTimeAsync(300);

    expect(processRunner.run).toHaveBeenCalledTimes(1);
    expect(processRunner.run).toHaveBeenCalledWith(
      "dotnet",
      ["restore", "/Solution/My.sln"],
      "/Solution",
      300_000,
    );
    expect((await restoreStatusHandler.Handle(new GetRestoreStatusQuery())).status).toBe(
      "Succeeded",
    );

    // No user confirmation needed: every step explicitly targeted the Core
    // project (a single candidate).
    expect(prompt.confirm).not.toHaveBeenCalled();

    // ---- Journal: GetOperationLogQuery sees the whole scenario ----
    const log = await operationLogHandler.Handle(new GetOperationLogQuery());

    const writes = log.entries.filter((e) => e.kind === "write");
    expect(writes.map((e) => e.operation)).toEqual(["uninstall", "upgrade", "install"]); // newest-first

    const restores = log.entries.filter((e) => e.kind === "restore");
    expect(restores.length).toBeGreaterThan(0);
    expect(restores.every((e) => e.status === "Succeeded")).toBe(true);
    // The three writes were debounced together: a single restore was scheduled,
    // so the most recent journal entry is THAT restore, not the last write (its
    // rank in the journal depends on fake-timer timing). We therefore check the
    // newest-first order per entry type rather than a global order across types.
    const restoreRunIds = restores.map((e) => e.runId);
    expect(restoreRunIds).toEqual([...restoreRunIds].sort((a, b) => b - a));
  });
});
