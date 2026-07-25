import { injectable } from "tsyringe";
import * as path from "path";
import { type IQueryHandler } from "@Shared/Abstractions/Messaging/IQueryHandler";
import { GetPackageManagementDiagnosticQuery } from "@Shared/Features/Queries/GetPackageManagementDiagnosticQuery";
import {
  type PackageManagementDiagnosticDto,
  type PackageVersionDto,
  type PackageReferenceDto,
  type LegacyPackageDto,
  type PackageDiagnosticDto,
  type ProjectTypeSummaryDto,
} from "@Shared/Features/Dtos/PackageManagementDto";
import { HandlerFor } from "@Shared/Infrastructure/Messaging/HandlerFor";
import { SlnParser } from "@Infrastructure/Solution/SlnParser";
import { SlnxParser } from "@Infrastructure/Solution/SlnxParser";
import { BuildConfigDetector } from "@Infrastructure/Build/BuildConfigDetector";
import { BuildConfigParser } from "@Infrastructure/Build/BuildConfigParser";
import { PackageReferenceParser } from "@Infrastructure/Packages/PackageReferenceParser";
import { type PackageReference } from "@Domain/Packages/Entities/PackageReference";
import { PackagesConfigParser } from "@Infrastructure/Packages/PackagesConfigParser";
import { PackageManagementDiagnosticService } from "@Infrastructure/Packages/PackageManagementDiagnosticService";
import { PackageDiagnosticSeverity } from "@Domain/Packages/Enums/PackageDiagnosticSeverity";

/**
 * Handler for GetPackageManagementDiagnosticQuery
 * Analyzes package management configuration and detects anomalies
 */
@injectable()
@HandlerFor(GetPackageManagementDiagnosticQuery)
export class GetPackageManagementDiagnosticQueryHandler implements IQueryHandler<
  GetPackageManagementDiagnosticQuery,
  PackageManagementDiagnosticDto
> {
  constructor(
    private readonly slnParser: SlnParser,
    private readonly slnxParser: SlnxParser,
    private readonly buildConfigDetector: BuildConfigDetector,
    private readonly buildConfigParser: BuildConfigParser,
    private readonly packageReferenceParser: PackageReferenceParser,
    private readonly packagesConfigParser: PackagesConfigParser,
    private readonly packageManagementDiagnosticService: PackageManagementDiagnosticService,
  ) {}

  async Handle(
    query: GetPackageManagementDiagnosticQuery,
  ): Promise<PackageManagementDiagnosticDto> {
    const solutionPath = query.solutionPath;
    const solutionExt = path.extname(solutionPath).toLowerCase();

    let projectPaths: string[];
    let solutionType: "SLNX" | "SLN";

    const solutionName = path.basename(solutionPath, solutionExt);

    if (solutionExt === ".slnx") {
      const parseResult = this.slnxParser.parse(solutionPath);
      solutionType = "SLNX";
      projectPaths = parseResult.projects.map((p) => p.path);
    } else if (solutionExt === ".sln") {
      const parseResult = this.slnParser.parse(solutionPath);
      projectPaths = parseResult.projects.map((p) => p.path);
      solutionType = "SLN";
    } else {
      throw new Error(`Unsupported solution format: ${solutionExt}`);
    }

    const buildConfigFiles = await this.buildConfigDetector.findAllConfigFiles();
    this.buildConfigDetector.buildHierarchy(buildConfigFiles);

    for (const file of buildConfigFiles) {
      this.buildConfigParser.parse(file.path, file);
    }

    await this.buildConfigDetector.mapAffectedProjects(buildConfigFiles, projectPaths);

    const allPackageReferences = this.packageReferenceParser.parseMultiple(projectPaths);
    const legacyPackages = this.packagesConfigParser.parseMultiple(projectPaths);

    const packageReferences = new Map<string, PackageReference[]>();
    for (const [projectPath, references] of allPackageReferences) {
      if (!legacyPackages.has(projectPath)) {
        packageReferences.set(projectPath, references);
      }
    }

    const diagnosticResult = this.packageManagementDiagnosticService.analyze(
      buildConfigFiles,
      packageReferences,
      legacyPackages,
    );

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
      solutionName,
      solutionType,
      summary: {
        totalCentralPackages: packageVersionDtos.length,
        totalProjects: projectPaths.length,
        totalLegacyProjects: diagnosticResult.legacyPackages.size,
        diagnosticsBySeverity,
      },
    };
  }
}
