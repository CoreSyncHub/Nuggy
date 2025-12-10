import * as vscode from 'vscode';
import * as path from 'path';
import { SlnParser } from './SlnParser';
import { SlnxParser } from './SlnxParser';

/**
 * Represents a detected solution file in the workspace
 */
export interface DetectedSolution {
  /** Absolute path to the solution file */
  path: string;

  /** Display name (filename without extension) */
  name: string;

  /** Format: 'sln' or 'slnx' */
  format: 'sln' | 'slnx';

  /** Workspace folder containing this solution */
  workspaceFolder: vscode.WorkspaceFolder;
}

/**
 * Service responsible for detecting solution files in the workspace
 */
export class SolutionDetector {
  /**
   * Finds all .sln and .slnx files in the current workspace
   */
  public static async findAllSolutions(): Promise<DetectedSolution[]> {
    const workspaceFolders = vscode.workspace.workspaceFolders;
    if (!workspaceFolders || workspaceFolders.length === 0) {
      return [];
    }

    const solutions: DetectedSolution[] = [];

    // Search for .sln files
    const slnFiles = await vscode.workspace.findFiles(
      '**/*.sln',
      '**/node_modules/**'
    );

    for (const uri of slnFiles) {
      if (SlnParser.isValidSlnFile(uri.fsPath)) {
        const workspaceFolder = vscode.workspace.getWorkspaceFolder(uri);
        if (workspaceFolder) {
          solutions.push({
            path: uri.fsPath,
            name: path.basename(uri.fsPath, '.sln'),
            format: 'sln',
            workspaceFolder,
          });
        }
      }
    }

    // Search for .slnx files
    const slnxFiles = await vscode.workspace.findFiles(
      '**/*.slnx',
      '**/node_modules/**'
    );

    for (const uri of slnxFiles) {
      if (SlnxParser.isValidSlnxFile(uri.fsPath)) {
        const workspaceFolder = vscode.workspace.getWorkspaceFolder(uri);
        if (workspaceFolder) {
          solutions.push({
            path: uri.fsPath,
            name: path.basename(uri.fsPath, '.slnx'),
            format: 'slnx',
            workspaceFolder,
          });
        }
      }
    }

    // Sort by name for consistent ordering
    return solutions.sort((a, b) => a.name.localeCompare(b.name));
  }

  /**
   * Gets the selected solution from workspace settings
   */
  public static getSelectedSolution(): string | undefined {
    const config = vscode.workspace.getConfiguration('nuget-explorer');
    return config.get<string>('selectedSolution');
  }

  /**
   * Sets the selected solution in workspace settings
   */
  public static async setSelectedSolution(solutionPath: string): Promise<void> {
    const config = vscode.workspace.getConfiguration('nuget-explorer');
    await config.update(
      'selectedSolution',
      solutionPath,
      vscode.ConfigurationTarget.Workspace
    );
  }

  /**
   * Clears the selected solution from workspace settings
   */
  public static async clearSelectedSolution(): Promise<void> {
    const config = vscode.workspace.getConfiguration('nuget-explorer');
    await config.update(
      'selectedSolution',
      undefined,
      vscode.ConfigurationTarget.Workspace
    );
  }
}
