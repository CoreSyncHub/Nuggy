/**
 * Represents a unique package identity (name + version)
 */
export class PackageIdentity {
  constructor(
    public readonly name: string,
    public readonly version?: string
  ) {}

  /**
   * Returns a string representation of the package identity
   */
  public toString(): string {
    return this.version ? `${this.name}@${this.version}` : this.name;
  }

  /**
   * Checks if two package identities are equal
   */
  public equals(other: PackageIdentity): boolean {
    return this.name === other.name && this.version === other.version;
  }

  /**
   * Checks if two packages have the same name (regardless of version)
   */
  public hasSameName(other: PackageIdentity): boolean {
    return this.name === other.name;
  }
}
