import * as fs from 'fs';
import { XMLParser } from 'fast-xml-parser';
import { PackageReference } from '../../Domain/Packages/Entities/PackageReference';
import { PackageIdentity } from '../../Domain/Packages/ValueObjects/PackageIdentity';

/**
 * Parser for extracting PackageReference entries from .csproj files
 */
export class PackageReferenceParser {
  private static xmlParser = new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: '@_',
    parseAttributeValue: false,
    trimValues: true,
  });

  /**
   * Parses a .csproj file and extracts all PackageReference entries
   */
  public static parse(csprojPath: string): PackageReference[] {
    const content = fs.readFileSync(csprojPath, 'utf-8');
    const parsed = this.xmlParser.parse(content);

    if (!parsed.Project) {
      return [];
    }

    const project = parsed.Project;
    const packageReferences: PackageReference[] = [];

    // Look for ItemGroup elements
    if (!project.ItemGroup) {
      return [];
    }

    const itemGroups = Array.isArray(project.ItemGroup)
      ? project.ItemGroup
      : [project.ItemGroup];

    for (const itemGroup of itemGroups) {
      // Extract PackageReference elements
      if (itemGroup.PackageReference) {
        const packageReferenceElements = Array.isArray(itemGroup.PackageReference)
          ? itemGroup.PackageReference
          : [itemGroup.PackageReference];

        for (const element of packageReferenceElements) {
          const name = element['@_Include'];
          const version = element['@_Version'];

          if (name) {
            const identity = new PackageIdentity(name, version);
            const hasLocalVersion = version !== undefined;
            packageReferences.push(new PackageReference(identity, csprojPath, hasLocalVersion));
          }
        }
      }
    }

    return packageReferences;
  }

  /**
   * Parses multiple .csproj files and returns all package references
   */
  public static parseMultiple(csprojPaths: string[]): Map<string, PackageReference[]> {
    const results = new Map<string, PackageReference[]>();

    for (const csprojPath of csprojPaths) {
      try {
        const references = this.parse(csprojPath);
        results.set(csprojPath, references);
      } catch (error) {
        console.error(`Failed to parse package references from ${csprojPath}:`, error);
        results.set(csprojPath, []);
      }
    }

    return results;
  }
}
