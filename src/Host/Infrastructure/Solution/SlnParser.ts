import * as fs from "fs";
import * as path from "path";
import { singleton } from "tsyringe";
import { SolutionFolder, SolutionProject } from "../../Domain/Solutions/Entities/SolutionFolder";
import { SolutionItemId } from "../../Domain/Solutions/ValueObjects/SolutionItemId";

/**
 * Project type GUIDs used in .sln files
 */
export const ProjectTypeGuids = {
  SolutionFolder: "{2150E333-8FDC-42A3-9474-1A3956D46DE8}",
  CSharpProject: "{FAE04EC0-301F-11D3-BF4B-00C04F79EFBC}",
  CSharpSdkProject: "{9A19103F-16F7-4668-BE54-9A1E7A4F7556}",
  FSharpProject: "{F2A71F9B-5D33-465A-A702-920D77279786}",
  VBNetProject: "{F184B08F-C81C-45F6-A57F-5ABD9991F28F}",
  WebProject: "{E24C65DC-7377-472B-9ABA-BC803B73C61A}",
  WebApplicationProject: "{603C0E0B-DB56-11DC-BE95-000D561079B0}",
};

interface SlnProjectEntry {
  typeGuid: string;
  name: string;
  path: string;
  guid: string;
}

interface SlnNestedProject {
  childGuid: string;
  parentGuid: string;
}

/**
 * Parser for classic .sln (Visual Studio Solution) files
 */
@singleton()
export class SlnParser {
  /**
   * Parses a .sln file and returns the hierarchical structure
   */
  public parse(solutionPath: string): {
    projects: SolutionProject[];
    folders: SolutionFolder[];
    rootItems: (SolutionFolder | SolutionProject)[];
  } {
    const content = fs.readFileSync(solutionPath, "utf-8");
    const solutionDir = path.dirname(solutionPath);

    const projectEntries = this.extractProjectEntries(content);
    const nestedProjects = this.extractNestedProjects(content);

    return this.buildHierarchy(projectEntries, nestedProjects, solutionDir);
  }

  private extractProjectEntries(content: string): SlnProjectEntry[] {
    const entries: SlnProjectEntry[] = [];
    const projectRegex =
      /Project\("({[^}]+})"\)\s*=\s*"([^"]+)"\s*,\s*"([^"]+)"\s*,\s*"({[^}]+})"/g;

    let match;
    while ((match = projectRegex.exec(content)) !== null) {
      entries.push({
        typeGuid: match[1].toUpperCase(),
        name: match[2],
        path: match[3],
        guid: match[4].toUpperCase(),
      });
    }

    return entries;
  }

  private extractNestedProjects(content: string): SlnNestedProject[] {
    const nested: SlnNestedProject[] = [];

    const nestedSectionRegex =
      /GlobalSection\(NestedProjects\)\s*=\s*preSolution([\s\S]*?)EndGlobalSection/;
    const nestedMatch = nestedSectionRegex.exec(content);

    if (nestedMatch) {
      const nestedContent = nestedMatch[1];
      const nestedRegex = /({[^}]+})\s*=\s*({[^}]+})/g;

      let match;
      while ((match = nestedRegex.exec(nestedContent)) !== null) {
        nested.push({
          childGuid: match[1].toUpperCase(),
          parentGuid: match[2].toUpperCase(),
        });
      }
    }

    return nested;
  }

  private buildHierarchy(
    projectEntries: SlnProjectEntry[],
    nestedProjects: SlnNestedProject[],
    solutionDir: string,
  ): {
    projects: SolutionProject[];
    folders: SolutionFolder[];
    rootItems: (SolutionFolder | SolutionProject)[];
  } {
    const foldersMap = new Map<string, SolutionFolder>();
    const projectsMap = new Map<string, SolutionProject>();

    for (const entry of projectEntries) {
      const id = SolutionItemId.fromGuid(entry.guid);

      if (entry.typeGuid === ProjectTypeGuids.SolutionFolder) {
        const folder = new SolutionFolder(id, entry.name);
        foldersMap.set(entry.guid, folder);
      } else {
        const normalizedPath = entry.path.replace(/\\/g, path.sep);
        const projectPath = path.isAbsolute(normalizedPath)
          ? normalizedPath
          : path.join(solutionDir, normalizedPath);

        const project = new SolutionProject(id, entry.name, projectPath, entry.typeGuid);
        projectsMap.set(entry.guid, project);
      }
    }

    for (const nested of nestedProjects) {
      const parentFolder = foldersMap.get(nested.parentGuid);
      if (!parentFolder) {
        continue;
      }

      const childFolder = foldersMap.get(nested.childGuid);
      const childProject = projectsMap.get(nested.childGuid);

      if (childFolder) {
        childFolder.parentId = parentFolder.id;
        parentFolder.addChild(childFolder);
      } else if (childProject) {
        childProject.parentId = parentFolder.id;
        parentFolder.addChild(childProject);
      }
    }

    const rootItems: (SolutionFolder | SolutionProject)[] = [];

    for (const folder of foldersMap.values()) {
      if (!folder.parentId) {
        rootItems.push(folder);
      }
    }

    for (const project of projectsMap.values()) {
      if (!project.parentId) {
        rootItems.push(project);
      }
    }

    return {
      projects: Array.from(projectsMap.values()),
      folders: Array.from(foldersMap.values()),
      rootItems,
    };
  }

  /**
   * Checks if a file is a valid .sln file
   */
  public isValidSlnFile(filePath: string): boolean {
    if (!fs.existsSync(filePath)) {
      return false;
    }

    if (!filePath.toLowerCase().endsWith(".sln")) {
      return false;
    }

    try {
      const content = fs.readFileSync(filePath, "utf-8");
      return content.includes("Microsoft Visual Studio Solution File");
    } catch {
      return false;
    }
  }
}
