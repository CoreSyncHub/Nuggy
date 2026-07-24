import * as fs from 'fs';
import * as vscode from 'vscode';
import { GetBuildConfigurationFilesQueryHandler } from '../GetBuildConfigurationFilesQueryHandler';
import { GetBuildConfigurationFilesQuery } from '@Shared/Features/Queries/GetBuildConfigurationFilesQuery';
import { BuildConfigDetector } from '@Infrastructure/Build/BuildConfigDetector';
import { BuildConfigParser } from '@Infrastructure/Build/BuildConfigParser';
import { SlnParser } from '@Infrastructure/Solution/SlnParser';
import { SlnxParser } from '@Infrastructure/Solution/SlnxParser';
import { BuildConfigFileType } from '@Domain/Build/Enums/BuildConfigFileType';
import { ILogger } from '@/Host/Application/Abstractions/Log/ILogger';

// Mock dependencies
jest.mock('fs');
jest.mock('vscode', () => ({
  workspace: {
    workspaceFolders: [{ uri: { fsPath: '/Workspace' } }],
    findFiles: jest.fn(),
  },
  RelativePattern: jest.fn(),
  Uri: {
    file: jest.fn((path) => ({ fsPath: path })),
  },
}));

const mockFs = fs as jest.Mocked<typeof fs>;
const mockVscode = vscode as jest.Mocked<typeof vscode>;

const mockLogger: ILogger = {
  Info: jest.fn(),
  Warning: jest.fn(),
  Error: jest.fn(),
  Debug: jest.fn(),
};

describe('GetBuildConfigurationFilesQueryHandler', () => {
  let handler: GetBuildConfigurationFilesQueryHandler;

  beforeEach(() => {
    jest.clearAllMocks();
    handler = new GetBuildConfigurationFilesQueryHandler(
      new BuildConfigDetector(),
      new BuildConfigParser(mockLogger),
      new SlnParser(),
      new SlnxParser()
    );

    // Default mock for findFiles - return empty array
    mockVscode.workspace.findFiles = jest.fn().mockResolvedValue([]);
  });

  describe('Handle - with solutionPath', () => {
    it('should map affected projects when solutionPath is provided (.sln)', async () => {
      // Mock solution file content
      const slnContent = `Microsoft Visual Studio Solution File, Format Version 12.00
Project("{FAE04EC0-301F-11D3-BF4B-00C04F79EFBC}") = "Project1", "Project1\\Project1.csproj", "{GUID-1}"
EndProject
Project("{FAE04EC0-301F-11D3-BF4B-00C04F79EFBC}") = "Project2", "src\\Project2\\Project2.csproj", "{GUID-2}"
EndProject`;

      mockFs.readFileSync.mockReturnValue(slnContent);
      mockFs.existsSync.mockReturnValue(true);

      // Mock Directory.Build.props files
      const propsFileUri = { fsPath: '/Solution/Directory.Build.props' };
      mockVscode.workspace.findFiles = jest.fn().mockResolvedValue([propsFileUri]);

      const propsFileContent = `<Project>
  <PropertyGroup>
    <TargetFramework>net8.0</TargetFramework>
  </PropertyGroup>
</Project>`;

      mockFs.readFileSync.mockImplementation((path) => {
        if (path === '/Solution/test.sln') {
          return slnContent;
        }
        if (path === '/Solution/Directory.Build.props') {
          return propsFileContent;
        }
        return '';
      });

      const query = new GetBuildConfigurationFilesQuery('/Solution/test.sln');
      const result = await handler.Handle(query);

      // Should have found build config files
      expect(result.files.length).toBeGreaterThan(0);

      // The props file should have affected projects mapped
      const propsFile = result.files.find(
        (f) => f.type === BuildConfigFileType.DirectoryBuildProps
      );
      expect(propsFile).toBeDefined();
      expect(propsFile!.affectedProjects).toContain('/Solution/Project1/Project1.csproj');
      expect(propsFile!.affectedProjects).toContain('/Solution/src/Project2/Project2.csproj');
    });

    it('should map affected projects when solutionPath is provided (.slnx)', async () => {
      // Mock .slnx file content
      const slnxContent = `<?xml version="1.0" encoding="utf-8"?>
<Solution>
  <Project Path="Project1\\Project1.csproj" Type="C#" />
  <Project Path="src\\Project2\\Project2.csproj" Type="C#" />
</Solution>`;

      mockFs.readFileSync.mockReturnValue(slnxContent);
      mockFs.existsSync.mockReturnValue(true);

      // Mock Directory.Build.props files
      const propsFileUri = { fsPath: '/Solution/Directory.Build.props' };
      mockVscode.workspace.findFiles = jest.fn().mockResolvedValue([propsFileUri]);

      const propsFileContent = `<Project>
  <PropertyGroup>
    <TargetFramework>net8.0</TargetFramework>
  </PropertyGroup>
</Project>`;

      mockFs.readFileSync.mockImplementation((path) => {
        if (path === '/Solution/test.slnx') {
          return slnxContent;
        }
        if (path === '/Solution/Directory.Build.props') {
          return propsFileContent;
        }
        return '';
      });

      const query = new GetBuildConfigurationFilesQuery('/Solution/test.slnx');
      const result = await handler.Handle(query);

      // Should have found build config files
      expect(result.files.length).toBeGreaterThan(0);

      // The props file should have affected projects mapped
      const propsFile = result.files.find(
        (f) => f.type === BuildConfigFileType.DirectoryBuildProps
      );
      expect(propsFile).toBeDefined();
      expect(propsFile!.affectedProjects).toContain('/Solution/Project1/Project1.csproj');
      expect(propsFile!.affectedProjects).toContain('/Solution/src/Project2/Project2.csproj');
    });
  });

  describe('Handle - without solutionPath', () => {
    it('should not map affected projects when solutionPath is not provided', async () => {
      mockFs.existsSync.mockReturnValue(true);

      // Mock Directory.Build.props files
      const propsFileUri = { fsPath: '/Workspace/Directory.Build.props' };
      mockVscode.workspace.findFiles = jest.fn().mockResolvedValue([propsFileUri]);

      const propsFileContent = `<Project>
  <PropertyGroup>
    <TargetFramework>net8.0</TargetFramework>
  </PropertyGroup>
</Project>`;

      mockFs.readFileSync.mockReturnValue(propsFileContent);

      const query = new GetBuildConfigurationFilesQuery();
      const result = await handler.Handle(query);

      // Should have found build config files
      expect(result.files.length).toBeGreaterThan(0);

      // All files should NOT have affected projects (empty array)
      for (const file of result.files) {
        expect(file.affectedProjects).toEqual([]);
      }
    });
  });
});
