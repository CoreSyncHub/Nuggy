/**
 * Represents a unique identifier for solution items (projects or folders)
 * Supports both .sln (GUID-based) and .slnx (path-based) formats
 */
export class SolutionItemId {
  private readonly value: string;

  private constructor(value: string) {
    this.value = value;
  }

  /**
   * Creates a GUID-based identifier (for .sln format)
   */
  public static fromGuid(guid: string): SolutionItemId {
    return new SolutionItemId(guid);
  }

  /**
   * Creates a path-based identifier (for .slnx format)
   */
  public static fromPath(path: string): SolutionItemId {
    return new SolutionItemId(path);
  }

  /**
   * Creates an identifier from a string value
   */
  public static from(value: string): SolutionItemId {
    return new SolutionItemId(value);
  }

  /**
   * Gets the string representation of the identifier
   */
  public toString(): string {
    return this.value;
  }

  /**
   * Checks if this identifier equals another
   */
  public equals(other: SolutionItemId | null): boolean {
    if (!other) {
      return false;
    }
    return this.value === other.value;
  }

  /**
   * Checks if this identifier is a GUID (typical for .sln format)
   */
  public isGuid(): boolean {
    const guidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    return guidPattern.test(this.value);
  }

  /**
   * Checks if this identifier is a path (typical for .slnx format)
   */
  public isPath(): boolean {
    return !this.isGuid();
  }
}
