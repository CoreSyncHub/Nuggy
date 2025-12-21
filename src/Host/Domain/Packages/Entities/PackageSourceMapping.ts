/**
 * Represents a package source mapping rule
 * Maps package ID patterns to specific NuGet sources
 */
export class PackageSourceMapping {
  constructor(
    /** Package ID pattern (e.g., "Contoso.*", "Microsoft.*") */
    public readonly pattern: string,

    /** Source names that can provide packages matching this pattern */
    public readonly sourceNames: string[]
  ) {}

  /**
   * Checks if a package ID matches this mapping pattern
   * Supports wildcard patterns using * (e.g., "Contoso.*" matches "Contoso.Core")
   */
  public matches(packageId: string): boolean {
    // Convert glob pattern to regex
    // Escape special regex characters except *
    const regexPattern = this.pattern
      .replace(/[.+?^${}()|[\]\\]/g, '\\$&') // Escape special chars
      .replace(/\*/g, '.*'); // Convert * to .*

    const regex = new RegExp(`^${regexPattern}$`, 'i');
    return regex.test(packageId);
  }
}
