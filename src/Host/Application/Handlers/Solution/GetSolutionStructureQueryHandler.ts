import { injectable } from 'tsyringe';
import * as path from 'path';
import { IQueryHandler } from '../../../../Shared/Abstractions/Messaging/IQueryHandler';
import { GetSolutionStructureQuery } from '../../../../Shared/Features/Queries/GetSolutionStructureQuery';
import {
  SolutionStructureDto,
  SolutionProjectDto,
  SolutionFolderDto,
} from '../../../../Shared/Features/Dtos/SolutionDto';
import { HandlerFor } from '../../../../Shared/Infrastructure/Messaging/HandlerFor';
import { SlnParser } from '../../../Infrastructure/Solution/SlnParser';
import { SlnxParser } from '../../../Infrastructure/Solution/SlnxParser';
import { GlobalJsonParser } from '../../../Infrastructure/Solution/GlobalJsonParser';
import { SolutionFolder, SolutionProject } from '../../../Domain/Solutions/Entities/SolutionFolder';

/**
 * Handler for GetSolutionStructureQuery
 * Returns the complete hierarchical structure of a solution
 */
@injectable()
@HandlerFor(GetSolutionStructureQuery)
export class GetSolutionStructureQueryHandler
  implements IQueryHandler<GetSolutionStructureQuery, SolutionStructureDto>
{
  async Handle(query: GetSolutionStructureQuery): Promise<SolutionStructureDto> {
    const solutionPath = query.solutionPath;
    const solutionDir = path.dirname(solutionPath);
    const solutionName = path.basename(solutionPath, path.extname(solutionPath));
    const solutionExt = path.extname(solutionPath).toLowerCase();

    // Determine format and parse accordingly
    let parseResult: {
      projects: SolutionProject[];
      folders: SolutionFolder[];
      rootItems: (SolutionFolder | SolutionProject)[];
    };

    if (solutionExt === '.slnx') {
      parseResult = SlnxParser.parse(solutionPath);
    } else if (solutionExt === '.sln') {
      parseResult = SlnParser.parse(solutionPath);
    } else {
      throw new Error(`Unsupported solution format: ${solutionExt}`);
    }

    // Find global.json
    const { version: dotnetSdkVersion, globalJsonPath } =
      GlobalJsonParser.findSdkVersion(solutionDir);

    // Check for CPM (Directory.Packages.props)
    const directoryPackagesPropsPath = path.join(solutionDir, 'Directory.Packages.props');
    const isCentrallyManaged = require('fs').existsSync(directoryPackagesPropsPath);

    // Map projects to DTOs
    const projectDtos: SolutionProjectDto[] = parseResult.projects.map((project) => ({
      id: project.id.toString(),
      name: project.name,
      path: project.path,
      typeId: project.typeId,
      parentId: project.parentId?.toString() ?? null,
    }));

    // Map folders to DTOs
    const folderDtos: SolutionFolderDto[] = parseResult.folders.map((folder) => {
      const projectIds: string[] = [];
      const folderIds: string[] = [];

      for (const child of folder.children) {
        if (child instanceof SolutionProject) {
          projectIds.push(child.id.toString());
        } else if (child instanceof SolutionFolder) {
          folderIds.push(child.id.toString());
        }
      }

      return {
        id: folder.id.toString(),
        name: folder.name,
        parentId: folder.parentId?.toString() ?? null,
        projectIds,
        folderIds,
      };
    });

    // Get root item IDs
    const rootItemIds = parseResult.rootItems.map((item) => item.id.toString());

    return {
      solution: {
        path: solutionPath,
        name: solutionName,
        format: solutionExt === '.slnx' ? 'slnx' : 'sln',
        workspaceFolder: '', // Will be filled by the caller if needed
        isSelected: false, // Will be filled by the caller if needed
      },
      projects: projectDtos,
      folders: folderDtos,
      rootItemIds,
      isCentrallyManaged,
      directoryPackagesPropsPath: isCentrallyManaged ? directoryPackagesPropsPath : undefined,
      dotnetSdkVersion: dotnetSdkVersion ?? undefined,
      globalJsonPath: globalJsonPath ?? undefined,
    };
  }
}
