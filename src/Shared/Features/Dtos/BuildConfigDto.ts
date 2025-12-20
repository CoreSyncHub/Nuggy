/**
 * DTO representing a MSBuild configuration file
 */
export interface BuildConfigFileDto {
  /** Absolute path to the configuration file */
  path: string;

  /** Type of configuration file */
  type: 'Directory.Build.props' | 'Directory.Build.targets' | 'Directory.Packages.props';

  /** Directory containing this file */
  directory: string;

  /** Depth in the hierarchy (0 = root) */
  depth: number;

  /** Path to parent configuration file (null for root) */
  parentPath: string | null;

  /** Paths to child configuration files */
  childPaths: string[];

  /** Project paths affected by this configuration file */
  affectedProjects: string[];

  /** Properties defined in this file */
  properties: Record<string, string>;

  /** Indicates if this file explicitly imports its parent */
  importsParent: boolean;
}

/**
 * DTO representing the complete build configuration structure
 */
export interface BuildConfigStructureDto {
  /** All configuration files found */
  files: BuildConfigFileDto[];

  /** Root-level configuration files (files without parents) */
  rootFiles: BuildConfigFileDto[];

  /** Indicates if Central Package Management is enabled */
  isCpmEnabled: boolean;

  /** Path to Directory.Packages.props (if CPM is enabled) */
  cpmFilePath?: string;

  /** Summary statistics */
  summary: {
    totalFiles: number;
    propsFiles: number;
    targetsFiles: number;
    packagesPropsFiles: number;
    maxDepth: number;
  };
}
