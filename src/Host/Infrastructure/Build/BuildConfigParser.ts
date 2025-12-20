import * as fs from 'fs';
import { XMLParser } from 'fast-xml-parser';
import { BuildConfigFile } from '../../Domain/Build/Entities/BuildConfigFile';

/**
 * Parser for MSBuild configuration files (.props and .targets)
 * Extracts properties, items, and import statements
 */
export class BuildConfigParser {
  private static xmlParser = new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: '@_',
    parseAttributeValue: false,
    trimValues: true,
  });

  /**
   * Parses a .props or .targets file and extracts properties
   */
  public static parse(filePath: string, configFile: BuildConfigFile): void {
    try {
      const content = fs.readFileSync(filePath, 'utf-8');
      const parsed = this.xmlParser.parse(content);

      if (!parsed.Project) {
        return;
      }

      const project = parsed.Project;

      // Extract PropertyGroup elements
      this.extractProperties(project, configFile);

      // Check if this file explicitly imports its parent
      this.checkParentImport(project, configFile);
    } catch (error) {
      console.error(`Failed to parse ${filePath}:`, error);
    }
  }

  /**
   * Extracts properties from PropertyGroup elements
   */
  private static extractProperties(project: any, configFile: BuildConfigFile): void {
    if (!project.PropertyGroup) {
      return;
    }

    // PropertyGroup can be a single object or an array
    const propertyGroups = Array.isArray(project.PropertyGroup)
      ? project.PropertyGroup
      : [project.PropertyGroup];

    for (const group of propertyGroups) {
      // Check if this PropertyGroup has a condition (we'll extract all for now)
      // In a real implementation, you might want to evaluate conditions

      // Extract all properties from this group
      for (const [key, value] of Object.entries(group)) {
        // Skip attributes and non-property elements
        if (key.startsWith('@_') || key === 'Condition') {
          continue;
        }

        // Store the property
        if (typeof value === 'string') {
          configFile.setProperty(key, value);
        } else if (typeof value === 'object' && value !== null) {
          // Property might have attributes or nested content
          const textValue =
            (value as any)['#text'] || JSON.stringify(value);
          configFile.setProperty(key, textValue);
        }
      }
    }
  }

  /**
   * Checks if the file explicitly imports its parent
   * This happens when the file contains <Import Project="$([MSBuild]::GetDirectoryNameOfFileAbove(...))" />
   */
  private static checkParentImport(project: any, configFile: BuildConfigFile): void {
    if (!project.Import) {
      return;
    }

    const imports = Array.isArray(project.Import) ? project.Import : [project.Import];

    for (const importElement of imports) {
      const projectAttr = importElement['@_Project'];
      if (!projectAttr) {
        continue;
      }

      // Check for common parent import patterns
      const parentImportPatterns = [
        '$(MSBuildThisFileDirectory)',
        'GetDirectoryNameOfFileAbove',
        '..\\Directory.Build.props',
        '../Directory.Build.props',
        '..\\Directory.Build.targets',
        '../Directory.Build.targets',
      ];

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
  public static getCommonProperties(configFile: BuildConfigFile): {
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
