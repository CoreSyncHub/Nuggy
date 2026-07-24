import { injectable } from 'tsyringe';
import * as path from 'path';
import { IQueryHandler } from '@Shared/Abstractions/Messaging/IQueryHandler';
import { GetBuildConfigurationFilesQuery } from '@Shared/Features/Queries/GetBuildConfigurationFilesQuery';
import { BuildConfigStructureDto, BuildConfigFileDto } from '@Shared/Features/Dtos/BuildConfigDto';
import { HandlerFor } from '@Shared/Infrastructure/Messaging/HandlerFor';
import { BuildConfigDetector } from '@Infrastructure/Build/BuildConfigDetector';
import { BuildConfigParser } from '@Infrastructure/Build/BuildConfigParser';
import { BuildConfigFileType } from '@Domain/Build/Enums/BuildConfigFileType';
import { SlnParser } from '@Infrastructure/Solution/SlnParser';
import { SlnxParser } from '@Infrastructure/Solution/SlnxParser';

/**
 * Handler for GetBuildConfigurationFilesQuery
 * Returns all MSBuild configuration files with their hierarchical relationships
 */
@injectable()
@HandlerFor(GetBuildConfigurationFilesQuery)
export class GetBuildConfigurationFilesQueryHandler
  implements IQueryHandler<GetBuildConfigurationFilesQuery, BuildConfigStructureDto>
{
  constructor(
    private readonly buildConfigDetector: BuildConfigDetector,
    private readonly buildConfigParser: BuildConfigParser,
    private readonly slnParser: SlnParser,
    private readonly slnxParser: SlnxParser
  ) {}

  async Handle(query: GetBuildConfigurationFilesQuery): Promise<BuildConfigStructureDto> {
    const configFiles = await this.buildConfigDetector.findAllConfigFiles();

    this.buildConfigDetector.buildHierarchy(configFiles);

    for (const file of configFiles) {
      this.buildConfigParser.parse(file.path, file);
    }

    if (query.solutionPath) {
      const projectPaths = this.getProjectPathsFromSolution(query.solutionPath);
      await this.buildConfigDetector.mapAffectedProjects(configFiles, projectPaths);
    }

    const fileDtos: BuildConfigFileDto[] = configFiles.map((file) => ({
      path: file.path,
      type: file.type,
      directory: file.directory,
      depth: file.getDepth(),
      parentPath: file.parent?.path || null,
      childPaths: file.children.map((child) => child.path),
      affectedProjects: file.affectedProjects,
      properties: Object.fromEntries(file.properties),
      importsParent: file.importsParent,
    }));

    const rootFiles = this.buildConfigDetector.getRootFiles(configFiles);
    const rootFileDtos = rootFiles.map((file) => fileDtos.find((dto) => dto.path === file.path)!);

    const isCpmEnabled = this.buildConfigDetector.isCpmEnabled(configFiles);
    const cpmFile = this.buildConfigDetector.getCpmFile(configFiles);

    const summary = {
      totalFiles: configFiles.length,
      propsFiles: configFiles.filter((f) => f.type === BuildConfigFileType.DirectoryBuildProps).length,
      targetsFiles: configFiles.filter((f) => f.type === BuildConfigFileType.DirectoryBuildTargets).length,
      packagesPropsFiles: configFiles.filter((f) => f.type === BuildConfigFileType.DirectoryPackagesProps).length,
      maxDepth: Math.max(0, ...configFiles.map((f) => f.getDepth())),
    };

    return {
      files: fileDtos,
      rootFiles: rootFileDtos,
      isCpmEnabled,
      cpmFilePath: cpmFile?.path,
      summary,
    };
  }

  private getProjectPathsFromSolution(solutionPath: string): string[] {
    const solutionExt = path.extname(solutionPath).toLowerCase();

    if (solutionExt === '.slnx') {
      const parseResult = this.slnxParser.parse(solutionPath);
      return parseResult.projects.map((p) => p.path);
    } else if (solutionExt === '.sln') {
      const parseResult = this.slnParser.parse(solutionPath);
      return parseResult.projects.map((p) => p.path);
    }

    return [];
  }
}
