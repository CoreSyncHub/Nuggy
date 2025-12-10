import * as fs from 'fs';
import * as path from 'path';
import { XMLParser } from 'fast-xml-parser';
import { SolutionFolder, SolutionProject } from '../../Domain/Solutions/Entities/SolutionFolder';
import { SolutionItemId } from '../../Domain/Solutions/ValueObjects/SolutionItemId';

/**
 * Represents a project entry in .slnx format
 */
interface SlnxProject {
  '@_Path': string;
  '@_Type'?: string;
}

/**
 * Represents a folder entry in .slnx format
 */
interface SlnxFolder {
  '@_Name': string;
  Project?: SlnxProject | SlnxProject[];
  Folder?: SlnxFolder | SlnxFolder[];
}

/**
 * Root structure of .slnx XML
 */
interface SlnxRoot {
  Solution?: {
    Project?: SlnxProject | SlnxProject[];
    Folder?: SlnxFolder | SlnxFolder[];
  };
}

/**
 * Parser for .slnx (XML-based Visual Studio Solution) files
 */
export class SlnxParser {
  private static xmlParser = new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: '@_',
    parseAttributeValue: false,
  });

  /**
   * Parses a .slnx file and returns the hierarchical structure
   */
  public static parse(solutionPath: string): {
    projects: SolutionProject[];
    folders: SolutionFolder[];
    rootItems: (SolutionFolder | SolutionProject)[];
  } {
    const content = fs.readFileSync(solutionPath, 'utf-8');
    const solutionDir = path.dirname(solutionPath);

    const parsed = this.xmlParser.parse(content) as SlnxRoot;

    const allProjects: SolutionProject[] = [];
    const allFolders: SolutionFolder[] = [];
    const rootItems: (SolutionFolder | SolutionProject)[] = [];

    if (!parsed.Solution) {
      return { projects: [], folders: [], rootItems: [] };
    }

    // Process root-level projects
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

    // Process root-level folders
    if (parsed.Solution.Folder) {
      const folders = Array.isArray(parsed.Solution.Folder)
        ? parsed.Solution.Folder
        : [parsed.Solution.Folder];

      for (const folderXml of folders) {
        const { folder, projects, subFolders } = this.processFolderRecursive(
          folderXml,
          solutionDir,
          null
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

  /**
   * Creates a SolutionProject from XML data
   */
  private static createProjectFromXml(
    projectXml: SlnxProject,
    solutionDir: string,
    parentId: SolutionItemId | null
  ): SolutionProject {
    const projectPath = projectXml['@_Path'];
    const projectType = projectXml['@_Type'] ?? null;

    // In .slnx, the path IS the identifier
    const id = SolutionItemId.fromPath(projectPath);

    // Extract project name from path
    const projectName = path.basename(projectPath, path.extname(projectPath));

    // Resolve absolute path
    const absolutePath = path.isAbsolute(projectPath)
      ? projectPath
      : path.join(solutionDir, projectPath);

    return new SolutionProject(id, projectName, absolutePath, projectType, parentId);
  }

  /**
   * Processes a folder and its children recursively
   */
  private static processFolderRecursive(
    folderXml: SlnxFolder,
    solutionDir: string,
    parentId: SolutionItemId | null
  ): {
    folder: SolutionFolder;
    projects: SolutionProject[];
    subFolders: SolutionFolder[];
  } {
    const folderName = folderXml['@_Name'];

    // In .slnx, folders use their name as identifier
    // To make it unique in nested scenarios, we use the full path
    const folderId = parentId
      ? SolutionItemId.fromPath(`${parentId.toString()}/${folderName}`)
      : SolutionItemId.fromPath(folderName);

    const folder = new SolutionFolder(folderId, folderName, parentId);

    const allProjects: SolutionProject[] = [];
    const allSubFolders: SolutionFolder[] = [];

    // Process projects within this folder
    if (folderXml.Project) {
      const projects = Array.isArray(folderXml.Project)
        ? folderXml.Project
        : [folderXml.Project];

      for (const proj of projects) {
        const project = this.createProjectFromXml(proj, solutionDir, folderId);
        folder.addChild(project);
        allProjects.push(project);
      }
    }

    // Process subfolders
    if (folderXml.Folder) {
      const subFolders = Array.isArray(folderXml.Folder)
        ? folderXml.Folder
        : [folderXml.Folder];

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
  public static isValidSlnxFile(filePath: string): boolean {
    if (!fs.existsSync(filePath)) {
      return false;
    }

    if (!filePath.toLowerCase().endsWith('.slnx')) {
      return false;
    }

    try {
      const content = fs.readFileSync(filePath, 'utf-8');
      const parsed = this.xmlParser.parse(content) as SlnxRoot;
      return !!parsed.Solution;
    } catch {
      return false;
    }
  }
}
