import { PackageIdentity } from '../ValueObjects/PackageIdentity';

/**
 * Represents a PackageVersion entry from Directory.Packages.props
 * Used in Central Package Management (CPM)
 */
export class PackageVersion {
  constructor(
    public readonly identity: PackageIdentity,
    public readonly sourcePath: string,
    public readonly affectedProjects: string[] = []
  ) {}

  /**
   * Gets the package name
   */
  public get name(): string {
    return this.identity.name;
  }

  /**
   * Gets the package version
   */
  public get version(): string | undefined {
    return this.identity.version;
  }

  /**
   * Adds a project that is affected by this package version
   */
  public addAffectedProject(projectPath: string): void {
    if (!this.affectedProjects.includes(projectPath)) {
      this.affectedProjects.push(projectPath);
    }
  }
}
