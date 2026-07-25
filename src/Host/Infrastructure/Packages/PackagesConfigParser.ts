import * as fs from "fs";
import * as path from "path";
import { XMLParser } from "fast-xml-parser";
import { singleton } from "tsyringe";
import { LegacyPackage } from "../../Domain/Packages/Entities/LegacyPackage";
import { PackageIdentity } from "../../Domain/Packages/ValueObjects/PackageIdentity";
import { type ILogger, LOGGER } from "../../Application/Abstractions/Log/ILogger";
import { injectToken } from "@Shared/DependencyInjection/inject";

/**
 * Parser for packages.config files (legacy NuGet format)
 */
@singleton()
export class PackagesConfigParser {
  private readonly xmlParser = new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: "@_",
  });

  constructor(@injectToken(LOGGER) private readonly logger: ILogger) {}

  /**
   * Parses a packages.config file and returns LegacyPackage entries
   */
  public parse(configPath: string, projectPath: string): LegacyPackage[] {
    try {
      const content = fs.readFileSync(configPath, "utf-8");
      const parsed = this.xmlParser.parse(content);

      if (!parsed.packages || !parsed.packages.package) {
        return [];
      }

      const packageElements = Array.isArray(parsed.packages.package)
        ? parsed.packages.package
        : [parsed.packages.package];

      return packageElements.map((pkg: any) => {
        const name = pkg["@_id"];
        const version = pkg["@_version"];
        const targetFramework = pkg["@_targetFramework"];

        const identity = new PackageIdentity(name, version);
        return new LegacyPackage(identity, projectPath, configPath, targetFramework);
      });
    } catch (error) {
      this.logger.Error(`Error parsing packages.config at ${configPath}`, error as Error);
      return [];
    }
  }

  /**
   * Parses packages.config files for multiple projects
   */
  public parseMultiple(projectPaths: string[]): Map<string, LegacyPackage[]> {
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
   */
  public findPackagesConfig(projectPath: string): string | undefined {
    const projectDir = path.dirname(projectPath);
    const configPath = path.join(projectDir, "packages.config");

    if (fs.existsSync(configPath)) {
      return configPath;
    }

    return undefined;
  }

  /**
   * Checks if a project uses legacy package management
   */
  public isLegacyProject(projectPath: string): boolean {
    return this.findPackagesConfig(projectPath) !== undefined;
  }
}
