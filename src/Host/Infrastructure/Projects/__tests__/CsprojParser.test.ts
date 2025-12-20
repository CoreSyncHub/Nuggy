import * as fs from 'fs';
import { CsprojParser } from '../CsprojParser';

// Mock filesystem
jest.mock('fs');
const mockFs = fs as jest.Mocked<typeof fs>;

describe('CsprojParser', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('parse - SDK-style projects', () => {
    it('should detect SDK-style project', () => {
      const csprojContent = `<Project Sdk="Microsoft.NET.Sdk">
  <PropertyGroup>
    <TargetFramework>net8.0</TargetFramework>
  </PropertyGroup>
</Project>`;

      mockFs.readFileSync.mockReturnValue(csprojContent);

      const result = CsprojParser.parse('C:\\Project\\Project.csproj');

      expect(result.sdkType).toBe('SDK-Style');
      expect(result.sdk).toBe('Microsoft.NET.Sdk');
    });

    it('should extract single target framework', () => {
      const csprojContent = `<Project Sdk="Microsoft.NET.Sdk">
  <PropertyGroup>
    <TargetFramework>net8.0</TargetFramework>
  </PropertyGroup>
</Project>`;

      mockFs.readFileSync.mockReturnValue(csprojContent);

      const result = CsprojParser.parse('C:\\Project\\Project.csproj');

      expect(result.targetFramework).toBe('net8.0');
      expect(result.targetFrameworks).toBeUndefined();
    });

    it('should extract multiple target frameworks', () => {
      const csprojContent = `<Project Sdk="Microsoft.NET.Sdk">
  <PropertyGroup>
    <TargetFrameworks>net8.0;net7.0;net6.0</TargetFrameworks>
  </PropertyGroup>
</Project>`;

      mockFs.readFileSync.mockReturnValue(csprojContent);

      const result = CsprojParser.parse('C:\\Project\\Project.csproj');

      expect(result.targetFrameworks).toEqual(['net8.0', 'net7.0', 'net6.0']);
      expect(result.targetFramework).toBeUndefined();
    });

    it('should handle conditional PropertyGroups', () => {
      const csprojContent = `<Project Sdk="Microsoft.NET.Sdk">
  <PropertyGroup Condition="'$(Configuration)' == 'Debug'">
    <TargetFramework>net8.0</TargetFramework>
  </PropertyGroup>
</Project>`;

      mockFs.readFileSync.mockReturnValue(csprojContent);

      const result = CsprojParser.parse('C:\\Project\\Project.csproj');

      expect(result.propertyGroups).toHaveLength(1);
      expect(result.propertyGroups[0].condition).toContain('Debug');
      expect(result.propertyGroups[0].properties.TargetFramework).toBe('net8.0');
    });
  });

  describe('parse - Legacy projects', () => {
    it('should detect legacy project', () => {
      const csprojContent = `<Project ToolsVersion="15.0" xmlns="http://schemas.microsoft.com/developer/msbuild/2003">
  <PropertyGroup>
    <TargetFrameworkVersion>v4.7.2</TargetFrameworkVersion>
  </PropertyGroup>
</Project>`;

      mockFs.readFileSync.mockReturnValue(csprojContent);

      const result = CsprojParser.parse('C:\\Project\\Project.csproj');

      expect(result.sdkType).toBe('Legacy');
      expect(result.sdk).toBeUndefined();
    });
  });

  describe('getAllTargetFrameworks', () => {
    it('should return array from TargetFrameworks', () => {
      const parsed = {
        sdkType: 'SDK-Style' as const,
        targetFrameworks: ['net8.0', 'net7.0'],
        propertyGroups: [],
      };

      const result = CsprojParser.getAllTargetFrameworks(parsed);

      expect(result).toEqual(['net8.0', 'net7.0']);
    });

    it('should return array from TargetFramework', () => {
      const parsed = {
        sdkType: 'SDK-Style' as const,
        targetFramework: 'net8.0',
        propertyGroups: [],
      };

      const result = CsprojParser.getAllTargetFrameworks(parsed);

      expect(result).toEqual(['net8.0']);
    });

    it('should return empty array if no TFM', () => {
      const parsed = {
        sdkType: 'SDK-Style' as const,
        propertyGroups: [],
      };

      const result = CsprojParser.getAllTargetFrameworks(parsed);

      expect(result).toEqual([]);
    });
  });

  describe('isMultiTargeting', () => {
    it('should return true for multiple target frameworks', () => {
      const parsed = {
        sdkType: 'SDK-Style' as const,
        targetFrameworks: ['net8.0', 'net7.0'],
        propertyGroups: [],
      };

      expect(CsprojParser.isMultiTargeting(parsed)).toBe(true);
    });

    it('should return false for single target framework', () => {
      const parsed = {
        sdkType: 'SDK-Style' as const,
        targetFramework: 'net8.0',
        propertyGroups: [],
      };

      expect(CsprojParser.isMultiTargeting(parsed)).toBe(false);
    });

    it('should return false for no target frameworks', () => {
      const parsed = {
        sdkType: 'SDK-Style' as const,
        propertyGroups: [],
      };

      expect(CsprojParser.isMultiTargeting(parsed)).toBe(false);
    });
  });

  describe('extractPropertyGroups', () => {
    it('should extract multiple property groups', () => {
      const csprojContent = `<Project Sdk="Microsoft.NET.Sdk">
  <PropertyGroup>
    <TargetFramework>net8.0</TargetFramework>
    <Nullable>enable</Nullable>
  </PropertyGroup>
  <PropertyGroup Condition="'$(Configuration)' == 'Release'">
    <PublishAot>true</PublishAot>
  </PropertyGroup>
</Project>`;

      mockFs.readFileSync.mockReturnValue(csprojContent);

      const result = CsprojParser.parse('C:\\Project\\Project.csproj');

      expect(result.propertyGroups).toHaveLength(2);
      expect(result.propertyGroups[0].condition).toBeUndefined();
      expect(result.propertyGroups[0].properties.TargetFramework).toBe('net8.0');
      expect(result.propertyGroups[0].properties.Nullable).toBe('enable');

      expect(result.propertyGroups[1].condition).toContain('Release');
      expect(result.propertyGroups[1].properties.PublishAot).toBe('true');
    });
  });
});
