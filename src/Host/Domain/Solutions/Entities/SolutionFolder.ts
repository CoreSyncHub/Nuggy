import { SolutionItemId } from '../ValueObjects/SolutionItemId';

/**
 * Represents a virtual folder in a solution file (.sln or .slnx)
 * Solution Folders are used to organize projects logically
 */
export class SolutionFolder {
  /** Unique identifier: GUID for .sln, path for .slnx */
  public id: SolutionItemId;

  /** Name of the solution folder as displayed in the IDE */
  public name: string;

  /** Child items: can be either projects or nested solution folders */
  public children: (SolutionFolder | SolutionProject)[];

  /** Parent folder ID (null for root-level folders) */
  public parentId: SolutionItemId | null;

  constructor(
    id: SolutionItemId,
    name: string,
    parentId: SolutionItemId | null = null,
    children: (SolutionFolder | SolutionProject)[] = []
  ) {
    this.id = id;
    this.name = name;
    this.parentId = parentId;
    this.children = children;
  }

  /**
   * Adds a child item (project or folder) to this folder
   */
  public addChild(child: SolutionFolder | SolutionProject): void {
    this.children.push(child);
  }

  /**
   * Checks if this folder contains a specific project by path
   */
  public hasProject(projectPath: string): boolean {
    return this.children.some((child) => {
      if (child instanceof SolutionProject) {
        return child.path === projectPath;
      } else if (child instanceof SolutionFolder) {
        return child.hasProject(projectPath);
      }
      return false;
    });
  }

  /**
   * Gets all projects recursively from this folder
   */
  public getAllProjects(): SolutionProject[] {
    const projects: SolutionProject[] = [];
    for (const child of this.children) {
      if (child instanceof SolutionProject) {
        projects.push(child);
      } else if (child instanceof SolutionFolder) {
        projects.push(...child.getAllProjects());
      }
    }
    return projects;
  }

  /**
   * Finds a child folder by ID
   */
  public findFolderById(id: SolutionItemId): SolutionFolder | undefined {
    if (this.id.equals(id)) {
      return this;
    }

    for (const child of this.children) {
      if (child instanceof SolutionFolder) {
        const found = child.findFolderById(id);
        if (found) {
          return found;
        }
      }
    }

    return undefined;
  }
}

/**
 * Represents a project entry in a solution file
 * This is a reference to a physical .csproj file
 */
export class SolutionProject {
  /** Unique identifier: GUID for .sln, path for .slnx */
  public id: SolutionItemId;

  /** Display name of the project */
  public name: string;

  /** Relative path to the .csproj file from the solution directory */
  public path: string;

  /** Project type GUID (only for .sln format, null for .slnx) */
  public typeId: string | null;

  /** Parent folder ID (null if at root level) */
  public parentId: SolutionItemId | null;

  constructor(
    id: SolutionItemId,
    name: string,
    path: string,
    typeId: string | null = null,
    parentId: SolutionItemId | null = null
  ) {
    this.id = id;
    this.name = name;
    this.path = path;
    this.typeId = typeId;
    this.parentId = parentId;
  }
}
