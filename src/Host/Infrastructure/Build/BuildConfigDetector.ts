import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { BuildConfigFile } from '../../Domain/Build/Entities/BuildConfigFile';
import { BuildConfigFileType } from '../../Domain/Build/Enums/BuildConfigFileType';

/**
 * Service responsible for detecting and organizing MSBuild configuration files
 * Handles Directory.Build.props, Directory.Build.targets, and Directory.Packages.props
 */
export class BuildConfigDetector {
  /**
   * Finds all MSBuild configuration files in the workspace
   */
  public static async findAllConfigFiles(): Promise<BuildConfigFile[]> {
    const workspaceFolders = vscode.workspace.workspaceFolders;
    if (!workspaceFolders || workspaceFolders.length === 0) {
      return [];
    }

    const configFiles: BuildConfigFile[] = [];

    // Search for Directory.Build.props
    const propsFiles = await vscode.workspace.findFiles(
      '**/Directory.Build.props',
      '**/node_modules/**'
    );

    for (const uri of propsFiles) {
      const file = new BuildConfigFile(
        uri.fsPath,
        BuildConfigFileType.DirectoryBuildProps,
        path.dirname(uri.fsPath)
      );
      configFiles.push(file);
    }

    // Search for Directory.Build.targets
    const targetsFiles = await vscode.workspace.findFiles(
      '**/Directory.Build.targets',
      '**/node_modules/**'
    );

    for (const uri of targetsFiles) {
      const file = new BuildConfigFile(
        uri.fsPath,
        BuildConfigFileType.DirectoryBuildTargets,
        path.dirname(uri.fsPath)
      );
      configFiles.push(file);
    }

    // Search for Directory.Packages.props (CPM)
    const packagesPropsFiles = await vscode.workspace.findFiles(
      '**/Directory.Packages.props',
      '**/node_modules/**'
    );

    for (const uri of packagesPropsFiles) {
      const file = new BuildConfigFile(
        uri.fsPath,
        BuildConfigFileType.DirectoryPackagesProps,
        path.dirname(uri.fsPath)
      );
      configFiles.push(file);
    }

    return configFiles;
  }

  /**
   * Builds the hierarchical relationship between configuration files
   * MSBuild searches for these files up the directory tree from the project location
   */
  public static buildHierarchy(configFiles: BuildConfigFile[]): BuildConfigFile[] {
    // Group files by type
    const filesByType = new Map<BuildConfigFileType, BuildConfigFile[]>();

    for (const file of configFiles) {
      if (!filesByType.has(file.type)) {
        filesByType.set(file.type, []);
      }
      filesByType.get(file.type)!.push(file);
    }

    // For each type, establish parent-child relationships
    for (const [type, files] of filesByType) {
      // Sort by directory depth (deeper directories first)
      const sortedFiles = files.sort((a, b) => {
        const depthA = a.directory.split(path.sep).length;
        const depthB = b.directory.split(path.sep).length;
        return depthB - depthA; // Descending order (deepest first)
      });

      // For each file, find its parent (closest ancestor directory with the same type)
      for (const file of sortedFiles) {
        const parent = this.findParentConfigFile(file, sortedFiles);
        if (parent) {
          file.parent = parent;
          parent.addChild(file);
        }
      }
    }

    return configFiles;
  }

  /**
   * Finds the parent configuration file for a given file
   * The parent is the closest ancestor directory containing the same type of config file
   */
  private static findParentConfigFile(
    file: BuildConfigFile,
    allFiles: BuildConfigFile[]
  ): BuildConfigFile | null {
    const fileDir = file.directory;

    // Look for parent directories
    let currentDir = path.dirname(fileDir);

    while (currentDir && currentDir !== path.parse(currentDir).root) {
      // Find a config file in this directory
      const parentFile = allFiles.find(
        (f) => f !== file && f.directory === currentDir && f.type === file.type
      );

      if (parentFile) {
        return parentFile;
      }

      currentDir = path.dirname(currentDir);
    }

    // Check root directory as well
    const rootFile = allFiles.find(
      (f) =>
        f !== file &&
        f.directory === path.parse(fileDir).root &&
        f.type === file.type
    );

    return rootFile || null;
  }

  /**
   * Maps which projects are affected by which configuration files
   * MSBuild automatically imports the closest Directory.Build.props/targets
   */
  public static async mapAffectedProjects(
    configFiles: BuildConfigFile[],
    projectPaths: string[]
  ): Promise<void> {
    for (const projectPath of projectPaths) {
      const projectDir = path.dirname(projectPath);

      // For each type of config file, find the one that affects this project
      const types = [
        BuildConfigFileType.DirectoryBuildProps,
        BuildConfigFileType.DirectoryBuildTargets,
        BuildConfigFileType.DirectoryPackagesProps,
      ];

      for (const type of types) {
        const affectingFile = this.findAffectingConfigFile(
          projectDir,
          configFiles,
          type
        );

        if (affectingFile) {
          affectingFile.addAffectedProject(projectPath);
        }
      }
    }
  }

  /**
   * Finds the configuration file that affects a given project
   * MSBuild searches up the directory tree for the nearest file
   */
  private static findAffectingConfigFile(
    projectDir: string,
    configFiles: BuildConfigFile[],
    type: BuildConfigFileType
  ): BuildConfigFile | null {
    const filesOfType = configFiles.filter((f) => f.type === type);

    let currentDir = projectDir;

    while (currentDir && currentDir !== path.parse(currentDir).root) {
      // Check if there's a config file in this directory
      const file = filesOfType.find((f) => f.directory === currentDir);
      if (file) {
        return file;
      }

      currentDir = path.dirname(currentDir);
    }

    // Check root directory
    const rootFile = filesOfType.find(
      (f) => f.directory === path.parse(projectDir).root
    );

    return rootFile || null;
  }

  /**
   * Gets root-level configuration files (files without parents)
   */
  public static getRootFiles(configFiles: BuildConfigFile[]): BuildConfigFile[] {
    return configFiles.filter((f) => !f.parent);
  }

  /**
   * Checks if Central Package Management is enabled in the solution
   */
  public static isCpmEnabled(configFiles: BuildConfigFile[]): boolean {
    return configFiles.some((f) => f.isCentralPackageManagement());
  }

  /**
   * Gets the CPM file (Directory.Packages.props) if it exists
   */
  public static getCpmFile(configFiles: BuildConfigFile[]): BuildConfigFile | null {
    return (
      configFiles.find((f) => f.type === BuildConfigFileType.DirectoryPackagesProps) ||
      null
    );
  }
}
