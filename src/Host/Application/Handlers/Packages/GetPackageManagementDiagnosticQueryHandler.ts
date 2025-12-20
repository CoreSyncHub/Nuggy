import { injectable } from 'tsyringe';
import * as path from 'path';
import { IQueryHandler } from '@Shared/Abstractions/Messaging/IQueryHandler';
import { GetPackageManagementDiagnosticQuery } from '@Shared/Features/Queries/GetPackageManagementDiagnosticQuery';
import {
  PackageManagementDiagnosticDto,
  PackageVersionDto,
  PackageReferenceDto,
  LegacyPackageDto,
  PackageDiagnosticDto,
  ProjectTypeSummaryDto,
} from '@Shared/Features/Dtos/PackageManagementDto';
import { HandlerFor } from '@Shared/Infrastructure/Messaging/HandlerFor';
import { SlnParser } from '@Infrastructure/Solution/SlnParser';
import { SlnxParser } from '@Infrastructure/Solution/SlnxParser';
import { BuildConfigDetector } from '@Infrastructure/Build/BuildConfigDetector';
import { BuildConfigParser } from '@Infrastructure/Build/BuildConfigParser';
import { PackageReferenceParser } from '@Infrastructure/Packages/PackageReferenceParser';
import { PackagesConfigParser } from '@Infrastructure/Packages/PackagesConfigParser';
import { PackageManagementDiagnosticService } from '@Infrastructure/Packages/PackageManagementDiagnosticService';
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

    // 4. Extract legacy packages from packages.config files
    const legacyPackages = PackagesConfigParser.parseMultiple(projectPaths);

    // 5. Run diagnostic analysis (handles both SDK-style and legacy projects)
    const diagnosticResult = PackageManagementDiagnosticService.analyze(
      buildConfigFiles,
      packageReferences,
      legacyPackages
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

    const legacyPackagesByProject: Record<string, LegacyPackageDto[]> = {};
    for (const [projectPath, packages] of diagnosticResult.legacyPackages) {
      legacyPackagesByProject[projectPath] = packages.map((pkg) => ({
        name: pkg.name,
        version: pkg.version,
        projectPath: pkg.projectPath,
        configPath: pkg.configPath,
        targetFramework: pkg.targetFramework,
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

    const projectTypeSummaryDto: ProjectTypeSummaryDto = {
      legacyFrameworkProjects: diagnosticResult.projectTypeSummary.legacyFrameworkProjects,
      sdkStyleProjects: diagnosticResult.projectTypeSummary.sdkStyleProjects,
      cpmEnabledProjects: diagnosticResult.projectTypeSummary.cpmEnabledProjects,
    };

    return {
      isCpmEnabled: diagnosticResult.isCpmEnabled,
      mode: diagnosticResult.mode,
      isTransitional: diagnosticResult.isTransitional,
      projectTypeSummary: projectTypeSummaryDto,
      cpmFilePath: diagnosticResult.cpmFilePath,
      packageVersions: packageVersionDtos,
      packageReferencesByProject,
      legacyPackagesByProject,
      diagnostics: diagnosticDtos,
      summary: {
        totalCentralPackages: packageVersionDtos.length,
        totalProjects: projectPaths.length,
        totalLegacyProjects: diagnosticResult.legacyPackages.size,
        diagnosticsBySeverity,
      },
    };
  }
}
