export type FrameworkFamily =
  "netframework" | "netstandard" | "netcoreapp" | "net5plus" | "unknown";

/**
 * Value object representing a parsed Target Framework Moniker (TFM).
 * Accepts both short forms (net8.0, net472, netstandard2.0) and long forms
 * from nuget.org registrations (.NETStandard2.0, .NETFramework4.5).
 */
export class NuGetFramework {
  private constructor(
    public readonly family: FrameworkFamily,
    public readonly major: number,
    public readonly minor: number,
    public readonly patch: number,
    public readonly platform?: string,
  ) {}

  public static unknown(): NuGetFramework {
    return new NuGetFramework("unknown", 0, 0, 0);
  }

  public static parse(tfm: string): NuGetFramework {
    const normalized = tfm.trim().toLowerCase();
    if (normalized.length === 0) {
      return NuGetFramework.unknown();
    }

    // Long forms from nuget.org registration → equivalent short form
    // .NETStandard2.0 → netstandard2.0
    const longForms: Array<[RegExp, FrameworkFamily]> = [
      [/^\.netstandard(\d+)\.(\d+)$/, "netstandard"],
      [/^\.netcoreapp(\d+)\.(\d+)$/, "netcoreapp"],
      [/^\.netframework(\d+)\.(\d+)(?:\.(\d+))?$/, "netframework"],
    ];
    for (const [pattern, family] of longForms) {
      const m = normalized.match(pattern);
      if (m) {
        return new NuGetFramework(family, Number(m[1]), Number(m[2]), Number(m[3] ?? 0));
      }
    }

    // net5.0+ : version with dot, optional platform suffix
    const modern = normalized.match(/^net(\d+)\.(\d+)(?:-([a-z]+)[\d.]*)?$/);
    if (modern && Number(modern[1]) >= 5) {
      return new NuGetFramework("net5plus", Number(modern[1]), Number(modern[2]), 0, modern[3]);
    }

    const netstandard = normalized.match(/^netstandard(\d+)\.(\d+)$/);
    if (netstandard) {
      return new NuGetFramework("netstandard", Number(netstandard[1]), Number(netstandard[2]), 0);
    }

    const netcoreapp = normalized.match(/^netcoreapp(\d+)\.(\d+)$/);
    if (netcoreapp) {
      return new NuGetFramework("netcoreapp", Number(netcoreapp[1]), Number(netcoreapp[2]), 0);
    }

    // Short .NET Framework forms : net45, net472, net48 (digits = version components)
    const legacy = normalized.match(/^net(\d)(\d)(\d)?$/);
    if (legacy) {
      return new NuGetFramework(
        "netframework",
        Number(legacy[1]),
        Number(legacy[2]),
        Number(legacy[3] ?? 0),
      );
    }

    return NuGetFramework.unknown();
  }

  /**
   * Compares the version of this framework with another framework of the same family.
   * @param other The other NuGetFramework to compare with.
   * @returns True if this framework's version is greater than or equal to the other framework's version; false otherwise.
   */
  public versionAtLeast(other: NuGetFramework): boolean {
    if (this.major !== other.major) {
      return this.major > other.major;
    }
    if (this.minor !== other.minor) {
      return this.minor > other.minor;
    }
    return this.patch >= other.patch;
  }
}
