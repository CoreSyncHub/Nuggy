import * as fs from 'fs';
import { SlnxParser } from '../SlnxParser';
import { SolutionProject, SolutionFolder } from '../../../Domain/Solutions/Entities/SolutionFolder';

// Mock filesystem
jest.mock('fs');
const mockFs = fs as jest.Mocked<typeof fs>;

describe('SlnxParser', () => {
  const mockSolutionPath = 'C:\\Projects\\MySolution.slnx';

  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('isValidSlnxFile', () => {
    it('should return false if file does not exist', () => {
      mockFs.existsSync.mockReturnValue(false);

      const result = SlnxParser.isValidSlnxFile('nonexistent.slnx');

      expect(result).toBe(false);
    });

    it('should return false if file extension is not .slnx', () => {
      mockFs.existsSync.mockReturnValue(true);

      const result = SlnxParser.isValidSlnxFile('file.txt');

      expect(result).toBe(false);
    });

    it('should return false if XML does not contain Solution element', () => {
      mockFs.existsSync.mockReturnValue(true);
      mockFs.readFileSync.mockReturnValue('<InvalidRoot></InvalidRoot>');

      const result = SlnxParser.isValidSlnxFile('test.slnx');

      expect(result).toBe(false);
    });

    it('should return true for valid .slnx file', () => {
      mockFs.existsSync.mockReturnValue(true);
      const validSlnx = `
<Solution>
  <Project Path="test.csproj" />
</Solution>`;
      mockFs.readFileSync.mockReturnValue(validSlnx);

      const result = SlnxParser.isValidSlnxFile('test.slnx');

      expect(result).toBe(true);
    });
  });

  describe('parse', () => {
    it('should parse a simple solution with one project', () => {
      const slnxContent = `
<Solution>
  <Project Path="MyProject\\MyProject.csproj" Type="C#" />
</Solution>
`;

      mockFs.readFileSync.mockReturnValue(slnxContent);

      const result = SlnxParser.parse(mockSolutionPath);

      expect(result.projects).toHaveLength(1);
      expect(result.projects[0].name).toBe('MyProject');
      expect(result.projects[0].path).toContain('MyProject.csproj');
      expect(result.projects[0].typeId).toBe('C#');
      expect(result.folders).toHaveLength(0);
      expect(result.rootItems).toHaveLength(1);
    });

    it('should parse a solution with folders', () => {
      const slnxContent = `
<Solution>
  <Folder Name="Libraries">
    <Project Path="MyLib\\MyLib.csproj" />
  </Folder>
</Solution>
`;

      mockFs.readFileSync.mockReturnValue(slnxContent);

      const result = SlnxParser.parse(mockSolutionPath);

      expect(result.folders).toHaveLength(1);
      expect(result.folders[0].name).toBe('Libraries');
      expect(result.projects).toHaveLength(1);
      expect(result.projects[0].name).toBe('MyLib');

      // Check nesting
      const librariesFolder = result.folders[0];
      expect(librariesFolder.children).toHaveLength(1);
      expect(librariesFolder.children[0]).toBeInstanceOf(SolutionProject);

      // Root should only contain the folder
      expect(result.rootItems).toHaveLength(1);
      expect(result.rootItems[0]).toBe(librariesFolder);
    });

    it('should parse nested solution folders', () => {
      const slnxContent = `
<Solution>
  <Folder Name="Folder1">
    <Folder Name="Folder2">
      <Project Path="MyProject.csproj" />
    </Folder>
  </Folder>
</Solution>
`;

      mockFs.readFileSync.mockReturnValue(slnxContent);

      const result = SlnxParser.parse(mockSolutionPath);

      expect(result.folders).toHaveLength(2);
      expect(result.projects).toHaveLength(1);

      // Find Folder1 (root)
      const folder1 = result.rootItems[0] as SolutionFolder;
      expect(folder1.name).toBe('Folder1');
      expect(folder1.children).toHaveLength(1);

      // Folder2 should be child of Folder1
      const folder2 = folder1.children[0] as SolutionFolder;
      expect(folder2.name).toBe('Folder2');
      expect(folder2.children).toHaveLength(1);

      // Project should be in Folder2
      const project = folder2.children[0] as SolutionProject;
      expect(project.name).toBe('MyProject');
    });

    it('should handle mixed root-level items (folders and projects)', () => {
      const slnxContent = `
<Solution>
  <Folder Name="Folder1" />
  <Project Path="RootProject.csproj" />
</Solution>
`;

      mockFs.readFileSync.mockReturnValue(slnxContent);

      const result = SlnxParser.parse(mockSolutionPath);

      expect(result.rootItems).toHaveLength(2);
      expect(result.folders).toHaveLength(1);
      expect(result.projects).toHaveLength(1);

      // Both folder and project should be at root level
      // Note: Order depends on parsing order (folders first, then projects)
      const rootFolder = result.rootItems.find(
        (item) => item instanceof SolutionFolder
      ) as SolutionFolder;
      const rootProject = result.rootItems.find(
        (item) => item instanceof SolutionProject
      ) as SolutionProject;

      expect(rootFolder).toBeDefined();
      expect(rootProject).toBeDefined();
      expect(rootFolder.name).toBe('Folder1');
      expect(rootProject.name).toBe('RootProject');
    });

    it('should handle multiple projects in a folder', () => {
      const slnxContent = `
<Solution>
  <Folder Name="Libraries">
    <Project Path="Lib1\\Lib1.csproj" />
    <Project Path="Lib2\\Lib2.csproj" />
    <Project Path="Lib3\\Lib3.csproj" />
  </Folder>
</Solution>
`;

      mockFs.readFileSync.mockReturnValue(slnxContent);

      const result = SlnxParser.parse(mockSolutionPath);

      expect(result.folders).toHaveLength(1);
      expect(result.projects).toHaveLength(3);

      const librariesFolder = result.folders[0];
      expect(librariesFolder.children).toHaveLength(3);

      const projectNames = librariesFolder.children.map((c) => (c as SolutionProject).name);
      expect(projectNames).toEqual(['Lib1', 'Lib2', 'Lib3']);
    });

    it('should handle empty solution', () => {
      const slnxContent = '<Solution></Solution>';

      mockFs.readFileSync.mockReturnValue(slnxContent);

      const result = SlnxParser.parse(mockSolutionPath);

      expect(result.folders).toHaveLength(0);
      expect(result.projects).toHaveLength(0);
      expect(result.rootItems).toHaveLength(0);
    });

    it('should use path as identifier for projects', () => {
      const slnxContent = `
<Solution>
  <Project Path="MyProject\\MyProject.csproj" />
</Solution>
`;

      mockFs.readFileSync.mockReturnValue(slnxContent);

      const result = SlnxParser.parse(mockSolutionPath);

      expect(result.projects[0].id.toString()).toContain('MyProject');
      expect(result.projects[0].id.isPath()).toBe(true);
      expect(result.projects[0].id.isGuid()).toBe(false);
    });

    it('should use hierarchical path as identifier for folders', () => {
      const slnxContent = `
<Solution>
  <Folder Name="Folder1">
    <Folder Name="Folder2" />
  </Folder>
</Solution>
`;

      mockFs.readFileSync.mockReturnValue(slnxContent);

      const result = SlnxParser.parse(mockSolutionPath);

      const folder1 = result.folders.find((f) => f.name === 'Folder1');
      const folder2 = result.folders.find((f) => f.name === 'Folder2');

      expect(folder1!.id.toString()).toBe('Folder1');
      expect(folder2!.id.toString()).toBe('Folder1/Folder2');
    });
  });
});
