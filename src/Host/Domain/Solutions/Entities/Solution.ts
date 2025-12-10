import { Project } from '../../Projects/Entities/Project';
import { SolutionFormat } from '../Enums/SolutionFormat';
import { SolutionFolder, SolutionProject } from './SolutionFolder';

/**
 * Represents a complete .NET solution with its structure and metadata
 */
export class Solution {
  /** Absolute path to the solution file (.sln or .slnx) */
  public filePath: string;

  /** Format of the solution file */
  public format: SolutionFormat;

  /** Display name of the solution (filename without extension) */
  public name: string;

  /** List of projects in the solution */
  public projects: Project[];

  /** Hierarchical structure: root-level folders and projects */
  public rootItems: (SolutionFolder | SolutionProject)[];

  /** Indicates if the solution uses centrally managed package versions */
  public isCentrallyManaged: boolean;

  /** Optional path to Directory.Packages.props when CPM is enabled */
  public directoryPackagesPropsPath?: string;

  /** .NET SDK version from global.json (if present) */
  public dotnetSdkVersion?: string;

  /** Path to global.json (if present) */
  public globalJsonPath?: string;

  constructor(
    filePath: string,
    format: SolutionFormat,
    name: string,
    projects: Project[],
    rootItems: (SolutionFolder | SolutionProject)[] = [],
    isCentrallyManaged: boolean = false,
    directoryPackagesPropsPath?: string,
    dotnetSdkVersion?: string,
    globalJsonPath?: string
  ) {
    this.filePath = filePath;
    this.format = format;
    this.name = name;
    this.projects = projects;
    this.rootItems = rootItems;
    this.isCentrallyManaged = isCentrallyManaged;
    this.directoryPackagesPropsPath = directoryPackagesPropsPath;
    this.dotnetSdkVersion = dotnetSdkVersion;
    this.globalJsonPath = globalJsonPath;
  }

  /**
   * Gets all solution folders recursively
   */
  public getAllFolders(): SolutionFolder[] {
    const folders: SolutionFolder[] = [];
    for (const item of this.rootItems) {
      if (item instanceof SolutionFolder) {
        folders.push(item);
        folders.push(...this.getFoldersRecursive(item));
      }
    }
    return folders;
  }

  /**
   * Gets all solution projects (flat list)
   */
  public getAllSolutionProjects(): SolutionProject[] {
    const projects: SolutionProject[] = [];
    for (const item of this.rootItems) {
      if (item instanceof SolutionProject) {
        projects.push(item);
      } else if (item instanceof SolutionFolder) {
        projects.push(...item.getAllProjects());
      }
    }
    return projects;
  }

  private getFoldersRecursive(folder: SolutionFolder): SolutionFolder[] {
    const folders: SolutionFolder[] = [];
    for (const child of folder.children) {
      if (child instanceof SolutionFolder) {
        folders.push(child);
        folders.push(...this.getFoldersRecursive(child));
      }
    }
    return folders;
  }
}
