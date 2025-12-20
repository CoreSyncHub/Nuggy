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
  async Handle(query: GetBuildConfigurationFilesQuery): Promise<BuildConfigStructureDto> {
    // Find all configuration files
    const configFiles = await BuildConfigDetector.findAllConfigFiles();

    // Build hierarchical relationships
    BuildConfigDetector.buildHierarchy(configFiles);

    // Parse each file to extract properties
    for (const file of configFiles) {
      BuildConfigParser.parse(file.path, file);
    }

    // Map affected projects if a solution path is provided
    if (query.solutionPath) {
      const projectPaths = this.getProjectPathsFromSolution(query.solutionPath);
      await BuildConfigDetector.mapAffectedProjects(configFiles, projectPaths);
    }

    // Convert to DTOs
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

    // Get root files
    const rootFiles = BuildConfigDetector.getRootFiles(configFiles);
    const rootFileDtos = rootFiles.map((file) => fileDtos.find((dto) => dto.path === file.path)!);

    // Check if CPM is enabled
    const isCpmEnabled = BuildConfigDetector.isCpmEnabled(configFiles);
    const cpmFile = BuildConfigDetector.getCpmFile(configFiles);

    // Calculate summary statistics
    const summary = {
      totalFiles: configFiles.length,
      propsFiles: configFiles.filter((f) => f.type === BuildConfigFileType.DirectoryBuildProps)
        .length,
      targetsFiles: configFiles.filter((f) => f.type === BuildConfigFileType.DirectoryBuildTargets)
        .length,
      packagesPropsFiles: configFiles.filter(
        (f) => f.type === BuildConfigFileType.DirectoryPackagesProps
      ).length,
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

  /**
   * Extracts project paths from a solution file
   */
  private getProjectPathsFromSolution(solutionPath: string): string[] {
    const solutionExt = path.extname(solutionPath).toLowerCase();

    if (solutionExt === '.slnx') {
      const parseResult = SlnxParser.parse(solutionPath);
      return parseResult.projects.map((p) => p.path);
    } else if (solutionExt === '.sln') {
      const parseResult = SlnParser.parse(solutionPath);
      return parseResult.projects.map((p) => p.path);
    }

    return [];
  }
}
