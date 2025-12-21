import { NuGetConfigScope } from '../Enums/NuGetConfigScope';

/**
 * Represents a NuGet package source
 */
export class NuGetSource {
  constructor(
    /** Source name/key (e.g., "nuget.org", "MyPrivateFeed") */
    public readonly name: string,

    /** Source URL */
    public readonly url: string,

    /** Whether the source is enabled */
    public readonly isEnabled: boolean,

    /** Configuration scope (Machine-wide, User-profile, or Solution-local) */
    public readonly scope: NuGetConfigScope,

    /** Path to the NuGet.Config file that defined this source */
    public readonly configPath: string,

    /** Priority order (lower number = higher priority). Default is 0 if not specified. */
    public readonly priority: number = 0,

    /** Protocol version (v2 or v3). Detected from URL or explicitly specified. */
    public readonly protocolVersion?: string
  ) {}

  /**
   * Checks if this is a private feed (non-NuGet.org)
   */
  public isPrivateFeed(): boolean {
    const normalizedUrl = this.url.toLowerCase();
    return (
      !normalizedUrl.includes('nuget.org') &&
      !normalizedUrl.includes('api.nuget.org')
    );
  }

  /**
   * Checks if this is an Azure Artifacts feed
   */
  public isAzureArtifacts(): boolean {
    const normalizedUrl = this.url.toLowerCase();
    return (
      normalizedUrl.includes('pkgs.visualstudio.com') ||
      normalizedUrl.includes('pkgs.dev.azure.com') ||
      normalizedUrl.includes('azure.com/_packaging')
    );
  }

  /**
   * Checks if this is a BaGet feed
   */
  public isBaGet(): boolean {
    const normalizedUrl = this.url.toLowerCase();
    // BaGet doesn't have a specific URL pattern, but we can detect it by common paths
    return normalizedUrl.includes('/v3/index.json') && this.isPrivateFeed();
  }

  /**
   * Gets the display name for the feed type
   */
  public getFeedType(): string {
    if (!this.isPrivateFeed()) {return 'NuGet.org';}
    if (this.isAzureArtifacts()) {return 'Azure Artifacts';}
    if (this.isBaGet()) {return 'BaGet (or compatible)';}
    return 'Private Feed';
  }

  /**
   * Creates a unique identifier for the source (name@scope)
   */
  public getIdentifier(): string {
    return `${this.name}@${this.scope}`;
  }
}
