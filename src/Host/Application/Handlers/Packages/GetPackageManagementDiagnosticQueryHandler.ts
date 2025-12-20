import { injectable } from 'tsyringe';
import * as path from 'path';
import { IQueryHandler } from '@Shared/Abstractions/Messaging/IQueryHandler';
import { GetPackageManagementDiagnosticQuery } from '@Shared/Features/Queries/GetPackageManagementDiagnosticQuery';
import {
  PackageManagementDiagnosticDto,
  PackageVersionDto,
  PackageReferenceDto,
  PackageDiagnosticDto,
} from '@Shared/Features/Dtos/PackageManagementDto';
import { HandlerFor } from '@Shared/Infrastructure/Messaging/HandlerFor';
import { SlnParser } from '@Infrastructure/Solution/SlnParser';
import { SlnxParser } from '@Infrastructure/Solution/SlnxParser';
import { BuildConfigDetector } from '@Infrastructure/Build/BuildConfigDetector';
import { BuildConfigParser } from '@Infrastructure/Build/BuildConfigParser';
import { PackageReferenceParser } from '@Infrastructure/Packages/PackageReferenceParser';
import { CpmDiagnosticService } from '@Infrastructure/Packages/CpmDiagnosticService';
import { PackageDiagnosticSeverity } from '@Domain/Packages/Enums/PackageDiagnosticSeverity';

/**
 * Handler for GetPackageManagementDiagnosticQuery
 * Analyzes package management configuration and detects anomalies
 */
@injectable()
@HandlerFor(GetPackageManagementDiagnosticQuery)
export class GetPackageManagementDiagnosticQueryHandler
  implements IQueryHandler<GetPackageManagementDiagnosticQuery, PackageManagementDiagnosticDto>
{
  async Handle(query: GetPackageManagementDiagnosticQuery): Promise<PackageManagementDiagnosticDto> {
    const solutionPath = query.solutionPath;
    const solutionExt = path.extname(solutionPath).toLowerCase();

    // 1. Parse the solution to get project paths
    let projectPaths: string[];

    if (solutionExt === '.slnx') {
      const parseResult = SlnxParser.parse(solutionPath);
      projectPaths = parseResult.projects.map((p) => p.path);
    } else if (solutionExt === '.sln') {
      const parseResult = SlnParser.parse(solutionPath);
      projectPaths = parseResult.projects.map((p) => p.path);
    } else {
      throw new Error(`Unsupported solution format: ${solutionExt}`);
    }

    // 2. Find and parse all build configuration files
    const buildConfigFiles = await BuildConfigDetector.findAllConfigFiles();
    BuildConfigDetector.buildHierarchy(buildConfigFiles);

    // Parse each build config file
    for (const file of buildConfigFiles) {
      BuildConfigParser.parse(file.path, file);
    }

    // Map affected projects
    await BuildConfigDetector.mapAffectedProjects(buildConfigFiles, projectPaths);

    // 3. Extract PackageReference entries from all projects
    const packageReferences = PackageReferenceParser.parseMultiple(projectPaths);

    // 4. Run diagnostic analysis (handles hierarchical Directory.Packages.props)
    const diagnosticResult = CpmDiagnosticService.analyze(
      buildConfigFiles,
      packageReferences
    );

    // 6. Convert to DTOs
    const packageVersionDtos: PackageVersionDto[] = diagnosticResult.packageVersions.map((pv) => ({
      name: pv.name,
      version: pv.version,
      sourcePath: pv.sourcePath,
      affectedProjects: pv.affectedProjects,
    }));

    const packageReferencesByProject: Record<string, PackageReferenceDto[]> = {};
    for (const [projectPath, references] of diagnosticResult.packageReferences) {
      packageReferencesByProject[projectPath] = references.map((ref) => ({
        name: ref.name,
        version: ref.version,
        projectPath: ref.projectPath,
        hasLocalVersion: ref.hasLocalVersion,
      }));
    }

    const diagnosticDtos: PackageDiagnosticDto[] = diagnosticResult.diagnostics.map((diag) => ({
      severity: diag.severity,
      message: diag.message,
      packageName: diag.packageName,
      projectPath: diag.projectPath,
      filePath: diag.filePath,
    }));

    // 7. Calculate summary statistics
    const diagnosticsBySeverity = {
      errors: diagnosticDtos.filter((d) => d.severity === PackageDiagnosticSeverity.Error).length,
      warnings: diagnosticDtos.filter((d) => d.severity === PackageDiagnosticSeverity.Warning)
        .length,
      infos: diagnosticDtos.filter((d) => d.severity === PackageDiagnosticSeverity.Info).length,
    };

    return {
      isCpmEnabled: diagnosticResult.isCpmEnabled,
      mode: diagnosticResult.mode,
      cpmFilePath: diagnosticResult.cpmFilePath,
      packageVersions: packageVersionDtos,
      packageReferencesByProject,
      diagnostics: diagnosticDtos,
      summary: {
        totalCentralPackages: packageVersionDtos.length,
        totalProjects: projectPaths.length,
        diagnosticsBySeverity,
      },
    };
  }
}
