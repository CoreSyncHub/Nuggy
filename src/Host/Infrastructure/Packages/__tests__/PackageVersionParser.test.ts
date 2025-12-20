import * as fs from 'fs';
import { PackageVersionParser } from '../PackageVersionParser';

// Mock filesystem
jest.mock('fs');
const mockFs = fs as jest.Mocked<typeof fs>;

describe('PackageVersionParser', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('parse', () => {
    it('should parse PackageVersion entries from Directory.Packages.props', () => {
      const content = `<Project>
  <ItemGroup>
    <PackageVersion Include="Newtonsoft.Json" Version="13.0.3" />
    <PackageVersion Include="Serilog" Version="3.1.1" />
    <PackageVersion Include="AutoMapper" Version="12.0.1" />
  </ItemGroup>
</Project>`;

      mockFs.readFileSync.mockReturnValue(content);

      const result = PackageVersionParser.parse('C:\\Solution\\Directory.Packages.props');

      expect(result).toHaveLength(3);
      expect(result[0].name).toBe('Newtonsoft.Json');
      expect(result[0].version).toBe('13.0.3');
      expect(result[1].name).toBe('Serilog');
      expect(result[1].version).toBe('3.1.1');
      expect(result[2].name).toBe('AutoMapper');
      expect(result[2].version).toBe('12.0.1');
    });

    it('should handle multiple ItemGroups', () => {
      const content = `<Project>
  <ItemGroup>
    <PackageVersion Include="Package1" Version="1.0.0" />
  </ItemGroup>
  <ItemGroup>
    <PackageVersion Include="Package2" Version="2.0.0" />
  </ItemGroup>
</Project>`;

      mockFs.readFileSync.mockReturnValue(content);

      const result = PackageVersionParser.parse('C:\\Solution\\Directory.Packages.props');

      expect(result).toHaveLength(2);
      expect(result[0].name).toBe('Package1');
      expect(result[1].name).toBe('Package2');
    });

    it('should return empty array if no ItemGroup exists', () => {
      const content = `<Project>
  <PropertyGroup>
    <ManagePackageVersionsCentrally>true</ManagePackageVersionsCentrally>
  </PropertyGroup>
</Project>`;

      mockFs.readFileSync.mockReturnValue(content);

      const result = PackageVersionParser.parse('C:\\Solution\\Directory.Packages.props');

      expect(result).toHaveLength(0);
    });

    it('should handle invalid XML by throwing an error', () => {
      const content = `<Invalid`;

      mockFs.readFileSync.mockReturnValue(content);

      expect(() => {
        PackageVersionParser.parse('C:\\Solution\\Directory.Packages.props');
      }).toThrow();
    });
  });

  describe('isCpmEnabled', () => {
    it('should return true if ManagePackageVersionsCentrally is true', () => {
      const content = `<Project>
  <PropertyGroup>
    <ManagePackageVersionsCentrally>true</ManagePackageVersionsCentrally>
  </PropertyGroup>
</Project>`;

      mockFs.readFileSync.mockReturnValue(content);

      const result = PackageVersionParser.isCpmEnabled('C:\\Solution\\Directory.Packages.props');

      expect(result).toBe(true);
    });

    it('should return false if ManagePackageVersionsCentrally is false', () => {
      const content = `<Project>
  <PropertyGroup>
    <ManagePackageVersionsCentrally>false</ManagePackageVersionsCentrally>
  </PropertyGroup>
</Project>`;

      mockFs.readFileSync.mockReturnValue(content);

      const result = PackageVersionParser.isCpmEnabled('C:\\Solution\\Directory.Packages.props');

      expect(result).toBe(false);
    });

    it('should return false if ManagePackageVersionsCentrally is not present', () => {
      const content = `<Project>
  <PropertyGroup>
    <TargetFramework>net8.0</TargetFramework>
  </PropertyGroup>
</Project>`;

      mockFs.readFileSync.mockReturnValue(content);

      const result = PackageVersionParser.isCpmEnabled('C:\\Solution\\Directory.Packages.props');

      expect(result).toBe(false);
    });

    it('should handle errors gracefully', () => {
      mockFs.readFileSync.mockImplementation(() => {
        throw new Error('File not found');
      });

      const result = PackageVersionParser.isCpmEnabled('C:\\Solution\\Directory.Packages.props');

      expect(result).toBe(false);
    });
  });
});
