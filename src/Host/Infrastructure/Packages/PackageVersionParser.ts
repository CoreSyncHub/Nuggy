import * as fs from 'fs';
import { XMLParser } from 'fast-xml-parser';
import { PackageVersion } from '../../Domain/Packages/Entities/PackageVersion';
import { PackageIdentity } from '../../Domain/Packages/ValueObjects/PackageIdentity';

/**
 * Parser for extracting PackageVersion entries from Directory.Packages.props
 */
export class PackageVersionParser {
  private static xmlParser = new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: '@_',
    parseAttributeValue: false,
    trimValues: true,
  });

  /**
   * Parses a Directory.Packages.props file and extracts all PackageVersion entries
   */
  public static parse(filePath: string): PackageVersion[] {
    const content = fs.readFileSync(filePath, 'utf-8');
    const parsed = this.xmlParser.parse(content);

    if (!parsed.Project) {
      return [];
    }

    const project = parsed.Project;
    const packageVersions: PackageVersion[] = [];

    // Look for ItemGroup elements
    if (!project.ItemGroup) {
      return [];
    }

    const itemGroups = Array.isArray(project.ItemGroup)
      ? project.ItemGroup
      : [project.ItemGroup];

    for (const itemGroup of itemGroups) {
      // Extract PackageVersion elements
      if (itemGroup.PackageVersion) {
        const packageVersionElements = Array.isArray(itemGroup.PackageVersion)
          ? itemGroup.PackageVersion
          : [itemGroup.PackageVersion];

        for (const element of packageVersionElements) {
          const name = element['@_Include'];
          const version = element['@_Version'];

          if (name) {
            const identity = new PackageIdentity(name, version);
            packageVersions.push(new PackageVersion(identity, filePath));
          }
        }
      }
    }

    return packageVersions;
  }

  /**
   * Checks if a file has ManagePackageVersionsCentrally enabled
   */
  public static isCpmEnabled(filePath: string): boolean {
    try {
      const content = fs.readFileSync(filePath, 'utf-8');
      const parsed = this.xmlParser.parse(content);

      if (!parsed.Project || !parsed.Project.PropertyGroup) {
        return false;
      }

      const propertyGroups = Array.isArray(parsed.Project.PropertyGroup)
        ? parsed.Project.PropertyGroup
        : [parsed.Project.PropertyGroup];

      for (const group of propertyGroups) {
        const managePackageVersionsCentrally = group['ManagePackageVersionsCentrally'];
        if (
          managePackageVersionsCentrally &&
          managePackageVersionsCentrally.toString().toLowerCase() === 'true'
        ) {
          return true;
        }
      }

      return false;
    } catch {
      return false;
    }
  }
}
