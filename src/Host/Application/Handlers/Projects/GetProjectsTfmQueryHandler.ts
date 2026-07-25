import { injectable } from 'tsyringe';
import * as path from 'path';
import { type IQueryHandler } from '@Shared/Abstractions/Messaging/IQueryHandler';
import { GetProjectsTfmQuery } from '@Shared/Features/Queries/GetProjectsTfmQuery';
import { type ProjectsTfmDto, type ProjectTfmDto } from '@Shared/Features/Dtos/ProjectTfmDto';
import { HandlerFor } from '@Shared/Infrastructure/Messaging/HandlerFor';
import { SlnParser } from '@Infrastructure/Solution/SlnParser';
import { SlnxParser } from '@Infrastructure/Solution/SlnxParser';
import { BuildConfigDetector } from '@Infrastructure/Build/BuildConfigDetector';
import { BuildConfigParser } from '@Infrastructure/Build/BuildConfigParser';
import { TfmResolver } from '@Infrastructure/Projects/TfmResolver';

/**
 * Handler for GetProjectsTfmQuery
 * Returns the effective TFM for all projects in a solution
 */
@injectable()
@HandlerFor(GetProjectsTfmQuery)
export class GetProjectsTfmQueryHandler
  implements IQueryHandler<GetProjectsTfmQuery, ProjectsTfmDto>
{
  constructor(
    private readonly slnParser: SlnParser,
    private readonly slnxParser: SlnxParser,
    private readonly buildConfigDetector: BuildConfigDetector,
    private readonly buildConfigParser: BuildConfigParser,
    private readonly tfmResolver: TfmResolver
  ) {}

  async Handle(query: GetProjectsTfmQuery): Promise<ProjectsTfmDto> {
    const solutionPath = query.solutionPath;
    const solutionExt = path.extname(solutionPath).toLowerCase();

    let projectPaths: string[];

    if (solutionExt === '.slnx') {
      const parseResult = this.slnxParser.parse(solutionPath);
      projectPaths = parseResult.projects.map((p) => p.path);
    } else if (solutionExt === '.sln') {
      const parseResult = this.slnParser.parse(solutionPath);
      projectPaths = parseResult.projects.map((p) => p.path);
    } else {
      throw new Error(`Unsupported solution format: ${solutionExt}`);
    }

    const buildConfigFiles = await this.buildConfigDetector.findAllConfigFiles();
    this.buildConfigDetector.buildHierarchy(buildConfigFiles);

    for (const file of buildConfigFiles) {
      this.buildConfigParser.parse(file.path, file);
    }

    const resolvedTfms = this.tfmResolver.resolveMultiple(projectPaths, buildConfigFiles);

    const projectDtos: ProjectTfmDto[] = [];
    for (const [projectPath, resolvedTfm] of resolvedTfms) {
      const projectName = path.basename(projectPath, '.csproj');

      projectDtos.push({
        projectPath,
        projectName,
        targetFrameworks: resolvedTfm.targetFrameworks,
        isMultiTargeting: resolvedTfm.isMultiTargeting,
        primaryTargetFramework: resolvedTfm.primaryTargetFramework,
        source: resolvedTfm.source,
        sdkType: resolvedTfm.sdkType,
        sdk: resolvedTfm.sdk,
      });
    }

    const sdkStyleProjects = projectDtos.filter((p) => p.sdkType === 'SDK-Style').length;
    const legacyProjects = projectDtos.filter((p) => p.sdkType === 'Legacy').length;
    const multiTargetingProjects = projectDtos.filter((p) => p.isMultiTargeting).length;

    const allTfms = new Set<string>();
    for (const project of projectDtos) {
      for (const tfm of project.targetFrameworks) {
        allTfms.add(tfm);
      }
    }

    return {
      projects: projectDtos,
      summary: {
        totalProjects: projectDtos.length,
        sdkStyleProjects,
        legacyProjects,
        multiTargetingProjects,
        uniqueTargetFrameworks: Array.from(allTfms).sort(),
      },
    };
  }
}
