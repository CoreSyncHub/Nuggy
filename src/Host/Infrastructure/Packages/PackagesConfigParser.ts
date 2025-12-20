import * as fs from 'fs';
import * as path from 'path';
import { XMLParser } from 'fast-xml-parser';
import { LegacyPackage } from '../../Domain/Packages/Entities/LegacyPackage';
import { PackageIdentity } from '../../Domain/Packages/ValueObjects/PackageIdentity';

/**
 * Parser for packages.config files (legacy NuGet format)
 */
export class PackagesConfigParser {
  private static readonly xmlParser = new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: '@_',
  });

  /**
   * Parses a packages.config file and returns LegacyPackage entries
   * @param configPath - Path to the packages.config file
   * @param projectPath - Path to the associated .csproj file
   * @returns Array of LegacyPackage instances
   */
  public static parse(configPath: string, projectPath: string): LegacyPackage[] {
    try {
      const content = fs.readFileSync(configPath, 'utf-8');
      const parsed = this.xmlParser.parse(content);

      if (!parsed.packages || !parsed.packages.package) {
        return [];
      }

      // Handle both single package and array of packages
      const packageElements = Array.isArray(parsed.packages.package)
        ? parsed.packages.package
        : [parsed.packages.package];

      return packageElements.map((pkg: any) => {
        const name = pkg['@_id'];
        const version = pkg['@_version'];
        const targetFramework = pkg['@_targetFramework'];

        const identity = new PackageIdentity(name, version);
        return new LegacyPackage(identity, projectPath, configPath, targetFramework);
      });
    } catch (error) {
      console.error(`Error parsing packages.config at ${configPath}:`, error);
      return [];
    }
  }

  /**
   * Parses packages.config files for multiple projects
   * @param projectPaths - Array of .csproj file paths
   * @returns Map of project path to LegacyPackage array
   */
  public static parseMultiple(projectPaths: string[]): Map<string, LegacyPackage[]> {
    const result = new Map<string, LegacyPackage[]>();

    for (const projectPath of projectPaths) {
      const configPath = this.findPackagesConfig(projectPath);
      if (configPath) {
        const packages = this.parse(configPath, projectPath);
        if (packages.length > 0) {
          result.set(projectPath, packages);
        }
      }
    }

    return result;
  }

  /**
   * Finds the packages.config file for a given project
   * @param projectPath - Path to the .csproj file
   * @returns Path to packages.config if it exists, undefined otherwise
   */
  public static findPackagesConfig(projectPath: string): string | undefined {
    const projectDir = path.dirname(projectPath);
    const configPath = path.join(projectDir, 'packages.config');

    if (fs.existsSync(configPath)) {
      return configPath;
    }

    return undefined;
  }

  /**
   * Checks if a project uses legacy package management
   * @param projectPath - Path to the .csproj file
   * @returns True if packages.config exists
   */
  public static isLegacyProject(projectPath: string): boolean {
    return this.findPackagesConfig(projectPath) !== undefined;
  }
}
