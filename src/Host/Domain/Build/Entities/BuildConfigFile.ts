import { BuildConfigFileType } from '../Enums/BuildConfigFileType';

/**
 * Represents a MSBuild configuration file (Directory.Build.props/targets or Directory.Packages.props)
 * These files are automatically imported by MSBuild in a hierarchical manner
 */
export class BuildConfigFile {
  /** Absolute path to the configuration file */
  public path: string;

  /** Type of configuration file */
  public type: BuildConfigFileType;

  /** Directory containing this file */
  public directory: string;

  /** Parent configuration file (null for root-level files) */
  public parent: BuildConfigFile | null;

  /** Child configuration files in subdirectories */
  public children: BuildConfigFile[];

  /** Project paths affected by this configuration file */
  public affectedProjects: string[];

  /** Properties defined in this file (key-value pairs) */
  public properties: Map<string, string>;

  /** Indicates if this file imports its parent explicitly */
  public importsParent: boolean;

  constructor(
    path: string,
    type: BuildConfigFileType,
    directory: string,
    parent: BuildConfigFile | null = null,
    importsParent: boolean = false
  ) {
    this.path = path;
    this.type = type;
    this.directory = directory;
    this.parent = parent;
    this.children = [];
    this.affectedProjects = [];
    this.properties = new Map();
    this.importsParent = importsParent;
  }

  /**
   * Adds a child configuration file
   */
  public addChild(child: BuildConfigFile): void {
    this.children.push(child);
  }

  /**
   * Adds a project path to the list of affected projects
   */
  public addAffectedProject(projectPath: string): void {
    if (!this.affectedProjects.includes(projectPath)) {
      this.affectedProjects.push(projectPath);
    }
  }

  /**
   * Sets a property defined in this file
   */
  public setProperty(key: string, value: string): void {
    this.properties.set(key, value);
  }

  /**
   * Gets all properties including inherited ones (from parent chain)
   */
  public getAllProperties(): Map<string, string> {
    const allProperties = new Map<string, string>();

    // Start from root (walk up to get parent properties first)
    const chain: BuildConfigFile[] = [];
    let current: BuildConfigFile | null = this;
    while (current) {
      chain.unshift(current); // Add to beginning
      current = current.parent;
    }

    // Apply properties in order (root to leaf) - later values override earlier ones
    for (const file of chain) {
      for (const [key, value] of file.properties) {
        allProperties.set(key, value);
      }
    }

    return allProperties;
  }

  /**
   * Gets the depth of this file in the hierarchy (0 = root)
   */
  public getDepth(): number {
    let depth = 0;
    let current = this.parent;
    while (current) {
      depth++;
      current = current.parent;
    }
    return depth;
  }

  /**
   * Checks if this file is CPM-enabled
   */
  public isCentralPackageManagement(): boolean {
    return this.type === BuildConfigFileType.DirectoryPackagesProps;
  }
}
