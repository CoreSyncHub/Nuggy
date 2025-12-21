import * as path from 'path';
import * as fs from 'fs';
import * as vscode from 'vscode';
import { GetPackageManagementDiagnosticQueryHandler } from '@Application/Handlers/Packages/GetPackageManagementDiagnosticQueryHandler';
import { GetPackageManagementDiagnosticQuery } from '@Shared/Features/Queries/GetPackageManagementDiagnosticQuery';
import { GetProjectsTfmQueryHandler } from '@/Host/Application/Handlers/Projects/GetProjectsTfmQueryHandler';
import { PackageManagementDiagnosticDto } from '@/Shared/Features/Dtos/PackageManagementDto';
import { ProjectsTfmDto } from '@/Shared/Features/Dtos/ProjectTfmDto';
import { GetProjectsTfmQuery } from '@/Shared/Features/Queries/GetProjectsTfmQuery';
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
 * Acceptance test for Legacy solution (.NET Framework + packages.config)
 *
 * Scenario: Legacy .NET Framework application using packages.config for package management
 *
 * 1 Identification of Project Type :
 *  - Project should be identified as legacy .NET Framework project. Expected: legacyFrameworkProjects = 1
 *  - SDK type should be Legacy. Expected: SDK type = Legacy
 *  - TFM should be correctly detected from .csproj file. Expected: TargetFramework = "net481"
 *
 * 2 Source of Truth (Packages) :
 *  - Should detect that project uses packages.config for package management. Expected: legacyPackagesByProject contains entries
 *  - Should extract packages from packages.config correctly. Expected: EntityFramework
 *  - Should NOT have CPM enabled (no Directory.Packages.props). Expected: isCpmEnabled = false
 *  - Should be in Local mode (legacy is considered "Local"). Expected: mode = "Local"
 *
 * 3 Version Extraction :
 * - Should extract EntityFramework package with correct version and target framework from packages.config. Expected: version = "6.5.1", targetFramework = "net481"
 * - Should read "targetFramework" attribute correctly from packages.config to ensure consistency. Expected: targetFramework = "net481"
 *
 * 4 Overall Solution Assessment :
 * - IsCpmEnabled should be false for legacy solutions. Expected: isCpmEnabled = false
 * - IsTransitional should be false (only legacy projects). Expected: isTransitional = false
 * - Mode should be "Local" for legacy solutions. Expected: mode = "Local"
 *
 * 5 Resilience of the Parser :
 * - Diagnostics should NOT report errors for XML parsing related to namespaces or casing. Expected: No XML parsing errors in diagnostics
 */
describe('Acceptance: Legacy Solution (packages.config)', () => {
  const solutionPath = path.resolve(__dirname, '../../Fixtures/Legacy/Legacy.sln');
  const fixtureRoot = path.dirname(solutionPath);

  const diagnosticHandler = new GetPackageManagementDiagnosticQueryHandler();
  const tfmHandler = new GetProjectsTfmQueryHandler();

  let diagnosticResult: PackageManagementDiagnosticDto;
  let tfmResult: ProjectsTfmDto;

  beforeAll(async () => {
    // Mock vscode.workspace.workspaceFolders
    (vscode.workspace as any).workspaceFolders = [{ uri: { fsPath: fixtureRoot } }];

    // Mock vscode.workspace.findFiles to search in the fixture directory
    (vscode.workspace.findFiles as jest.Mock).mockImplementation(async (pattern: string) => {
      const fileName = pattern.replace('**/', '');
      const files = findFilesRecursive(fixtureRoot, fileName);
      return files.map((filePath) => ({ fsPath: filePath }));
    });

    const query = new GetPackageManagementDiagnosticQuery(solutionPath);
    const tfmQuery = new GetProjectsTfmQuery(solutionPath);
    const [diagResult, tfmRes] = await Promise.all([
      diagnosticHandler.Handle(query),
      tfmHandler.Handle(tfmQuery),
    ]);

    diagnosticResult = diagResult;
    tfmResult = tfmRes;
  });

  test('Identification of Project Type', () => {
    // Should identify as legacy .NET Framework project
    expect(diagnosticResult.projectTypeSummary.legacyFrameworkProjects).toBe(1);

    // Note: Legacy projects may also appear in sdkStyleProjects count due to <Reference> parsing
    // This is a known limitation - the important check is that packages come from packages.config

    // Check TFM from the legacy project
    const legacyProject = tfmResult.projects.find((proj) =>
      proj.projectPath.includes('Legacy.csproj')
    );
    expect(legacyProject).toBeDefined();
    expect(legacyProject?.sdkType).toBe('Legacy');
    expect(legacyProject?.targetFrameworks).toContain('net481');
  });

  test('Source of Truth (Packages)', () => {
    // Should detect packages.config usage
    expect(Object.keys(diagnosticResult.legacyPackagesByProject).length).toBe(1);

    // Should NOT have CPM enabled
    expect(diagnosticResult.isCpmEnabled).toBe(false);
    expect(diagnosticResult.cpmFilePath).toBeUndefined();

    // Mode should be Local
    expect(diagnosticResult.mode).toBe('Local');

    // Should find EntityFramework package
    const legacyProjectPath = Object.keys(diagnosticResult.legacyPackagesByProject)[0];
    const packages = diagnosticResult.legacyPackagesByProject[legacyProjectPath];
    expect(packages.length).toBeGreaterThan(0);

    const entityFrameworkPackage = packages.find((pkg) => pkg.name === 'EntityFramework');
    expect(entityFrameworkPackage).toBeDefined();
  });

  test('Version Extraction', () => {
    // Get packages from the legacy project
    const legacyProjectPath = Object.keys(diagnosticResult.legacyPackagesByProject).find((path) =>
      path.includes('Legacy.csproj')
    );
    expect(legacyProjectPath).toBeDefined();

    const packages = diagnosticResult.legacyPackagesByProject[legacyProjectPath!];

    // Check EntityFramework package details
    const efPackage = packages.find((pkg) => pkg.name === 'EntityFramework');
    expect(efPackage).toBeDefined();
    expect(efPackage?.version).toBe('6.5.1');
    expect(efPackage?.targetFramework).toBe('net481');

    // Verify exact casing
    expect(efPackage?.name).toBe('EntityFramework');
    expect(efPackage?.name).not.toBe('entityframework'); // Wrong casing
  });

  test('Overall Solution Assessment', () => {
    // CPM should NOT be enabled for legacy solutions
    expect(diagnosticResult.isCpmEnabled).toBe(false);

    // Should NOT be transitional (only legacy projects)
    expect(diagnosticResult.isTransitional).toBe(false);

    // Mode should be Local
    expect(diagnosticResult.mode).toBe('Local');

    // Summary should reflect legacy project count
    expect(diagnosticResult.summary.totalLegacyProjects).toBe(1);
    expect(diagnosticResult.summary.totalProjects).toBe(1);
  });

  test('Resilience of the Parser', () => {
    // No XML parsing errors should be reported
    const parsingErrors = diagnosticResult.diagnostics.filter(
      (diag) =>
        diag.message.toLowerCase().includes('xml') ||
        diag.message.toLowerCase().includes('parse') ||
        diag.message.toLowerCase().includes('namespace')
    );

    expect(parsingErrors.length).toBe(0);

    // Diagnostics should be empty or only contain informational messages
    const errors = diagnosticResult.diagnostics.filter((diag) => diag.severity === 'Error');
    expect(errors.length).toBe(0);
  });
});
