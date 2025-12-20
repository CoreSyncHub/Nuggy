import { PackageIdentity } from '../ValueObjects/PackageIdentity';

/**
 * Represents a PackageReference from a .csproj file
 */
export class PackageReference {
  constructor(
    public readonly identity: PackageIdentity,
    public readonly projectPath: string,
    public readonly hasLocalVersion: boolean
  ) {}

  /**
   * Gets the package name
   */
  public get name(): string {
    return this.identity.name;
  }

  /**
   * Gets the package version (if specified locally)
   */
  public get version(): string | undefined {
    return this.identity.version;
  }

  /**
   * Checks if this reference conflicts with CPM
   * (has a local version when CPM is enabled)
   */
  public conflictsWithCpm(): boolean {
    return this.hasLocalVersion;
  }
}
