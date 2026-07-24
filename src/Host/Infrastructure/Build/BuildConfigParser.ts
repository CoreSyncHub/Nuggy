import * as fs from 'fs';
import { XMLParser } from 'fast-xml-parser';
import { singleton } from 'tsyringe';
import { BuildConfigFile } from '../../Domain/Build/Entities/BuildConfigFile';
import { ILogger, LOGGER } from '../../Application/Abstractions/Log/ILogger';
import { injectToken } from '@Shared/DependencyInjection/inject';

/**
 * Parser for MSBuild configuration files (.props and .targets)
 */
@singleton()
export class BuildConfigParser {
  private readonly xmlParser = new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: '@_',
    parseAttributeValue: false,
    trimValues: true,
  });

  constructor(@injectToken(LOGGER) private readonly logger: ILogger) {}

  /**
   * Parses a .props or .targets file and extracts properties
   */
  public parse(filePath: string, configFile: BuildConfigFile): void {
    try {
      const content = fs.readFileSync(filePath, 'utf-8');
      const parsed = this.xmlParser.parse(content);

      if (!parsed.Project) {
        return;
      }

      const project = parsed.Project;

      this.extractProperties(project, configFile);
      this.checkParentImport(project, configFile);
    } catch (error) {
      this.logger.Error(`Failed to parse ${filePath}`, error as Error);
    }
  }

  private extractProperties(project: any, configFile: BuildConfigFile): void {
    if (!project.PropertyGroup) {
      return;
    }

    const propertyGroups = Array.isArray(project.PropertyGroup)
      ? project.PropertyGroup
      : [project.PropertyGroup];

    for (const group of propertyGroups) {
      for (const [key, value] of Object.entries(group)) {
        if (key.startsWith('@_') || key === 'Condition') {
          continue;
        }

        if (typeof value === 'string') {
          configFile.setProperty(key, value);
        } else if (typeof value === 'object' && value !== null) {
          const textValue = (value as any)['#text'] || JSON.stringify(value);
          configFile.setProperty(key, textValue);
        }
      }
    }
  }

  private checkParentImport(project: any, configFile: BuildConfigFile): void {
    if (!project.Import) {
      return;
    }

    const imports = Array.isArray(project.Import) ? project.Import : [project.Import];

    const parentImportPatterns = [
      '$(MSBuildThisFileDirectory)',
      'GetDirectoryNameOfFileAbove',
      '..\\Directory.Build.props',
      '../Directory.Build.props',
      '..\\Directory.Build.targets',
      '../Directory.Build.targets',
    ];

    for (const importElement of imports) {
      const projectAttr = importElement['@_Project'];
      if (!projectAttr) {
        continue;
      }

      for (const pattern of parentImportPatterns) {
        if (projectAttr.includes(pattern)) {
          configFile.importsParent = true;
          return;
        }
      }
    }
  }

  /**
   * Extracts commonly used properties for quick access
   */
  public getCommonProperties(configFile: BuildConfigFile): {
    targetFramework?: string;
    langVersion?: string;
    nullable?: string;
    implicitUsings?: string;
    managePackageVersionsCentrally?: string;
  } {
    const props = configFile.properties;

    return {
      targetFramework: props.get('TargetFramework'),
      langVersion: props.get('LangVersion'),
      nullable: props.get('Nullable'),
      implicitUsings: props.get('ImplicitUsings'),
      managePackageVersionsCentrally: props.get('ManagePackageVersionsCentrally'),
    };
  }
}
