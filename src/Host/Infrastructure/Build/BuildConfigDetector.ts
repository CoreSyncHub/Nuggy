import * as vscode from 'vscode';
import * as path from 'path';
import { singleton } from 'tsyringe';
import { BuildConfigFile } from '../../Domain/Build/Entities/BuildConfigFile';
import { BuildConfigFileType } from '../../Domain/Build/Enums/BuildConfigFileType';

/**
 * Service responsible for detecting and organizing MSBuild configuration files
 */
@singleton()
export class BuildConfigDetector {
  /**
   * Finds all MSBuild configuration files in the workspace
   */
  public async findAllConfigFiles(): Promise<BuildConfigFile[]> {
    const workspaceFolders = vscode.workspace.workspaceFolders;
    if (!workspaceFolders || workspaceFolders.length === 0) {
      return [];
    }

    const configFiles: BuildConfigFile[] = [];

    const propsFiles = await vscode.workspace.findFiles(
      '**/Directory.Build.props',
      '**/node_modules/**'
    );

    for (const uri of propsFiles) {
      configFiles.push(
        new BuildConfigFile(uri.fsPath, BuildConfigFileType.DirectoryBuildProps, path.dirname(uri.fsPath))
      );
    }

    const targetsFiles = await vscode.workspace.findFiles(
      '**/Directory.Build.targets',
      '**/node_modules/**'
    );

    for (const uri of targetsFiles) {
      configFiles.push(
        new BuildConfigFile(uri.fsPath, BuildConfigFileType.DirectoryBuildTargets, path.dirname(uri.fsPath))
      );
    }

    const packagesPropsFiles = await vscode.workspace.findFiles(
      '**/Directory.Packages.props',
      '**/node_modules/**'
    );

    for (const uri of packagesPropsFiles) {
      configFiles.push(
        new BuildConfigFile(uri.fsPath, BuildConfigFileType.DirectoryPackagesProps, path.dirname(uri.fsPath))
      );
    }

    return configFiles;
  }

  /**
   * Builds the hierarchical relationship between configuration files
   */
  public buildHierarchy(configFiles: BuildConfigFile[]): BuildConfigFile[] {
    const filesByType = new Map<BuildConfigFileType, BuildConfigFile[]>();

    for (const file of configFiles) {
      if (!filesByType.has(file.type)) {
        filesByType.set(file.type, []);
      }
      filesByType.get(file.type)!.push(file);
    }

    for (const [, files] of filesByType) {
      const sortedFiles = files.sort((a, b) => {
        const depthA = a.directory.split(path.sep).length;
        const depthB = b.directory.split(path.sep).length;
        return depthB - depthA;
      });

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

  private findParentConfigFile(
    file: BuildConfigFile,
    allFiles: BuildConfigFile[]
  ): BuildConfigFile | null {
    const fileDir = file.directory;
    let currentDir = path.dirname(fileDir);

    while (currentDir && currentDir !== path.parse(currentDir).root) {
      const parentFile = allFiles.find(
        (f) => f !== file && f.directory === currentDir && f.type === file.type
      );

      if (parentFile) {
        return parentFile;
      }

      const parentDir = path.dirname(currentDir);
      if (parentDir === currentDir) { break; }
      currentDir = parentDir;
    }

    const rootFile = allFiles.find(
      (f) => f !== file && f.directory === path.parse(fileDir).root && f.type === file.type
    );

    return rootFile || null;
  }

  /**
   * Maps which projects are affected by which configuration files
   */
  public async mapAffectedProjects(
    configFiles: BuildConfigFile[],
    projectPaths: string[]
  ): Promise<void> {
    for (const projectPath of projectPaths) {
      const projectDir = path.dirname(projectPath);

      const types = [
        BuildConfigFileType.DirectoryBuildProps,
        BuildConfigFileType.DirectoryBuildTargets,
        BuildConfigFileType.DirectoryPackagesProps,
      ];

      for (const type of types) {
        const affectingFile = this.findAffectingConfigFile(projectDir, configFiles, type);

        if (affectingFile) {
          affectingFile.addAffectedProject(projectPath);
        }
      }
    }
  }

  private findAffectingConfigFile(
    projectDir: string,
    configFiles: BuildConfigFile[],
    type: BuildConfigFileType
  ): BuildConfigFile | null {
    const filesOfType = configFiles.filter((f) => f.type === type);

    let currentDir = projectDir;

    while (currentDir && currentDir !== path.parse(currentDir).root) {
      const file = filesOfType.find((f) => f.directory === currentDir);
      if (file) {
        return file;
      }

      const parentDir = path.dirname(currentDir);
      if (parentDir === currentDir) { break; }
      currentDir = parentDir;
    }

    const rootFile = filesOfType.find((f) => f.directory === path.parse(projectDir).root);

    return rootFile || null;
  }

  /**
   * Gets root-level configuration files (files without parents)
   */
  public getRootFiles(configFiles: BuildConfigFile[]): BuildConfigFile[] {
    return configFiles.filter((f) => !f.parent);
  }

  /**
   * Checks if Central Package Management is enabled in the solution
   */
  public isCpmEnabled(configFiles: BuildConfigFile[]): boolean {
    return configFiles.some((f) => f.isCentralPackageManagement());
  }

  /**
   * Gets the CPM file (Directory.Packages.props) if it exists
   */
  public getCpmFile(configFiles: BuildConfigFile[]): BuildConfigFile | null {
    return configFiles.find((f) => f.type === BuildConfigFileType.DirectoryPackagesProps) || null;
  }
}
