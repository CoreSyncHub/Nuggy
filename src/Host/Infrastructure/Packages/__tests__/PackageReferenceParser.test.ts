import * as fs from 'fs';
import { PackageReferenceParser } from '../PackageReferenceParser';

// Mock filesystem
jest.mock('fs');
const mockFs = fs as jest.Mocked<typeof fs>;

describe('PackageReferenceParser', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('parse', () => {
    it('should parse PackageReference entries with versions', () => {
      const content = `<Project Sdk="Microsoft.NET.Sdk">
  <ItemGroup>
    <PackageReference Include="Newtonsoft.Json" Version="13.0.3" />
    <PackageReference Include="Serilog" Version="3.1.1" />
  </ItemGroup>
</Project>`;

      mockFs.readFileSync.mockReturnValue(content);

      const result = PackageReferenceParser.parse('C:\\Solution\\Project\\Project.csproj');

      expect(result).toHaveLength(2);
      expect(result[0].name).toBe('Newtonsoft.Json');
      expect(result[0].version).toBe('13.0.3');
      expect(result[0].hasLocalVersion).toBe(true);
      expect(result[1].name).toBe('Serilog');
      expect(result[1].version).toBe('3.1.1');
      expect(result[1].hasLocalVersion).toBe(true);
    });

    it('should parse PackageReference entries without versions (CPM mode)', () => {
      const content = `<Project Sdk="Microsoft.NET.Sdk">
  <ItemGroup>
    <PackageReference Include="Newtonsoft.Json" />
    <PackageReference Include="Serilog" />
  </ItemGroup>
</Project>`;

      mockFs.readFileSync.mockReturnValue(content);

      const result = PackageReferenceParser.parse('C:\\Solution\\Project\\Project.csproj');

      expect(result).toHaveLength(2);
      expect(result[0].name).toBe('Newtonsoft.Json');
      expect(result[0].version).toBeUndefined();
      expect(result[0].hasLocalVersion).toBe(false);
      expect(result[1].name).toBe('Serilog');
      expect(result[1].version).toBeUndefined();
      expect(result[1].hasLocalVersion).toBe(false);
    });

    it('should handle mixed PackageReference entries', () => {
      const content = `<Project Sdk="Microsoft.NET.Sdk">
  <ItemGroup>
    <PackageReference Include="Newtonsoft.Json" Version="13.0.3" />
    <PackageReference Include="Serilog" />
  </ItemGroup>
</Project>`;

      mockFs.readFileSync.mockReturnValue(content);

      const result = PackageReferenceParser.parse('C:\\Solution\\Project\\Project.csproj');

      expect(result).toHaveLength(2);
      expect(result[0].hasLocalVersion).toBe(true);
      expect(result[1].hasLocalVersion).toBe(false);
    });

    it('should return empty array if no ItemGroup exists', () => {
      const content = `<Project Sdk="Microsoft.NET.Sdk">
  <PropertyGroup>
    <TargetFramework>net8.0</TargetFramework>
  </PropertyGroup>
</Project>`;

      mockFs.readFileSync.mockReturnValue(content);

      const result = PackageReferenceParser.parse('C:\\Solution\\Project\\Project.csproj');

      expect(result).toHaveLength(0);
    });
  });

  describe('parseMultiple', () => {
    it('should parse multiple .csproj files', () => {
      const csprojContent1 = `<Project Sdk="Microsoft.NET.Sdk">
  <ItemGroup>
    <PackageReference Include="Package1" Version="1.0.0" />
  </ItemGroup>
</Project>`;

      const csprojContent2 = `<Project Sdk="Microsoft.NET.Sdk">
  <ItemGroup>
    <PackageReference Include="Package2" />
  </ItemGroup>
</Project>`;

      mockFs.readFileSync.mockImplementation((path) => {
        if (path === 'C:\\Solution\\Project1\\Project1.csproj') {
          return csprojContent1;
        } else if (path === 'C:\\Solution\\Project2\\Project2.csproj') {
          return csprojContent2;
        }
        return '';
      });

      const projectPaths = [
        'C:\\Solution\\Project1\\Project1.csproj',
        'C:\\Solution\\Project2\\Project2.csproj',
      ];

      const results = PackageReferenceParser.parseMultiple(projectPaths);

      expect(results.size).toBe(2);
      expect(results.get('C:\\Solution\\Project1\\Project1.csproj')).toHaveLength(1);
      expect(results.get('C:\\Solution\\Project2\\Project2.csproj')).toHaveLength(1);
    });

    it('should handle errors gracefully', () => {
      const consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});

      mockFs.readFileSync.mockImplementation(() => {
        throw new Error('File not found');
      });

      const projectPaths = ['C:\\Solution\\Project\\Project.csproj'];

      const results = PackageReferenceParser.parseMultiple(projectPaths);

      expect(results.size).toBe(1);
      expect(results.get('C:\\Solution\\Project\\Project.csproj')).toEqual([]);

      consoleErrorSpy.mockRestore();
    });
  });
});
