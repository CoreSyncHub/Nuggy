import * as path from 'path';
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
 * Acceptance test for Enterprise solution (SLN + CPM + Directory.Build.props)
 *
 * Scenario: Enterprise .NET application using Central Package Management
 *
 * 1 Centralization Detection :
 *  - Should detect CPM (Directory.Packages.props present). Expected: isCpmEnabled = true
 *  - Mode should be Central. Expected: mode = "Central"
 *  - CPM file path should be correctly identified. Expected: cpmFilePath contains "Directory.Packages.props"
 *
 * 2 Central Package Version Resolution :
 *  - Microsoft.AspNetCore.Mvc.NewtonsoftJson package should be defined in Directory.Packages.props with correct version. Expected: version = "8.0.12"
 *  - Serilog package should be defined in Directory.Packages.props with correct version. Expected: version = "4.0.0"
 *  - "Has local version" for PackageReferences should be false (versions come from CPM). Expected: hasLocalVersion = false
 *
 * 3 Evaluation of MSBuild Properties (TFM) :
 * - Should resolve "$MySharedFramework" property in project "CoreLib" to "net8.0". Expected: TargetFramework = "net8.0"
 * - Should resolve "net8.0" in project "Api" from Directory.Build.props because csproj does not define its own TFM. Expected: TargetFramework = "net8.0"
 *
 * 4 Consistency Diagnosis :
 * - Should return warning for local defined package version of "Microsoft.Extensions.Logging" in "CoreLib.csproj" when using CPM. Expected: warning diagnostic about local version conflict.
 */
describe('Acceptance: Enterprise Solution', () => {
  const solutionPath = path.resolve(__dirname, '../../Fixtures/Enterprise/Enterprise.sln');
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

  test('Centralization Detection', () => {
    // Should detect CPM enabled
    expect(diagnosticResult.isCpmEnabled).toBe(true);

    // Mode should be Central
    expect(diagnosticResult.mode).toBe('Central');

    // CPM file path should be correct
    expect(diagnosticResult.cpmFilePath).toContain('Directory.Packages.props');
  });

  test('Central Package Version Resolution', () => {
    const cpmVersions = diagnosticResult.packageVersions;

    // Check Microsoft.AspNetCore.Mvc.NewtonsoftJson version
    const newtonsoftPackage = cpmVersions.find(
      (pkg) => pkg.name === 'Microsoft.AspNetCore.Mvc.NewtonsoftJson'
    );
    expect(newtonsoftPackage).toBeDefined();
    expect(newtonsoftPackage?.version).toBe('8.0.12');

    // Check Serilog version
    const serilogPackage = cpmVersions.find((pkg) => pkg.name === 'Serilog');
    expect(serilogPackage).toBeDefined();
    expect(serilogPackage?.version).toBe('4.0.0');

    // Api.csproj should NOT have local versions (uses CPM correctly)
    const apiProjectPath = Object.keys(diagnosticResult.packageReferencesByProject).find((path) =>
      path.includes('Api.csproj')
    );
    expect(apiProjectPath).toBeDefined();
    const apiPackages = diagnosticResult.packageReferencesByProject[apiProjectPath!];
    for (const pkgRef of apiPackages) {
      expect(pkgRef.hasLocalVersion).toBe(false);
    }

    // CoreLib.csproj SHOULD have local version for Microsoft.Extensions.Logging (intentional misconfiguration)
    const coreLibProjectPath = Object.keys(diagnosticResult.packageReferencesByProject).find(
      (path) => path.includes('CoreLib.csproj')
    );
    expect(coreLibProjectPath).toBeDefined();
    const coreLibPackages = diagnosticResult.packageReferencesByProject[coreLibProjectPath!];
    const loggingPackage = coreLibPackages.find(
      (pkg) => pkg.name === 'Microsoft.Extensions.Logging'
    );
    expect(loggingPackage).toBeDefined();
    expect(loggingPackage?.hasLocalVersion).toBe(true);
    expect(loggingPackage?.version).toBe('6.0.0');
  });

  test('Evaluation of MSBuild Properties (TFM)', () => {
    // Check Api project TFM (inherited from Directory.Build.props)
    const apiProject = tfmResult.projects.find((proj) => proj.projectPath.includes('Api.csproj'));
    expect(apiProject).toBeDefined();
    expect(apiProject?.targetFrameworks).toContain('net8.0');
    expect(apiProject?.source).toBe('Directory.Build.props');

    // Check CoreLib project TFM (uses $(MySharedFramework))
    const coreLibProject = tfmResult.projects.find((proj) =>
      proj.projectPath.includes('CoreLib.csproj')
    );
    expect(coreLibProject).toBeDefined();
    expect(coreLibProject?.targetFrameworks).toContain('net8.0');
  });

  test('Consistency Diagnosis', () => {
    // Check for warning about local version when CPM is enabled
    const warnings = diagnosticResult.diagnostics.filter((diag) => diag.severity === 'Warning');

    const localVersionWarning = warnings.find(
      (diag) =>
        diag.message.includes('Microsoft.Extensions.Logging') &&
        diag.message.includes('has a local version') &&
        diag.message.includes('Central Package Management is enabled')
    );
    expect(localVersionWarning).toBeDefined();
    expect(localVersionWarning?.packageName).toBe('Microsoft.Extensions.Logging');
    expect(localVersionWarning?.message).toContain('6.0.0'); // Local version
    expect(localVersionWarning?.message).toContain('Add this package to');
    expect(localVersionWarning?.projectPath).toContain('CoreLib.csproj');
  });
});
