/**
 * DTO representing a detected solution in the workspace
 */
export interface SolutionDto {
  /** Absolute path to the solution file */
  path: string;

  /** Display name of the solution */
  name: string;

  /** Format: 'sln' or 'slnx' */
  format: 'sln' | 'slnx';

  /** Workspace folder name */
  workspaceFolder: string;

  /** Indicates if this solution is currently selected */
  isSelected: boolean;
}

/**
 * DTO representing a solution project in the hierarchy
 */
export interface SolutionProjectDto {
  /** Unique identifier (GUID for .sln, path for .slnx) */
  id: string;

  /** Display name of the project */
  name: string;

  /** Path to the .csproj file */
  path: string;

  /** Project type GUID (only for .sln) */
  typeId: string | null;

  /** Parent folder ID (null if at root) */
  parentId: string | null;
}

/**
 * DTO representing a solution folder in the hierarchy
 */
export interface SolutionFolderDto {
  /** Unique identifier (GUID for .sln, path for .slnx) */
  id: string;

  /** Display name of the folder */
  name: string;

  /** Parent folder ID (null if at root) */
  parentId: string | null;

  /** Child project IDs */
  projectIds: string[];

  /** Child folder IDs */
  folderIds: string[];
}

/**
 * DTO representing the complete structure of a solution
 */
export interface SolutionStructureDto {
  /** Solution metadata */
  solution: SolutionDto;

  /** All projects in the solution */
  projects: SolutionProjectDto[];

  /** All folders in the solution */
  folders: SolutionFolderDto[];

  /** Root-level item IDs (projects and folders) */
  rootItemIds: string[];

  /** Indicates if CPM is enabled */
  isCentrallyManaged: boolean;

  /** Path to Directory.Packages.props (if CPM enabled) */
  directoryPackagesPropsPath?: string;

  /** .NET SDK version from global.json */
  dotnetSdkVersion?: string;

  /** Path to global.json */
  globalJsonPath?: string;
}
