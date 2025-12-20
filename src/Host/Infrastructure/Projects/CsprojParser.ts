import * as fs from 'fs';
import { XMLParser } from 'fast-xml-parser';
import { ProjectSdkType } from '../../Domain/Projects/Enums/ProjectSdkType';

/**
 * Represents a parsed .csproj file with extracted TFM information
 */
export interface ParsedCsproj {
  /** SDK type of the project */
  sdkType: ProjectSdkType;

  /** Single target framework (TargetFramework) */
  targetFramework?: string;

  /** Multiple target frameworks (TargetFrameworks with 's') */
  targetFrameworks?: string[];

  /** All PropertyGroups with their conditions */
  propertyGroups: PropertyGroup[];

  /** SDK attribute value (e.g., "Microsoft.NET.Sdk") */
  sdk?: string;
}

/**
 * Represents a PropertyGroup element from the .csproj
 */
export interface PropertyGroup {
  /** Condition attribute (if any) */
  condition?: string;

  /** Properties in this group */
  properties: Record<string, string>;
}

/**
 * Parser for .csproj files (both SDK-style and legacy)
 */
export class CsprojParser {
  private static xmlParser = new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: '@_',
    parseAttributeValue: false,
    trimValues: true,
  });

  /**
   * Parses a .csproj file
   */
  public static parse(csprojPath: string): ParsedCsproj {
    const content = fs.readFileSync(csprojPath, 'utf-8');
    const parsed = this.xmlParser.parse(content);

    if (!parsed.Project) {
      throw new Error(`Invalid .csproj file: ${csprojPath}`);
    }

    const project = parsed.Project;

    // Determine SDK type based on Sdk attribute
    const sdkType = this.determineSdkType(project);
    const sdk = project['@_Sdk'];

    // Extract PropertyGroups
    const propertyGroups = this.extractPropertyGroups(project);

    // Extract TFM information
    const tfmInfo = this.extractTargetFrameworks(propertyGroups);

    return {
      sdkType,
      sdk,
      targetFramework: tfmInfo.targetFramework,
      targetFrameworks: tfmInfo.targetFrameworks,
      propertyGroups,
    };
  }

  /**
   * Determines if a project is SDK-style or legacy
   */
  private static determineSdkType(project: any): ProjectSdkType {
    // SDK-style projects have an Sdk attribute on the Project element
    if (project['@_Sdk']) {
      return 'SDK-Style';
    }

    // Legacy projects don't have Sdk attribute
    // They typically have ToolsVersion and verbose structure
    if (project['@_ToolsVersion'] || project['@_DefaultTargets']) {
      return 'Legacy';
    }

    return 'Unknown';
  }

  /**
   * Extracts all PropertyGroup elements with their conditions
   */
  private static extractPropertyGroups(project: any): PropertyGroup[] {
    if (!project.PropertyGroup) {
      return [];
    }

    const groups = Array.isArray(project.PropertyGroup)
      ? project.PropertyGroup
      : [project.PropertyGroup];

    return groups.map((group: any) => {
      const condition = group['@_Condition'];
      const properties: Record<string, string> = {};

      // Extract all properties from this group
      for (const [key, value] of Object.entries(group)) {
        // Skip attributes and special elements
        if (key.startsWith('@_') || key === 'Condition') {
          continue;
        }

        // Handle property values
        if (typeof value === 'string') {
          properties[key] = value;
        } else if (typeof value === 'boolean' || typeof value === 'number') {
          // Convert booleans and numbers to strings
          properties[key] = String(value);
        } else if (typeof value === 'object' && value !== null) {
          // Property might have attributes or nested content
          const textValue = (value as any)['#text'] || JSON.stringify(value);
          properties[key] = textValue;
        }
      }

      return {
        condition,
        properties,
      };
    });
  }

  /**
   * Extracts TargetFramework and TargetFrameworks from PropertyGroups
   */
  private static extractTargetFrameworks(propertyGroups: PropertyGroup[]): {
    targetFramework?: string;
    targetFrameworks?: string[];
  } {
    let targetFramework: string | undefined;
    let targetFrameworks: string[] | undefined;

    // Look through all property groups (unconditional ones first)
    for (const group of propertyGroups) {
      // Prioritize unconditional PropertyGroups
      if (!group.condition) {
        if (group.properties.TargetFrameworks) {
          // Multi-targeting
          const value = group.properties.TargetFrameworks;
          targetFrameworks = value.split(';').map((f) => f.trim()).filter(Boolean);
        }

        if (group.properties.TargetFramework) {
          // Single target
          targetFramework = group.properties.TargetFramework;
        }
      }
    }

    // If no unconditional TFM found, look in conditional ones
    // (we'll return all of them for the resolver to handle)
    if (!targetFramework && !targetFrameworks) {
      for (const group of propertyGroups) {
        if (group.condition) {
          if (group.properties.TargetFrameworks) {
            const value = group.properties.TargetFrameworks;
            targetFrameworks = value.split(';').map((f) => f.trim()).filter(Boolean);
            break;
          }

          if (group.properties.TargetFramework) {
            targetFramework = group.properties.TargetFramework;
            break;
          }
        }
      }
    }

    return { targetFramework, targetFrameworks };
  }

  /**
   * Gets all TFMs from a parsed csproj (handles both single and multi-targeting)
   */
  public static getAllTargetFrameworks(parsed: ParsedCsproj): string[] {
    if (parsed.targetFrameworks && parsed.targetFrameworks.length > 0) {
      return parsed.targetFrameworks;
    }

    if (parsed.targetFramework) {
      return [parsed.targetFramework];
    }

    return [];
  }

  /**
   * Checks if a project is multi-targeting
   */
  public static isMultiTargeting(parsed: ParsedCsproj): boolean {
    return (parsed.targetFrameworks?.length ?? 0) > 1;
  }
}
