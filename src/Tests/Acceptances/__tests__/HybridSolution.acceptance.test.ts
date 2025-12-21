import * as path from 'path';
import * as vscode from 'vscode';
import * as fs from 'fs';
import { GetPackageManagementDiagnosticQueryHandler } from '@Application/Handlers/Packages/GetPackageManagementDiagnosticQueryHandler';
import { GetPackageManagementDiagnosticQuery } from '@Shared/Features/Queries/GetPackageManagementDiagnosticQuery';
import { GetProjectsTfmQueryHandler } from '@Application/Handlers/Projects/GetProjectsTfmQueryHandler';
import { GetProjectsTfmQuery } from '@Shared/Features/Queries/GetProjectsTfmQuery';
import { PackageManagementDiagnosticDto } from '@Shared/Features/Dtos/PackageManagementDto';
import { ProjectsTfmDto } from '@Shared/Features/Dtos/ProjectTfmDto';
import { findFilesRecursive } from '@/Tests/Helpers/findFilesRecursive';

// Mock vscode module
jest.mock(
  'vscode',
  () => ({
    workspace: {
      workspaceFolders: [],
      findFiles: jest.fn(),
    },
    Uri: {
      file: (path: string) => ({ fsPath: path }),
    },
  }),
  { virtual: true }
);

/**
 * Acceptance test for Hybrid solution (.NET Framework Legacy + Modern SDK-style)
 *
 * Scenario: Transitional .NET application combining legacy .NET Framework projects with modern SDK-style projects
 *
 * Structure:
 * - Legacy.csproj: Legacy .NET Framework 4.8.1 with packages.config
 * - ModernBackend.csproj: Modern .NET 10.0 with PackageReference
 * - SharedContract.csproj: .NET Standard 2.0 with PackageReference
 *
 * Expected Behavior:
 * 1. Transition Diagnosis:
 *    - isTransitional = true (mix of legacy and modern projects)
 *    - mode = "Mixed" (combination of project types)
 *    - Info diagnostic about hybrid solution
 *
 * 2. Project Counters:
 *    - legacyFrameworkProjects = 1 (Legacy.csproj)
 *    - sdkStyleProjects = 2 (ModernBackend + SharedContract)
 *    - cpmEnabledProjects = 0 (no CPM)
 *
 * 3. Package Sources:
 *    - Legacy.csproj: packages from packages.config
 *    - ModernBackend.csproj: packages from local PackageReference
 *    - SharedContract.csproj: packages from local PackageReference
 *
 * 4. Target Frameworks:
 *    - Legacy.csproj: net481
 *    - ModernBackend.csproj: net10.0
 *    - SharedContract.csproj: netstandard2.0
 */
describe('Acceptance: Hybrid Solution (Mixed Legacy + Modern)', () => {
  const fixtureRoot = path.resolve(__dirname, '../../Fixtures/Hybrid');
  const solutionPath = path.join(fixtureRoot, 'HybridSolution.sln');

  let diagnosticResult: PackageManagementDiagnosticDto;
  let tfmResult: ProjectsTfmDto;

  beforeAll(async () => {
    // Mock vscode.workspace to search in fixture directory
    (vscode.workspace as any).workspaceFolders = [{ uri: { fsPath: fixtureRoot } }];

    (vscode.workspace.findFiles as jest.Mock).mockImplementation(async (pattern: string) => {
      const fileName = pattern.replace('**/', '');
      const files = findFilesRecursive(fixtureRoot, fileName);
      return files.map((filePath) => ({ fsPath: filePath }));
    });

    // Execute handlers
    const diagnosticHandler = new GetPackageManagementDiagnosticQueryHandler();
    const tfmHandler = new GetProjectsTfmQueryHandler();

    diagnosticResult = await diagnosticHandler.Handle(
      new GetPackageManagementDiagnosticQuery(solutionPath)
    );
    tfmResult = await tfmHandler.Handle(new GetProjectsTfmQuery(solutionPath));
  });

  test('Transition Diagnosis', () => {
    // Should be transitional (mix of legacy and modern)
    expect(diagnosticResult.isTransitional).toBe(true);

    // Should be in Mixed mode
    expect(diagnosticResult.mode).toBe('Mixed');

    // Should have Info diagnostic about transitional solution
    const infoDiagnostics = diagnosticResult.diagnostics.filter((d) => d.severity === 'Info');
    expect(infoDiagnostics.length).toBeGreaterThan(0);

    const transitionalInfo = infoDiagnostics.find(
      (d) => d.message.includes('legacy .NET Framework') && d.message.includes('SDK-style')
    );
    expect(transitionalInfo).toBeDefined();
  });

  test('Project Type Counters', () => {
    const summary = diagnosticResult.projectTypeSummary;

    // Should have 1 legacy project (Legacy.csproj)
    expect(summary.legacyFrameworkProjects).toBe(1);

    // Should have 2 SDK-style projects (ModernBackend + SharedContract)
    expect(summary.sdkStyleProjects).toBe(2);

    // Should have 0 CPM-enabled projects (no Directory.Packages.props)
    expect(summary.cpmEnabledProjects).toBe(0);

    // Verify in TFM result as well
    expect(tfmResult.summary.legacyProjects).toBe(1);
    expect(tfmResult.summary.sdkStyleProjects).toBe(2);
  });

  test('Package Source Separation', () => {
    // Legacy project should be in legacyPackagesByProject
    const legacyProjects = Object.keys(diagnosticResult.legacyPackagesByProject);
    expect(legacyProjects.length).toBe(1);
    expect(legacyProjects[0]).toMatch(/Legacy\.csproj$/);

    // Legacy project should have packages from packages.config
    const legacyPackages = diagnosticResult.legacyPackagesByProject[legacyProjects[0]];
    expect(legacyPackages.length).toBeGreaterThan(0);

    const newtonsoftPackage = legacyPackages.find((p) => p.name === 'Newtonsoft.Json');
    expect(newtonsoftPackage).toBeDefined();
    expect(newtonsoftPackage?.version).toBe('13.0.3');
    expect(newtonsoftPackage?.targetFramework).toBe('net481');

    // Modern projects should be in packageReferencesByProject
    const modernProjects = Object.keys(diagnosticResult.packageReferencesByProject);
    expect(modernProjects.length).toBe(2); // ModernBackend + SharedContract

    // ModernBackend should have Serilog
    const modernBackendProject = modernProjects.find((p) => p.includes('ModernBackend.csproj'));
    expect(modernBackendProject).toBeDefined();

    const modernBackendPackages =
      diagnosticResult.packageReferencesByProject[modernBackendProject!];
    expect(modernBackendPackages.length).toBeGreaterThan(0);

    const serilogPackage = modernBackendPackages.find((p) => p.name === 'Serilog');
    expect(serilogPackage).toBeDefined();
    expect(serilogPackage?.version).toBe('4.0.0');
    expect(serilogPackage?.hasLocalVersion).toBe(true);

    // SharedContract should have System.Text.Json
    const sharedContractProject = modernProjects.find((p) => p.includes('SharedContract.csproj'));
    expect(sharedContractProject).toBeDefined();

    const sharedContractPackages =
      diagnosticResult.packageReferencesByProject[sharedContractProject!];
    expect(sharedContractPackages.length).toBeGreaterThan(0);

    const textJsonPackage = sharedContractPackages.find((p) => p.name === 'System.Text.Json');
    expect(textJsonPackage).toBeDefined();
    expect(textJsonPackage?.version).toBe('8.0.5');
    expect(textJsonPackage?.hasLocalVersion).toBe(true);
  });

  test('Target Framework Analysis', () => {
    // Should have 3 projects total
    expect(tfmResult.projects.length).toBe(3);

    // Legacy.csproj should have net481
    const legacyProject = tfmResult.projects.find((p) => p.projectPath.includes('Legacy.csproj'));
    expect(legacyProject).toBeDefined();
    expect(legacyProject?.sdkType).toBe('Legacy');
    expect(legacyProject?.targetFrameworks).toContain('net481');
    expect(legacyProject?.primaryTargetFramework).toBe('net481');
    expect(legacyProject?.isMultiTargeting).toBe(false);

    // ModernBackend.csproj should have net10.0
    const modernBackendProject = tfmResult.projects.find((p) =>
      p.projectPath.includes('ModernBackend.csproj')
    );
    expect(modernBackendProject).toBeDefined();
    expect(modernBackendProject?.sdkType).toBe('SDK-Style');
    expect(modernBackendProject?.targetFrameworks).toContain('net10.0');
    expect(modernBackendProject?.primaryTargetFramework).toBe('net10.0');
    expect(modernBackendProject?.isMultiTargeting).toBe(false);

    // SharedContract.csproj should have netstandard2.0
    const sharedContractProject = tfmResult.projects.find((p) =>
      p.projectPath.includes('SharedContract.csproj')
    );
    expect(sharedContractProject).toBeDefined();
    expect(sharedContractProject?.sdkType).toBe('SDK-Style');
    expect(sharedContractProject?.targetFrameworks).toContain('netstandard2.0');
    expect(sharedContractProject?.primaryTargetFramework).toBe('netstandard2.0');
    expect(sharedContractProject?.isMultiTargeting).toBe(false);
  });

  test('No CPM Configuration', () => {
    // CPM should not be enabled (no Directory.Packages.props)
    expect(diagnosticResult.isCpmEnabled).toBe(false);
    expect(diagnosticResult.cpmFilePath).toBeUndefined();

    // Should have no central package versions
    expect(diagnosticResult.packageVersions.length).toBe(0);

    // Should have no CPM-related warnings
    const cpmWarnings = diagnosticResult.diagnostics.filter(
      (d) => d.message.includes('Central Package Management') || d.message.includes('CPM')
    );
    expect(cpmWarnings.length).toBe(0);
  });
});
