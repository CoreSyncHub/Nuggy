import * as fs from "fs";
import * as path from "path";
import { XMLParser } from "fast-xml-parser";
import { singleton } from "tsyringe";
import { SolutionFolder, SolutionProject } from "../../Domain/Solutions/Entities/SolutionFolder";
import { SolutionItemId } from "../../Domain/Solutions/ValueObjects/SolutionItemId";

interface SlnxProject {
  "@_Path": string;
  "@_Type"?: string;
}

interface SlnxFolder {
  "@_Name": string;
  Project?: SlnxProject | SlnxProject[];
  Folder?: SlnxFolder | SlnxFolder[];
}

interface SlnxRoot {
  Solution?: {
    Project?: SlnxProject | SlnxProject[];
    Folder?: SlnxFolder | SlnxFolder[];
  };
}

/**
 * Parser for .slnx (XML-based Visual Studio Solution) files
 */
@singleton()
export class SlnxParser {
  private readonly xmlParser = new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: "@_",
    parseAttributeValue: false,
  });

  /**
   * Parses a .slnx file and returns the hierarchical structure
   */
  public parse(solutionPath: string): {
    projects: SolutionProject[];
    folders: SolutionFolder[];
    rootItems: (SolutionFolder | SolutionProject)[];
  } {
    const content = fs.readFileSync(solutionPath, "utf-8");
    const solutionDir = path.dirname(solutionPath);

    const parsed = this.xmlParser.parse(content) as SlnxRoot;

    const allProjects: SolutionProject[] = [];
    const allFolders: SolutionFolder[] = [];
    const rootItems: (SolutionFolder | SolutionProject)[] = [];

    if (!parsed.Solution) {
      return { projects: [], folders: [], rootItems: [] };
    }

    if (parsed.Solution.Project) {
      const projects = Array.isArray(parsed.Solution.Project)
        ? parsed.Solution.Project
        : [parsed.Solution.Project];

      for (const proj of projects) {
        const project = this.createProjectFromXml(proj, solutionDir, null);
        allProjects.push(project);
        rootItems.push(project);
      }
    }

    if (parsed.Solution.Folder) {
      const folders = Array.isArray(parsed.Solution.Folder)
        ? parsed.Solution.Folder
        : [parsed.Solution.Folder];

      for (const folderXml of folders) {
        const { folder, projects, subFolders } = this.processFolderRecursive(
          folderXml,
          solutionDir,
          null,
        );
        allFolders.push(folder, ...subFolders);
        allProjects.push(...projects);
        rootItems.push(folder);
      }
    }

    return {
      projects: allProjects,
      folders: allFolders,
      rootItems,
    };
  }

  private createProjectFromXml(
    projectXml: SlnxProject,
    solutionDir: string,
    parentId: SolutionItemId | null,
  ): SolutionProject {
    const projectPath = projectXml["@_Path"];
    const projectType = projectXml["@_Type"] ?? null;

    const normalizedPath = projectPath.replace(/\\/g, path.sep);
    const id = SolutionItemId.fromPath(normalizedPath);
    const projectName = path.basename(normalizedPath, path.extname(normalizedPath));
    const absolutePath = path.isAbsolute(normalizedPath)
      ? normalizedPath
      : path.join(solutionDir, normalizedPath);

    return new SolutionProject(id, projectName, absolutePath, projectType, parentId);
  }

  private processFolderRecursive(
    folderXml: SlnxFolder,
    solutionDir: string,
    parentId: SolutionItemId | null,
  ): {
    folder: SolutionFolder;
    projects: SolutionProject[];
    subFolders: SolutionFolder[];
  } {
    const folderName = folderXml["@_Name"];

    const folderId = parentId
      ? SolutionItemId.fromPath(`${parentId.toString()}/${folderName}`)
      : SolutionItemId.fromPath(folderName);

    const folder = new SolutionFolder(folderId, folderName, parentId);

    const allProjects: SolutionProject[] = [];
    const allSubFolders: SolutionFolder[] = [];

    if (folderXml.Project) {
      const projects = Array.isArray(folderXml.Project) ? folderXml.Project : [folderXml.Project];

      for (const proj of projects) {
        const project = this.createProjectFromXml(proj, solutionDir, folderId);
        folder.addChild(project);
        allProjects.push(project);
      }
    }

    if (folderXml.Folder) {
      const subFolders = Array.isArray(folderXml.Folder) ? folderXml.Folder : [folderXml.Folder];

      for (const subFolderXml of subFolders) {
        const result = this.processFolderRecursive(subFolderXml, solutionDir, folderId);
        folder.addChild(result.folder);
        allSubFolders.push(result.folder, ...result.subFolders);
        allProjects.push(...result.projects);
      }
    }

    return {
      folder,
      projects: allProjects,
      subFolders: allSubFolders,
    };
  }

  /**
   * Checks if a file is a valid .slnx file
   */
  public isValidSlnxFile(filePath: string): boolean {
    if (!fs.existsSync(filePath)) {
      return false;
    }

    if (!filePath.toLowerCase().endsWith(".slnx")) {
      return false;
    }

    try {
      const content = fs.readFileSync(filePath, "utf-8");
      const parsed = this.xmlParser.parse(content) as SlnxRoot;
      return !!parsed.Solution;
    } catch {
      return false;
    }
  }
}
