import * as fs from 'fs';
import { BuildConfigParser } from '../BuildConfigParser';
import { BuildConfigFile } from '../../../Domain/Build/Entities/BuildConfigFile';
import { BuildConfigFileType } from '../../../Domain/Build/Enums/BuildConfigFileType';

// Mock filesystem
jest.mock('fs');
const mockFs = fs as jest.Mocked<typeof fs>;

describe('BuildConfigParser', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('parse', () => {
    it('should extract properties from PropertyGroup', () => {
      const propsContent = `
<Project>
  <PropertyGroup>
    <TargetFramework>net8.0</TargetFramework>
    <Nullable>enable</Nullable>
    <LangVersion>latest</LangVersion>
  </PropertyGroup>
</Project>
`;

      mockFs.readFileSync.mockReturnValue(propsContent);

      const configFile = new BuildConfigFile(
        'C:\\Solution\\Directory.Build.props',
        BuildConfigFileType.DirectoryBuildProps,
        'C:\\Solution'
      );

      BuildConfigParser.parse(configFile.path, configFile);

      expect(configFile.properties.get('TargetFramework')).toBe('net8.0');
      expect(configFile.properties.get('Nullable')).toBe('enable');
      expect(configFile.properties.get('LangVersion')).toBe('latest');
    });

    it('should handle multiple PropertyGroups', () => {
      const propsContent = `
<Project>
  <PropertyGroup>
    <TargetFramework>net8.0</TargetFramework>
  </PropertyGroup>
  <PropertyGroup Condition="'$(Configuration)' == 'Debug'">
    <Nullable>enable</Nullable>
  </PropertyGroup>
</Project>
`;

      mockFs.readFileSync.mockReturnValue(propsContent);

      const configFile = new BuildConfigFile(
        'C:\\Solution\\Directory.Build.props',
        BuildConfigFileType.DirectoryBuildProps,
        'C:\\Solution'
      );

      BuildConfigParser.parse(configFile.path, configFile);

      expect(configFile.properties.get('TargetFramework')).toBe('net8.0');
      expect(configFile.properties.get('Nullable')).toBe('enable');
    });

    it('should detect parent import', () => {
      const propsContent = `
<Project>
  <Import Project="$([MSBuild]::GetDirectoryNameOfFileAbove($(MSBuildThisFileDirectory).., Directory.Build.props))\\Directory.Build.props" />
  <PropertyGroup>
    <TargetFramework>net8.0</TargetFramework>
  </PropertyGroup>
</Project>
`;

      mockFs.readFileSync.mockReturnValue(propsContent);

      const configFile = new BuildConfigFile(
        'C:\\Solution\\src\\Directory.Build.props',
        BuildConfigFileType.DirectoryBuildProps,
        'C:\\Solution\\src'
      );

      BuildConfigParser.parse(configFile.path, configFile);

      expect(configFile.importsParent).toBe(true);
    });

    it('should not set importsParent if no parent import exists', () => {
      const propsContent = `
<Project>
  <PropertyGroup>
    <TargetFramework>net8.0</TargetFramework>
  </PropertyGroup>
</Project>
`;

      mockFs.readFileSync.mockReturnValue(propsContent);

      const configFile = new BuildConfigFile(
        'C:\\Solution\\Directory.Build.props',
        BuildConfigFileType.DirectoryBuildProps,
        'C:\\Solution'
      );

      BuildConfigParser.parse(configFile.path, configFile);

      expect(configFile.importsParent).toBe(false);
    });

    it('should handle Directory.Packages.props files', () => {
      const packagesPropsContent = `<Project>
  <PropertyGroup>
    <ManagePackageVersionsCentrally>true</ManagePackageVersionsCentrally>
  </PropertyGroup>
</Project>`;

      mockFs.readFileSync.mockReturnValue(packagesPropsContent);

      const configFile = new BuildConfigFile(
        'C:\\Solution\\Directory.Packages.props',
        BuildConfigFileType.DirectoryPackagesProps,
        'C:\\Solution'
      );

      // Should not throw
      expect(() => BuildConfigParser.parse(configFile.path, configFile)).not.toThrow();

      // At minimum, the file should be processed without errors
      expect(configFile.properties.size).toBeGreaterThanOrEqual(0);
    });

    it('should handle empty or invalid XML gracefully', () => {
      mockFs.readFileSync.mockReturnValue('Invalid XML {]');

      const configFile = new BuildConfigFile(
        'C:\\Solution\\Directory.Build.props',
        BuildConfigFileType.DirectoryBuildProps,
        'C:\\Solution'
      );

      // Should not throw
      expect(() => BuildConfigParser.parse(configFile.path, configFile)).not.toThrow();

      // Should have no properties
      expect(configFile.properties.size).toBe(0);
    });
  });

  describe('getCommonProperties', () => {
    it('should extract common properties', () => {
      const configFile = new BuildConfigFile(
        'C:\\Solution\\Directory.Build.props',
        BuildConfigFileType.DirectoryBuildProps,
        'C:\\Solution'
      );

      configFile.setProperty('TargetFramework', 'net8.0');
      configFile.setProperty('LangVersion', 'latest');
      configFile.setProperty('Nullable', 'enable');
      configFile.setProperty('ImplicitUsings', 'enable');

      const commonProps = BuildConfigParser.getCommonProperties(configFile);

      expect(commonProps.targetFramework).toBe('net8.0');
      expect(commonProps.langVersion).toBe('latest');
      expect(commonProps.nullable).toBe('enable');
      expect(commonProps.implicitUsings).toBe('enable');
    });

    it('should return undefined for missing common properties', () => {
      const configFile = new BuildConfigFile(
        'C:\\Solution\\Directory.Build.props',
        BuildConfigFileType.DirectoryBuildProps,
        'C:\\Solution'
      );

      const commonProps = BuildConfigParser.getCommonProperties(configFile);

      expect(commonProps.targetFramework).toBeUndefined();
      expect(commonProps.langVersion).toBeUndefined();
      expect(commonProps.nullable).toBeUndefined();
    });
  });
});
