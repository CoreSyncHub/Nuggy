import * as path from 'path';
import { GetPackageManagementDiagnosticQueryHandler } from '@Application/Handlers/Packages/GetPackageManagementDiagnosticQueryHandler';
import { GetPackageManagementDiagnosticQuery } from '@Shared/Features/Queries/GetPackageManagementDiagnosticQuery';
import { PackageManagementDiagnosticDto } from '@/Shared/Features/Dtos/PackageManagementDto';
import { GetProjectsTfmQueryHandler } from '@/Host/Application/Handlers/Projects/GetProjectsTfmQueryHandler';
import { GetProjectsTfmQuery } from '@/Shared/Features/Queries/GetProjectsTfmQuery';
import { ProjectsTfmDto } from '@/Shared/Features/Dtos/ProjectTfmDto';

/**
 * Acceptance test for Modern solution (SLNX + Local PackageReference)
 *
 * Scenario: Modern .NET application using SLNX format with local PackageReference versions
 * 1 Solution integrity check :
 *  - Only 1 project found in solution. Expected: 1 project with path containing "ModernApp.csproj"
 *  - Solution type is SLNX. Expected: SLNX
 *  - Solution name should be extract correctly from SLNX file name. Expected: "Modern"
 *
 * 2 Environment Analysis (TFM) :
 *  - Should detect TargetFramework "net10.0" from ModernApp.csproj. Expected: "net10.0"
 *  - Should confirm project is modern SDK-style. Expected: SDK-Style
 *
 * 3 Package Management Detection :
 * - Should NOT have CPM enabled (no Directory.Packages.props). Expected: isCpmEnabled = false
 * - Should be in Local mode (not Central, not Mixed). Expected: mode = "Local"
 * - Should not have any source of central package versions. Expected: packageVersions.length = 0
 *
 * 4 Package Reference Extraction :
 * - Should count exactly 3 PackageReference entries in ModernApp.csproj (And not 4 because of the commented package). Expected: packageReferencesByProject[ModernApp.csproj].length = 3
 * - For each package, it should extract exact package name with correct casing and sanitize whitespace. Expected: package names match exactly with no extra spaces
 * - Each package should have local version defined. Expected: hasLocalVersion = true for all packages
 *
 * 5 Health Status (Diagnostics) :
 * - Should have NO diagnostics (everything is correct). Expected: diagnostics.length = 0
 * - Should NOT be transitional (only modern SDK-style projects). Expected: isTransitional = false
 */
describe('Acceptance: Modern Solution (SLNX + Local PackageReference)', () => {
  const solutionPath = path.resolve(__dirname, '../../Fixtures/Modern/Modern.slnx');
  const diagnosticHandler = new GetPackageManagementDiagnosticQueryHandler();
  const tfmHandler = new GetProjectsTfmQueryHandler();

  let diagnosticResult: PackageManagementDiagnosticDto;
  let tfmResult: ProjectsTfmDto;

  beforeAll(async () => {
    const query = new GetPackageManagementDiagnosticQuery(solutionPath);
    const tfmQuery = new GetProjectsTfmQuery(solutionPath);
    const [diagResult, tfmRes] = await Promise.all([
      diagnosticHandler.Handle(query),
      tfmHandler.Handle(tfmQuery),
    ]);

    diagnosticResult = diagResult;
    tfmResult = tfmRes;
  });

  test('Solution Integrity Check', () => {
    // Only 1 project found
    expect(diagnosticResult.summary.totalProjects).toBe(1);
    expect(Object.keys(diagnosticResult.packageReferencesByProject)[0]).toContain(
      'ModernApp.csproj'
    );

    // Solution type is SLNX
    expect(diagnosticResult.solutionType).toBe('SLNX');

    // Solution name extracted correctly
    expect(diagnosticResult.solutionName).toBe('Modern');
  });

  test('Environment Analysis (TFM)', () => {
    // Detect TargetFramework
    expect(tfmResult.projects.length).toBe(1);
    const projectTfm = tfmResult.projects[0];
    expect(projectTfm.targetFrameworks).toContain('net10.0');

    // Confirm SDK-style project
    expect(projectTfm.sdkType).toBe('SDK-Style');
  });

  test('Package Management Detection', () => {
    // CPM should NOT be enabled
    expect(diagnosticResult.isCpmEnabled).toBe(false);

    // Should be in Local mode
    expect(diagnosticResult.mode).toBe('Local');

    // No central package versions
    expect(diagnosticResult.packageVersions.length).toBe(0);
  });

  test('Package Reference Extraction', () => {
    const projectPath = Object.keys(diagnosticResult.packageReferencesByProject)[0];
    const packageRefs = diagnosticResult.packageReferencesByProject[projectPath];

    // Exactly 3 PackageReference entries (excluding commented out)
    expect(packageRefs.length).toBe(3);

    // Exact package names with correct casing and no extra spaces
    const expectedPackageNames = [
      'Newtonsoft.Json',
      'Serilog.Sinks.Console',
      'Microsoft.CodeAnalysis',
    ];
    const extractedPackageNames = packageRefs.map((pr) => pr.name);
    expect(extractedPackageNames).toEqual(expectedPackageNames);

    // All packages should have local versions defined
    for (const pkgRef of packageRefs) {
      expect(pkgRef.hasLocalVersion).toBe(true);
    }
  });

  test('Health Status (Diagnostics)', () => {
    // No diagnostics
    expect(diagnosticResult.diagnostics.length).toBe(0);

    // Not transitional
    expect(diagnosticResult.isTransitional).toBe(false);
  });
});
