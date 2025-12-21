import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { XMLParser } from 'fast-xml-parser';
import { NuGetSource } from '../../Domain/Packages/Entities/NuGetSource';
import { NuGetConfigScope } from '../../Domain/Packages/Enums/NuGetConfigScope';
import { PackageSourceMapping } from '../../Domain/Packages/Entities/PackageSourceMapping';

/**
 * Parser for NuGet.Config files
 * Handles XML parsing and extraction of package sources
 */
export class NuGetConfigParser {
  private static readonly xmlParser = new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: '@_',
    parseAttributeValue: false,
    trimValues: true,
  });

  /**
   * Parses a NuGet.Config file and extracts package sources
   * @param configPath Path to the NuGet.Config file
   * @param scope The scope of this configuration file
   * @returns Array of NuGetSource objects
   */
  public static parse(configPath: string, scope: NuGetConfigScope): NuGetSource[] {
    if (!fs.existsSync(configPath)) {
      return [];
    }

    try {
      const content = fs.readFileSync(configPath, 'utf-8');
      const parsed = this.xmlParser.parse(content);

      if (!parsed.configuration) {
        return [];
      }

      const sources: NuGetSource[] = [];

      // Extract package sources
      const packageSources = parsed.configuration.packageSources;
      if (packageSources && packageSources.add) {
        const addElements = Array.isArray(packageSources.add)
          ? packageSources.add
          : [packageSources.add];

        // Extract disabled sources
        const disabledSources = this.extractDisabledSources(parsed.configuration);

        for (const add of addElements) {
          const name = add['@_key'];
          const url = add['@_value'];
          const protocolVersion = add['@_protocolVersion'];

          if (name && url) {
            const isEnabled = !disabledSources.has(name);
            sources.push(
              new NuGetSource(name, url, isEnabled, scope, configPath, 0, protocolVersion)
            );
          }
        }
      }

      return sources;
    } catch (error) {
      console.error(`Error parsing NuGet.Config at ${configPath}:`, error);
      return [];
    }
  }

  /**
   * Extracts the set of disabled source names from the configuration
   */
  private static extractDisabledSources(configuration: any): Set<string> {
    const disabledSources = new Set<string>();

    const disabledPackageSources = configuration.disabledPackageSources;
    if (disabledPackageSources && disabledPackageSources.add) {
      const addElements = Array.isArray(disabledPackageSources.add)
        ? disabledPackageSources.add
        : [disabledPackageSources.add];

      for (const add of addElements) {
        const key = add['@_key'];
        const value = add['@_value'];

        // value can be "true" or "True" to indicate disabled
        if (key && value && value.toLowerCase() === 'true') {
          disabledSources.add(key);
        }
      }
    }

    return disabledSources;
  }

  /**
   * Parses package source mappings from a NuGet.Config file
   * @param configPath Path to the NuGet.Config file
   * @returns Array of PackageSourceMapping objects
   */
  public static parsePackageSourceMappings(configPath: string): PackageSourceMapping[] {
    if (!fs.existsSync(configPath)) {
      return [];
    }

    try {
      const content = fs.readFileSync(configPath, 'utf-8');
      const parsed = this.xmlParser.parse(content);

      if (!parsed.configuration || !parsed.configuration.packageSourceMapping) {
        return [];
      }

      const mappings: PackageSourceMapping[] = [];
      const packageSourceMapping = parsed.configuration.packageSourceMapping;

      // packageSourceMapping contains <packageSource> elements
      if (packageSourceMapping.packageSource) {
        const packageSourceElements = Array.isArray(packageSourceMapping.packageSource)
          ? packageSourceMapping.packageSource
          : [packageSourceMapping.packageSource];

        for (const packageSource of packageSourceElements) {
          const sourceName = packageSource['@_key'];

          // Each packageSource contains <package> elements with pattern attributes
          if (packageSource.package) {
            const packageElements = Array.isArray(packageSource.package)
              ? packageSource.package
              : [packageSource.package];

            for (const pkg of packageElements) {
              const pattern = pkg['@_pattern'];

              if (pattern) {
                // Find existing mapping for this pattern or create new one
                let mapping = mappings.find((m) => m.pattern === pattern);

                if (!mapping) {
                  mapping = new PackageSourceMapping(pattern, []);
                  mappings.push(mapping);
                }

                // Add source name if not already present
                if (sourceName && !mapping.sourceNames.includes(sourceName)) {
                  mapping.sourceNames.push(sourceName);
                }
              }
            }
          }
        }
      }

      return mappings;
    } catch (error) {
      console.error(`Error parsing package source mappings from ${configPath}:`, error);
      return [];
    }
  }

  /**
   * Finds the machine-wide NuGet.Config file
   * @returns Path to the machine-wide config, or undefined if not found
   */
  public static findMachineWideConfig(): string | undefined {
    const platform = os.platform();

    let machineWidePath: string;

    if (platform === 'win32') {
      // Windows: C:\ProgramData\NuGet\NuGet.Config
      const programData = process.env.PROGRAMDATA || 'C:\\ProgramData';
      machineWidePath = path.join(programData, 'NuGet', 'NuGet.Config');
    } else if (platform === 'darwin') {
      // macOS: /Library/Application Support/NuGet/NuGet.Config
      machineWidePath = '/Library/Application Support/NuGet/NuGet.Config';
    } else {
      // Linux: /etc/opt/NuGet/NuGet.Config
      machineWidePath = '/etc/opt/NuGet/NuGet.Config';
    }

    return fs.existsSync(machineWidePath) ? machineWidePath : undefined;
  }

  /**
   * Finds the user-profile NuGet.Config file
   * @returns Path to the user-profile config, or undefined if not found
   */
  public static findUserProfileConfig(): string | undefined {
    const platform = os.platform();
    const homeDir = os.homedir();

    let userProfilePath: string;

    if (platform === 'win32') {
      // Windows: %APPDATA%\NuGet\NuGet.Config
      const appData = process.env.APPDATA || path.join(homeDir, 'AppData', 'Roaming');
      userProfilePath = path.join(appData, 'NuGet', 'NuGet.Config');
    } else {
      // macOS/Linux: ~/.nuget/NuGet/NuGet.Config
      userProfilePath = path.join(homeDir, '.nuget', 'NuGet', 'NuGet.Config');
    }

    return fs.existsSync(userProfilePath) ? userProfilePath : undefined;
  }

  /**
   * Finds all solution-local NuGet.Config files by searching up the directory tree
   * @param startPath Starting directory (usually the solution directory or a project directory)
   * @returns Array of paths to NuGet.Config files, ordered from closest to farthest
   */
  public static findSolutionLocalConfigs(startPath: string): string[] {
    const configPaths: string[] = [];
    let currentDir = path.isAbsolute(startPath) ? startPath : path.resolve(startPath);

    // If startPath is a file, start from its directory
    if (fs.existsSync(currentDir) && fs.statSync(currentDir).isFile()) {
      currentDir = path.dirname(currentDir);
    }

    // Search up the directory tree
    while (currentDir && currentDir !== path.parse(currentDir).root) {
      const configPath = path.join(currentDir, 'NuGet.Config');

      if (fs.existsSync(configPath)) {
        configPaths.push(configPath);
      }

      // Move up one directory
      const parentDir = path.dirname(currentDir);
      if (parentDir === currentDir) {break;} // Reached root
      currentDir = parentDir;
    }

    return configPaths;
  }

  /**
   * Finds all NuGet.Config files from all scopes
   * @param solutionPath Path to the solution file or solution directory
   * @returns Object containing config paths for each scope
   */
  public static findAllConfigs(solutionPath: string): {
    machineWide?: string;
    userProfile?: string;
    solutionLocal: string[];
  } {
    const machineWide = this.findMachineWideConfig();
    const userProfile = this.findUserProfileConfig();
    const solutionLocal = this.findSolutionLocalConfigs(solutionPath);

    return {
      machineWide,
      userProfile,
      solutionLocal,
    };
  }
}
