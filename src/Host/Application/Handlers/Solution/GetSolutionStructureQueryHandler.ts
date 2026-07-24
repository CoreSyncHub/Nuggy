import { injectable } from 'tsyringe';
import * as path from 'path';
import * as fs from 'fs';
import { IQueryHandler } from '@Shared/Abstractions/Messaging/IQueryHandler';
import { GetSolutionStructureQuery } from '@Shared/Features/Queries/GetSolutionStructureQuery';
import {
  SolutionStructureDto,
  SolutionProjectDto,
  SolutionFolderDto,
} from '@Shared/Features/Dtos/SolutionDto';
import { HandlerFor } from '@Shared/Infrastructure/Messaging/HandlerFor';
import { SlnParser } from '@Infrastructure/Solution/SlnParser';
import { SlnxParser } from '@Infrastructure/Solution/SlnxParser';
import { GlobalJsonParser } from '@Infrastructure/Solution/GlobalJsonParser';
import { SolutionFolder, SolutionProject } from '@Domain/Solutions/Entities/SolutionFolder';

/**
 * Handler for GetSolutionStructureQuery
 * Returns the complete hierarchical structure of a solution
 */
@injectable()
@HandlerFor(GetSolutionStructureQuery)
export class GetSolutionStructureQueryHandler
  implements IQueryHandler<GetSolutionStructureQuery, SolutionStructureDto>
{
  constructor(
    private readonly slnParser: SlnParser,
    private readonly slnxParser: SlnxParser,
    private readonly globalJsonParser: GlobalJsonParser
  ) {}

  async Handle(query: GetSolutionStructureQuery): Promise<SolutionStructureDto> {
    const solutionPath = query.solutionPath;
    const solutionDir = path.dirname(solutionPath);
    const solutionName = path.basename(solutionPath, path.extname(solutionPath));
    const solutionExt = path.extname(solutionPath).toLowerCase();

    let parseResult: {
      projects: SolutionProject[];
      folders: SolutionFolder[];
      rootItems: (SolutionFolder | SolutionProject)[];
    };

    if (solutionExt === '.slnx') {
      parseResult = this.slnxParser.parse(solutionPath);
    } else if (solutionExt === '.sln') {
      parseResult = this.slnParser.parse(solutionPath);
    } else {
      throw new Error(`Unsupported solution format: ${solutionExt}`);
    }

    const { version: dotnetSdkVersion, globalJsonPath } =
      this.globalJsonParser.findSdkVersion(solutionDir);

    const directoryPackagesPropsPath = path.join(solutionDir, 'Directory.Packages.props');
    const isCentrallyManaged = fs.existsSync(directoryPackagesPropsPath);

    const projectDtos: SolutionProjectDto[] = parseResult.projects.map((project) => ({
      id: project.id.toString(),
      name: project.name,
      path: project.path,
      typeId: project.typeId,
      parentId: project.parentId?.toString() ?? null,
    }));

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

    const rootItemIds = parseResult.rootItems.map((item) => item.id.toString());

    return {
      solution: {
        path: solutionPath,
        name: solutionName,
        format: solutionExt === '.slnx' ? 'slnx' : 'sln',
        workspaceFolder: '',
        isSelected: false,
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
