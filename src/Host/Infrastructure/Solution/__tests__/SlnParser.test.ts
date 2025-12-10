import * as fs from 'fs';
import * as path from 'path';
import { SlnParser } from '../SlnParser';
import { SolutionProject } from '../../../Domain/Solutions/Entities/SolutionFolder';

// Mock filesystem
jest.mock('fs');
const mockFs = fs as jest.Mocked<typeof fs>;

describe('SlnParser', () => {
  const mockSolutionPath = 'C:\\Projects\\MySolution.sln';

  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('isValidSlnFile', () => {
    it('should return false if file does not exist', () => {
      mockFs.existsSync.mockReturnValue(false);

      const result = SlnParser.isValidSlnFile('nonexistent.sln');

      expect(result).toBe(false);
    });

    it('should return false if file extension is not .sln', () => {
      mockFs.existsSync.mockReturnValue(true);

      const result = SlnParser.isValidSlnFile('file.txt');

      expect(result).toBe(false);
    });

    it('should return false if file does not contain Visual Studio signature', () => {
      mockFs.existsSync.mockReturnValue(true);
      mockFs.readFileSync.mockReturnValue('Invalid content');

      const result = SlnParser.isValidSlnFile('test.sln');

      expect(result).toBe(false);
    });

    it('should return true for valid .sln file', () => {
      mockFs.existsSync.mockReturnValue(true);
      mockFs.readFileSync.mockReturnValue('Microsoft Visual Studio Solution File, Format Version 12.00');

      const result = SlnParser.isValidSlnFile('test.sln');

      expect(result).toBe(true);
    });
  });

  describe('parse', () => {
    it('should parse a simple solution with one project', () => {
      const slnContent = `
Microsoft Visual Studio Solution File, Format Version 12.00
Project("{FAE04EC0-301F-11D3-BF4B-00C04F79EFBC}") = "MyProject", "MyProject\\MyProject.csproj", "{12345678-1234-1234-1234-123456789012}"
EndProject
Global
EndGlobal
`;

      mockFs.readFileSync.mockReturnValue(slnContent);

      const result = SlnParser.parse(mockSolutionPath);

      expect(result.projects).toHaveLength(1);
      expect(result.projects[0].name).toBe('MyProject');
      expect(result.projects[0].typeId).toBe('{FAE04EC0-301F-11D3-BF4B-00C04F79EFBC}');
      expect(result.folders).toHaveLength(0);
      expect(result.rootItems).toHaveLength(1);
    });

    it('should parse a solution with solution folders', () => {
      const slnContent = `
Microsoft Visual Studio Solution File, Format Version 12.00
Project("{2150E333-8FDC-42A3-9474-1A3956D46DE8}") = "Libraries", "Libraries", "{AAAAAAAA-AAAA-AAAA-AAAA-AAAAAAAAAAAA}"
EndProject
Project("{FAE04EC0-301F-11D3-BF4B-00C04F79EFBC}") = "MyLib", "MyLib\\MyLib.csproj", "{BBBBBBBB-BBBB-BBBB-BBBB-BBBBBBBBBBBB}"
EndProject
Global
  GlobalSection(NestedProjects) = preSolution
    {BBBBBBBB-BBBB-BBBB-BBBB-BBBBBBBBBBBB} = {AAAAAAAA-AAAA-AAAA-AAAA-AAAAAAAAAAAA}
  EndGlobalSection
EndGlobal
`;

      mockFs.readFileSync.mockReturnValue(slnContent);

      const result = SlnParser.parse(mockSolutionPath);

      expect(result.folders).toHaveLength(1);
      expect(result.folders[0].name).toBe('Libraries');
      expect(result.projects).toHaveLength(1);
      expect(result.projects[0].name).toBe('MyLib');

      // Check nesting
      const librariesFolder = result.folders[0];
      expect(librariesFolder.children).toHaveLength(1);
      expect(librariesFolder.children[0]).toBeInstanceOf(SolutionProject);
      expect((librariesFolder.children[0] as SolutionProject).name).toBe('MyLib');

      // Root should only contain the folder
      expect(result.rootItems).toHaveLength(1);
      expect(result.rootItems[0]).toBe(librariesFolder);
    });

    it('should parse nested solution folders', () => {
      const slnContent = `
Microsoft Visual Studio Solution File, Format Version 12.00
Project("{2150E333-8FDC-42A3-9474-1A3956D46DE8}") = "Folder1", "Folder1", "{FOLDER1-AAAA-AAAA-AAAA-AAAAAAAAAAAA}"
EndProject
Project("{2150E333-8FDC-42A3-9474-1A3956D46DE8}") = "Folder2", "Folder2", "{FOLDER2-BBBB-BBBB-BBBB-BBBBBBBBBBBB}"
EndProject
Project("{FAE04EC0-301F-11D3-BF4B-00C04F79EFBC}") = "MyProject", "MyProject.csproj", "{PROJECT-CCCC-CCCC-CCCC-CCCCCCCCCCCC}"
EndProject
Global
  GlobalSection(NestedProjects) = preSolution
    {FOLDER2-BBBB-BBBB-BBBB-BBBBBBBBBBBB} = {FOLDER1-AAAA-AAAA-AAAA-AAAAAAAAAAAA}
    {PROJECT-CCCC-CCCC-CCCC-CCCCCCCCCCCC} = {FOLDER2-BBBB-BBBB-BBBB-BBBBBBBBBBBB}
  EndGlobalSection
EndGlobal
`;

      mockFs.readFileSync.mockReturnValue(slnContent);

      const result = SlnParser.parse(mockSolutionPath);

      expect(result.folders).toHaveLength(2);
      expect(result.projects).toHaveLength(1);

      // Find Folder1 (root)
      const folder1 = result.folders.find((f) => f.name === 'Folder1');
      expect(folder1).toBeDefined();
      expect(folder1!.children).toHaveLength(1);

      // Folder2 should be child of Folder1
      const folder2Child = folder1!.children[0];
      expect(folder2Child).toBeInstanceOf(require('../../../Domain/Solutions/Entities/SolutionFolder').SolutionFolder);
      const folder2 = folder2Child as any;
      expect(folder2.name).toBe('Folder2');
      expect(folder2.children).toHaveLength(1);

      // Project should be in Folder2
      const project = folder2.children[0] as SolutionProject;
      expect(project.name).toBe('MyProject');
    });

    it('should handle mixed root-level items (folders and projects)', () => {
      const slnContent = `
Microsoft Visual Studio Solution File, Format Version 12.00
Project("{2150E333-8FDC-42A3-9474-1A3956D46DE8}") = "Folder1", "Folder1", "{FOLDER1-AAAA-AAAA-AAAA-AAAAAAAAAAAA}"
EndProject
Project("{FAE04EC0-301F-11D3-BF4B-00C04F79EFBC}") = "RootProject", "RootProject.csproj", "{ROOT-PROJ-BBBB-BBBB-BBBBBBBBBBBB}"
EndProject
Global
EndGlobal
`;

      mockFs.readFileSync.mockReturnValue(slnContent);

      const result = SlnParser.parse(mockSolutionPath);

      expect(result.rootItems).toHaveLength(2);
      expect(result.folders).toHaveLength(1);
      expect(result.projects).toHaveLength(1);

      // Both folder and project should be at root level
      const rootFolder = result.rootItems.find((item) => item.name === 'Folder1');
      const rootProject = result.rootItems.find((item) => item.name === 'RootProject');

      expect(rootFolder).toBeDefined();
      expect(rootProject).toBeDefined();
    });
  });
});
