import { Package } from '../../Packages/Entities/Package';
import { ProjectType } from '../Enums/ProjectType';

/**
 * Represents a .NET project (.csproj file) with its packages and metadata
 */
export class Project {
  /** Display name of the project */
  public name: string;

  /** Absolute path to the .csproj file */
  public path: string;

  /** List of NuGet packages referenced by this project */
  public packages: Package[];

  /** Type of the project (SDK-style, legacy, etc.) */
  public type?: ProjectType;

  /** Target framework moniker (e.g., net8.0, net6.0, netstandard2.0) */
  public targetFramework?: string;

  /** List of target frameworks for multi-targeting projects */
  public targetFrameworks?: string[];

  constructor(
    name: string,
    path: string,
    packages: Package[] = [],
    type?: ProjectType,
    targetFramework?: string,
    targetFrameworks?: string[]
  ) {
    this.name = name;
    this.path = path;
    this.packages = packages;
    this.type = type;
    this.targetFramework = targetFramework;
    this.targetFrameworks = targetFrameworks;
  }

  /**
   * Gets a package by its ID
   */
  public getPackageById(packageId: string): Package | undefined {
    return this.packages.find((pkg) => pkg.id === packageId);
  }

  /**
   * Adds a package to the project
   */
  public addPackage(pkg: Package): void {
    this.packages.push(pkg);
  }

  /**
   * Removes a package from the project
   */
  public removePackage(packageId: string): void {
    this.packages = this.packages.filter((pkg) => pkg.id !== packageId);
  }

  /**
   * Checks if this project is multi-targeting
   */
  public isMultiTargeting(): boolean {
    return (this.targetFrameworks?.length ?? 0) > 1;
  }

  /**
   * Gets all target frameworks (returns array with single TFM if not multi-targeting)
   */
  public getAllTargetFrameworks(): string[] {
    if (this.targetFrameworks && this.targetFrameworks.length > 0) {
      return this.targetFrameworks;
    }
    return this.targetFramework ? [this.targetFramework] : [];
  }
}
