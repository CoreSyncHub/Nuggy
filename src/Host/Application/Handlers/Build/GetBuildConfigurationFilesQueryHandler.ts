import { injectable } from 'tsyringe';
import { IQueryHandler } from '@Shared/Abstractions/Messaging/IQueryHandler';
import { GetBuildConfigurationFilesQuery } from '@Shared/Features/Queries/GetBuildConfigurationFilesQuery';
import { BuildConfigStructureDto, BuildConfigFileDto } from '@Shared/Features/Dtos/BuildConfigDto';
import { HandlerFor } from '@Shared/Infrastructure/Messaging/HandlerFor';
import { BuildConfigDetector } from '@Infrastructure/Build/BuildConfigDetector';
import { BuildConfigParser } from '@Infrastructure/Build/BuildConfigParser';
import { BuildConfigFileType } from '@Domain/Build/Enums/BuildConfigFileType';

/**
 * Handler for GetBuildConfigurationFilesQuery
 * Returns all MSBuild configuration files with their hierarchical relationships
 */
@injectable()
@HandlerFor(GetBuildConfigurationFilesQuery)
export class GetBuildConfigurationFilesQueryHandler
  implements IQueryHandler<GetBuildConfigurationFilesQuery, BuildConfigStructureDto>
{
  async Handle(_: GetBuildConfigurationFilesQuery): Promise<BuildConfigStructureDto> {
    // Find all configuration files
    const configFiles = await BuildConfigDetector.findAllConfigFiles();

    // Build hierarchical relationships
    BuildConfigDetector.buildHierarchy(configFiles);

    // Parse each file to extract properties
    for (const file of configFiles) {
      BuildConfigParser.parse(file.path, file);
    }

    // TODO: Get project paths from the solution (for now, we'll leave affectedProjects empty)
    // In a future iteration, we should integrate with GetSolutionStructureQuery
    // to map which projects are affected by which configuration files

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
}
