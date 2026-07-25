import * as fs from "fs";
import { XMLParser } from "fast-xml-parser";
import { singleton } from "tsyringe";
import { type ProjectSdkType } from "../../Domain/Projects/Enums/ProjectSdkType";

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
@singleton()
export class CsprojParser {
  private readonly xmlParser = new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: "@_",
    parseAttributeValue: false,
    trimValues: true,
  });

  /**
   * Parses a .csproj file
   */
  public parse(csprojPath: string): ParsedCsproj {
    const content = fs.readFileSync(csprojPath, "utf-8");
    const parsed = this.xmlParser.parse(content);

    if (!parsed.Project) {
      throw new Error(`Invalid .csproj file: ${csprojPath}`);
    }

    const project = parsed.Project;

    const sdkType = this.determineSdkType(project);
    const sdk = project["@_Sdk"];

    const propertyGroups = this.extractPropertyGroups(project);
    const tfmInfo = this.extractTargetFrameworks(propertyGroups);

    return {
      sdkType,
      sdk,
      targetFramework: tfmInfo.targetFramework,
      targetFrameworks: tfmInfo.targetFrameworks,
      propertyGroups,
    };
  }

  private determineSdkType(project: any): ProjectSdkType {
    if (project["@_Sdk"]) {
      return "SDK-Style";
    }

    if (project["@_ToolsVersion"] || project["@_DefaultTargets"]) {
      return "Legacy";
    }

    return "Unknown";
  }

  private extractPropertyGroups(project: any): PropertyGroup[] {
    if (!project.PropertyGroup) {
      return [];
    }

    const groups = Array.isArray(project.PropertyGroup)
      ? project.PropertyGroup
      : [project.PropertyGroup];

    return groups.map((group: any) => {
      const condition = group["@_Condition"];
      const properties: Record<string, string> = {};

      for (const [key, value] of Object.entries(group)) {
        if (key.startsWith("@_") || key === "Condition") {
          continue;
        }

        if (typeof value === "string") {
          properties[key] = value;
        } else if (typeof value === "boolean" || typeof value === "number") {
          properties[key] = String(value);
        } else if (typeof value === "object" && value !== null) {
          const textValue = (value as any)["#text"] || JSON.stringify(value);
          properties[key] = textValue;
        }
      }

      return {
        condition,
        properties,
      };
    });
  }

  private extractTargetFrameworks(propertyGroups: PropertyGroup[]): {
    targetFramework?: string;
    targetFrameworks?: string[];
  } {
    let targetFramework: string | undefined;
    let targetFrameworks: string[] | undefined;

    for (const group of propertyGroups) {
      if (!group.condition) {
        if (group.properties.TargetFrameworks) {
          const value = group.properties.TargetFrameworks;
          targetFrameworks = value
            .split(";")
            .map((f) => f.trim())
            .filter(Boolean);
        }

        if (group.properties.TargetFramework) {
          targetFramework = group.properties.TargetFramework;
        }

        if (group.properties.TargetFrameworkVersion) {
          const legacyVersion = group.properties.TargetFrameworkVersion;
          targetFramework = this.convertLegacyFrameworkVersion(legacyVersion);
        }
      }
    }

    if (!targetFramework && !targetFrameworks) {
      for (const group of propertyGroups) {
        if (group.condition) {
          if (group.properties.TargetFrameworks) {
            const value = group.properties.TargetFrameworks;
            targetFrameworks = value
              .split(";")
              .map((f) => f.trim())
              .filter(Boolean);
            break;
          }

          if (group.properties.TargetFramework) {
            targetFramework = group.properties.TargetFramework;
            break;
          }

          if (group.properties.TargetFrameworkVersion) {
            const legacyVersion = group.properties.TargetFrameworkVersion;
            targetFramework = this.convertLegacyFrameworkVersion(legacyVersion);
            break;
          }
        }
      }
    }

    return { targetFramework, targetFrameworks };
  }

  private convertLegacyFrameworkVersion(legacyVersion: string): string {
    const version = legacyVersion.replace(/^v/, "");
    const tfmNumber = version.replace(/\./g, "");
    return `net${tfmNumber}`;
  }

  /**
   * Gets all TFMs from a parsed csproj (handles both single and multi-targeting)
   */
  public getAllTargetFrameworks(parsed: ParsedCsproj): string[] {
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
  public isMultiTargeting(parsed: ParsedCsproj): boolean {
    return (parsed.targetFrameworks?.length ?? 0) > 1;
  }
}
