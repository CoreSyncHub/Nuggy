import { PackageIdentity } from '../ValueObjects/PackageIdentity';

/**
 * Represents a package from a legacy packages.config file
 */
export class LegacyPackage {
  /**
   * Creates a new LegacyPackage
   * @param identity - Package identity (name + version)
   * @param projectPath - Path to the project file (.csproj)
   * @param configPath - Path to the packages.config file
   * @param targetFramework - Optional target framework (e.g., net472, net48)
   */
  constructor(
    public readonly identity: PackageIdentity,
    public readonly projectPath: string,
    public readonly configPath: string,
    public readonly targetFramework?: string
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
   * Converts to string representation
   */
  public toString(): string {
    const framework = this.targetFramework ? ` (${this.targetFramework})` : '';
    return `${this.identity.toString()}${framework}`;
  }
}
