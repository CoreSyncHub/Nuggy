/**
 * Represents a NuGet package reference in a project
 */
export class Package {
  /** Package identifier (e.g., "Newtonsoft.Json") */
  public id: string;

  /** Installed version */
  public version: string;

  /** Indicates if this is a development dependency */
  public isDevelopmentDependency?: boolean;

  /** Indicates if version comes from Central Package Management */
  public isCentrallyManaged?: boolean;

  constructor(
    id: string,
    version: string,
    isDevelopmentDependency?: boolean,
    isCentrallyManaged?: boolean
  ) {
    this.id = id;
    this.version = version;
    this.isDevelopmentDependency = isDevelopmentDependency;
    this.isCentrallyManaged = isCentrallyManaged;
  }
}
