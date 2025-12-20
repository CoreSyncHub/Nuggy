import * as fs from 'fs';
import { TfmResolver, TfmSource } from '../TfmResolver';
import { BuildConfigFile } from '../../../Domain/Build/Entities/BuildConfigFile';
import { BuildConfigFileType } from '../../../Domain/Build/Enums/BuildConfigFileType';

// Mock filesystem
jest.mock('fs');
const mockFs = fs as jest.Mocked<typeof fs>;

describe('TfmResolver', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('resolve - Priority: .csproj > Directory.Build.targets > Directory.Build.props', () => {
    it('should use TFM from .csproj when present', () => {
      const csprojContent = `<Project Sdk="Microsoft.NET.Sdk">
  <PropertyGroup>
    <TargetFramework>net8.0</TargetFramework>
  </PropertyGroup>
</Project>`;

      mockFs.readFileSync.mockReturnValue(csprojContent);

      const buildConfigFiles: BuildConfigFile[] = [];

      const result = TfmResolver.resolve('C:\\Solution\\Project\\Project.csproj', buildConfigFiles);

      expect(result.targetFrameworks).toEqual(['net8.0']);
      expect(result.primaryTargetFramework).toBe('net8.0');
      expect(result.source).toBe(TfmSource.CsprojFile);
      expect(result.sdkType).toBe('SDK-Style');
    });

    it('should fall back to Directory.Build.targets when .csproj has no TFM', () => {
      const csprojContent = `<Project Sdk="Microsoft.NET.Sdk">
  <PropertyGroup>
    <Nullable>enable</Nullable>
  </PropertyGroup>
</Project>`;

      mockFs.readFileSync.mockReturnValue(csprojContent);

      const targetsFile = new BuildConfigFile(
        'C:\\Solution\\Directory.Build.targets',
        BuildConfigFileType.DirectoryBuildTargets,
        'C:\\Solution'
      );
      targetsFile.setProperty('TargetFramework', 'net7.0');

      const buildConfigFiles = [targetsFile];

      const result = TfmResolver.resolve('C:\\Solution\\Project\\Project.csproj', buildConfigFiles);

      expect(result.targetFrameworks).toEqual(['net7.0']);
      expect(result.source).toBe(TfmSource.DirectoryBuildTargets);
    });

    it('should fall back to Directory.Build.props when .csproj and .targets have no TFM', () => {
      const csprojContent = `<Project Sdk="Microsoft.NET.Sdk">
  <PropertyGroup>
    <Nullable>enable</Nullable>
  </PropertyGroup>
</Project>`;

      mockFs.readFileSync.mockReturnValue(csprojContent);

      const propsFile = new BuildConfigFile(
        'C:\\Solution\\Directory.Build.props',
        BuildConfigFileType.DirectoryBuildProps,
        'C:\\Solution'
      );
      propsFile.setProperty('TargetFramework', 'net6.0');

      const buildConfigFiles = [propsFile];

      const result = TfmResolver.resolve('C:\\Solution\\Project\\Project.csproj', buildConfigFiles);

      expect(result.targetFrameworks).toEqual(['net6.0']);
      expect(result.source).toBe(TfmSource.DirectoryBuildProps);
    });

    it('should prefer .targets over .props', () => {
      const csprojContent = `<Project Sdk="Microsoft.NET.Sdk">
</Project>`;

      mockFs.readFileSync.mockReturnValue(csprojContent);

      const propsFile = new BuildConfigFile(
        'C:\\Solution\\Directory.Build.props',
        BuildConfigFileType.DirectoryBuildProps,
        'C:\\Solution'
      );
      propsFile.setProperty('TargetFramework', 'net6.0');

      const targetsFile = new BuildConfigFile(
        'C:\\Solution\\Directory.Build.targets',
        BuildConfigFileType.DirectoryBuildTargets,
        'C:\\Solution'
      );
      targetsFile.setProperty('TargetFramework', 'net8.0');

      const buildConfigFiles = [propsFile, targetsFile];

      const result = TfmResolver.resolve('C:\\Solution\\Project\\Project.csproj', buildConfigFiles);

      expect(result.targetFrameworks).toEqual(['net8.0']);
      expect(result.source).toBe(TfmSource.DirectoryBuildTargets);
    });

    it('should return NotFound when no TFM is found anywhere', () => {
      const csprojContent = `<Project Sdk="Microsoft.NET.Sdk">
</Project>`;

      mockFs.readFileSync.mockReturnValue(csprojContent);

      const buildConfigFiles: BuildConfigFile[] = [];

      const result = TfmResolver.resolve('C:\\Solution\\Project\\Project.csproj', buildConfigFiles);

      expect(result.targetFrameworks).toEqual([]);
      expect(result.primaryTargetFramework).toBe('unknown');
      expect(result.source).toBe(TfmSource.NotFound);
    });
  });

  describe('resolve - Multi-targeting support', () => {
    it('should handle multi-targeting in .csproj', () => {
      const csprojContent = `<Project Sdk="Microsoft.NET.Sdk">
  <PropertyGroup>
    <TargetFrameworks>net8.0;net7.0;net6.0</TargetFrameworks>
  </PropertyGroup>
</Project>`;

      mockFs.readFileSync.mockReturnValue(csprojContent);

      const result = TfmResolver.resolve('C:\\Solution\\Project\\Project.csproj', []);

      expect(result.targetFrameworks).toEqual(['net8.0', 'net7.0', 'net6.0']);
      expect(result.isMultiTargeting).toBe(true);
      expect(result.primaryTargetFramework).toBe('net8.0');
    });

    it('should handle multi-targeting from Directory.Build.props', () => {
      const csprojContent = `<Project Sdk="Microsoft.NET.Sdk">
</Project>`;

      mockFs.readFileSync.mockReturnValue(csprojContent);

      const propsFile = new BuildConfigFile(
        'C:\\Solution\\Directory.Build.props',
        BuildConfigFileType.DirectoryBuildProps,
        'C:\\Solution'
      );
      propsFile.setProperty('TargetFrameworks', 'net8.0;net7.0');

      const result = TfmResolver.resolve('C:\\Solution\\Project\\Project.csproj', [propsFile]);

      expect(result.targetFrameworks).toEqual(['net8.0', 'net7.0']);
      expect(result.isMultiTargeting).toBe(true);
    });
  });

  describe('resolve - Hierarchical build config files', () => {
    it('should use closest affecting build config file', () => {
      const csprojContent = `<Project Sdk="Microsoft.NET.Sdk">
</Project>`;

      mockFs.readFileSync.mockReturnValue(csprojContent);

      // Root level props
      const rootProps = new BuildConfigFile(
        'C:\\Solution\\Directory.Build.props',
        BuildConfigFileType.DirectoryBuildProps,
        'C:\\Solution'
      );
      rootProps.setProperty('TargetFramework', 'net6.0');

      // Nested props closer to project
      const nestedProps = new BuildConfigFile(
        'C:\\Solution\\src\\Directory.Build.props',
        BuildConfigFileType.DirectoryBuildProps,
        'C:\\Solution\\src'
      );
      nestedProps.setProperty('TargetFramework', 'net8.0');

      const buildConfigFiles = [rootProps, nestedProps];

      // Project is in C:\Solution\src\Project
      const result = TfmResolver.resolve(
        'C:\\Solution\\src\\Project\\Project.csproj',
        buildConfigFiles
      );

      // Should use nested props (net8.0), not root props (net6.0)
      expect(result.targetFrameworks).toEqual(['net8.0']);
    });
  });

  describe('resolveMultiple', () => {
    it('should resolve TFM for multiple projects', () => {
      const csprojContent1 = `<Project Sdk="Microsoft.NET.Sdk">
  <PropertyGroup>
    <TargetFramework>net8.0</TargetFramework>
  </PropertyGroup>
</Project>`;

      const csprojContent2 = `<Project Sdk="Microsoft.NET.Sdk">
  <PropertyGroup>
    <TargetFramework>net7.0</TargetFramework>
  </PropertyGroup>
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

      const results = TfmResolver.resolveMultiple(projectPaths, []);

      expect(results.size).toBe(2);
      expect(results.get('C:\\Solution\\Project1\\Project1.csproj')?.targetFrameworks).toEqual([
        'net8.0',
      ]);
      expect(results.get('C:\\Solution\\Project2\\Project2.csproj')?.targetFrameworks).toEqual([
        'net7.0',
      ]);
    });

    it('should handle errors gracefully and provide fallback', () => {
      const consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});

      mockFs.readFileSync.mockImplementation(() => {
        throw new Error('File not found');
      });

      const projectPaths = ['C:\\Solution\\Project\\Project.csproj'];

      const results = TfmResolver.resolveMultiple(projectPaths, []);

      expect(results.size).toBe(1);
      const result = results.get('C:\\Solution\\Project\\Project.csproj');
      expect(result?.source).toBe(TfmSource.NotFound);
      expect(result?.targetFrameworks).toEqual([]);

      consoleErrorSpy.mockRestore();
    });
  });
});
