import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { XMLParser } from 'fast-xml-parser';
import { singleton } from 'tsyringe';
import { NuGetSource } from '../../Domain/Packages/Entities/NuGetSource';
import { type NuGetConfigScope } from '../../Domain/Packages/Enums/NuGetConfigScope';
import { PackageSourceMapping } from '../../Domain/Packages/Entities/PackageSourceMapping';
import { type ILogger, LOGGER } from '../../Application/Abstractions/Log/ILogger';
import { injectToken } from '@Shared/DependencyInjection/inject';

/**
 * Parser for NuGet.Config files
 */
@singleton()
export class NuGetConfigParser {
  private readonly xmlParser = new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: '@_',
    parseAttributeValue: false,
    trimValues: true,
  });

  constructor(@injectToken(LOGGER) private readonly logger: ILogger) {}

  /**
   * Parses a NuGet.Config file and extracts package sources
   */
  public parse(configPath: string, scope: NuGetConfigScope): NuGetSource[] {
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

      const packageSources = parsed.configuration.packageSources;
      if (packageSources && packageSources.add) {
        const addElements = Array.isArray(packageSources.add)
          ? packageSources.add
          : [packageSources.add];

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
      this.logger.Error(`Error parsing NuGet.Config at ${configPath}`, error as Error);
      return [];
    }
  }

  private extractDisabledSources(configuration: any): Set<string> {
    const disabledSources = new Set<string>();

    const disabledPackageSources = configuration.disabledPackageSources;
    if (disabledPackageSources && disabledPackageSources.add) {
      const addElements = Array.isArray(disabledPackageSources.add)
        ? disabledPackageSources.add
        : [disabledPackageSources.add];

      for (const add of addElements) {
        const key = add['@_key'];
        const value = add['@_value'];

        if (key && value && value.toLowerCase() === 'true') {
          disabledSources.add(key);
        }
      }
    }

    return disabledSources;
  }

  /**
   * Parses package source mappings from a NuGet.Config file
   */
  public parsePackageSourceMappings(configPath: string): PackageSourceMapping[] {
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

      if (packageSourceMapping.packageSource) {
        const packageSourceElements = Array.isArray(packageSourceMapping.packageSource)
          ? packageSourceMapping.packageSource
          : [packageSourceMapping.packageSource];

        for (const packageSource of packageSourceElements) {
          const sourceName = packageSource['@_key'];

          if (packageSource.package) {
            const packageElements = Array.isArray(packageSource.package)
              ? packageSource.package
              : [packageSource.package];

            for (const pkg of packageElements) {
              const pattern = pkg['@_pattern'];

              if (pattern) {
                let mapping = mappings.find((m) => m.pattern === pattern);

                if (!mapping) {
                  mapping = new PackageSourceMapping(pattern, []);
                  mappings.push(mapping);
                }

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
      this.logger.Error(`Error parsing package source mappings from ${configPath}`, error as Error);
      return [];
    }
  }

  /**
   * Finds the machine-wide NuGet.Config file
   */
  public findMachineWideConfig(): string | undefined {
    const platform = os.platform();

    let machineWidePath: string;

    if (platform === 'win32') {
      const programData = process.env.PROGRAMDATA || 'C:\\ProgramData';
      machineWidePath = path.win32.join(programData, 'NuGet', 'NuGet.Config');
    } else if (platform === 'darwin') {
      machineWidePath = '/Library/Application Support/NuGet/NuGet.Config';
    } else {
      machineWidePath = '/etc/opt/NuGet/NuGet.Config';
    }

    return fs.existsSync(machineWidePath) ? machineWidePath : undefined;
  }

  /**
   * Finds the user-profile NuGet.Config file
   */
  public findUserProfileConfig(): string | undefined {
    const platform = os.platform();
    const homeDir = os.homedir();

    let userProfilePath: string;

    if (platform === 'win32') {
      const appData = process.env.APPDATA || path.win32.join(homeDir, 'AppData', 'Roaming');
      userProfilePath = path.win32.join(appData, 'NuGet', 'NuGet.Config');
    } else {
      userProfilePath = path.join(homeDir, '.nuget', 'NuGet', 'NuGet.Config');
    }

    return fs.existsSync(userProfilePath) ? userProfilePath : undefined;
  }

  /**
   * Finds all solution-local NuGet.Config files by searching up the directory tree
   */
  public findSolutionLocalConfigs(startPath: string): string[] {
    const configPaths: string[] = [];
    let currentDir = path.isAbsolute(startPath) ? startPath : path.resolve(startPath);

    if (fs.existsSync(currentDir) && fs.statSync(currentDir).isFile()) {
      currentDir = path.dirname(currentDir);
    }

    while (currentDir && currentDir !== path.parse(currentDir).root) {
      const configPath = path.join(currentDir, 'NuGet.Config');

      if (fs.existsSync(configPath)) {
        configPaths.push(configPath);
      }

      const parentDir = path.dirname(currentDir);
      if (parentDir === currentDir) { break; }
      currentDir = parentDir;
    }

    return configPaths;
  }

  /**
   * Finds all NuGet.Config files from all scopes
   */
  public findAllConfigs(solutionPath: string): {
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
