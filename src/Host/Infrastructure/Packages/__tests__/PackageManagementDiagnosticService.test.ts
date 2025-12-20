import * as fs from 'fs';
import { PackageManagementDiagnosticService } from '../PackageManagementDiagnosticService';
import { PackageReference } from '@Domain/Packages/Entities/PackageReference';
import { LegacyPackage } from '@Domain/Packages/Entities/LegacyPackage';
import { PackageIdentity } from '@Domain/Packages/ValueObjects/PackageIdentity';
import { BuildConfigFile } from '@Domain/Build/Entities/BuildConfigFile';
import { BuildConfigFileType } from '@Domain/Build/Enums/BuildConfigFileType';
import { PackageManagementMode } from '@Domain/Packages/Enums/PackageManagementMode';

// Mock filesystem
jest.mock('fs');
const mockFs = fs as jest.Mocked<typeof fs>;

describe('PackageManagementDiagnosticService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    // Default mock: empty CPM file
    mockFs.readFileSync.mockReturnValue('<Project></Project>');
  });

  describe('analyze - SDK-style projects only', () => {
    it('should analyze SDK-style projects with CPM', () => {
      const cpmFile = new BuildConfigFile(
        'C:\\Solution\\Directory.Packages.props',
        BuildConfigFileType.DirectoryPackagesProps,
        'C:\\Solution'
      );

      const cpmContent = `<Project>
  <ItemGroup>
    <PackageVersion Include="Package1" Version="1.0.0" />
  </ItemGroup>
</Project>`;

      mockFs.readFileSync.mockReturnValue(cpmContent);

      const packageReferences = new Map<string, PackageReference[]>();
      packageReferences.set('C:\\Solution\\Project1\\Project1.csproj', [
        new PackageReference(
          new PackageIdentity('Package1'),
          'C:\\Solution\\Project1\\Project1.csproj',
          false
        ),
      ]);

      const result = PackageManagementDiagnosticService.analyze(
        [cpmFile],
        packageReferences,
        new Map()
      );

      expect(result.isCpmEnabled).toBe(true);
      expect(result.mode).toBe(PackageManagementMode.Central);
      expect(result.packageVersions).toHaveLength(1);
      expect(result.legacyPackages.size).toBe(0);
      expect(result.isTransitional).toBe(false);
      expect(result.projectTypeSummary.sdkStyleProjects).toBe(1);
      expect(result.projectTypeSummary.legacyFrameworkProjects).toBe(0);
      expect(result.projectTypeSummary.cpmEnabledProjects).toBe(1);
    });

    it('should analyze SDK-style projects without CPM', () => {
      const propsFile = new BuildConfigFile(
        'C:\\Solution\\Directory.Build.props',
        BuildConfigFileType.DirectoryBuildProps,
        'C:\\Solution'
      );

      const packageReferences = new Map<string, PackageReference[]>();
      packageReferences.set('C:\\Solution\\Project1\\Project1.csproj', [
        new PackageReference(
          new PackageIdentity('Package1', '1.0.0'),
          'C:\\Solution\\Project1\\Project1.csproj',
          true
        ),
      ]);

      const result = PackageManagementDiagnosticService.analyze(
        [propsFile],
        packageReferences,
        new Map()
      );

      expect(result.isCpmEnabled).toBe(false);
      expect(result.mode).toBe(PackageManagementMode.Local);
      expect(result.legacyPackages.size).toBe(0);
      expect(result.isTransitional).toBe(false);
      expect(result.projectTypeSummary.sdkStyleProjects).toBe(1);
      expect(result.projectTypeSummary.legacyFrameworkProjects).toBe(0);
    });
  });

  describe('analyze - Legacy projects only', () => {
    it('should analyze legacy projects with packages.config', () => {
      const legacyPackages = new Map<string, LegacyPackage[]>();
      legacyPackages.set('C:\\Solution\\LegacyProject\\LegacyProject.csproj', [
        new LegacyPackage(
          new PackageIdentity('Newtonsoft.Json', '12.0.3'),
          'C:\\Solution\\LegacyProject\\LegacyProject.csproj',
          'C:\\Solution\\LegacyProject\\packages.config',
          'net472'
        ),
      ]);

      const result = PackageManagementDiagnosticService.analyze(
        [],
        new Map(),
        legacyPackages
      );

      expect(result.isCpmEnabled).toBe(false);
      expect(result.mode).toBe(PackageManagementMode.Local);
      expect(result.legacyPackages.size).toBe(1);
      expect(result.packageVersions).toHaveLength(0);
      expect(result.isTransitional).toBe(false);
      expect(result.projectTypeSummary.sdkStyleProjects).toBe(0);
      expect(result.projectTypeSummary.legacyFrameworkProjects).toBe(1);
    });
  });

  describe('analyze - Mixed SDK-style and Legacy projects', () => {
    it('should detect mixed mode and transitional solution when both SDK-style and legacy projects exist', () => {
      const cpmFile = new BuildConfigFile(
        'C:\\Solution\\Directory.Packages.props',
        BuildConfigFileType.DirectoryPackagesProps,
        'C:\\Solution'
      );

      const cpmContent = `<Project>
  <ItemGroup>
    <PackageVersion Include="Package1" Version="1.0.0" />
  </ItemGroup>
</Project>`;

      mockFs.readFileSync.mockReturnValue(cpmContent);

      const packageReferences = new Map<string, PackageReference[]>();
      packageReferences.set('C:\\Solution\\ModernProject\\ModernProject.csproj', [
        new PackageReference(
          new PackageIdentity('Package1'),
          'C:\\Solution\\ModernProject\\ModernProject.csproj',
          false
        ),
      ]);

      const legacyPackages = new Map<string, LegacyPackage[]>();
      legacyPackages.set('C:\\Solution\\LegacyProject\\LegacyProject.csproj', [
        new LegacyPackage(
          new PackageIdentity('Newtonsoft.Json', '12.0.3'),
          'C:\\Solution\\LegacyProject\\LegacyProject.csproj',
          'C:\\Solution\\LegacyProject\\packages.config',
          'net472'
        ),
      ]);

      const result = PackageManagementDiagnosticService.analyze(
        [cpmFile],
        packageReferences,
        legacyPackages
      );

      expect(result.isCpmEnabled).toBe(true);
      expect(result.mode).toBe(PackageManagementMode.Mixed);
      expect(result.packageVersions).toHaveLength(1);
      expect(result.legacyPackages.size).toBe(1);
      expect(result.isTransitional).toBe(true);
      expect(result.projectTypeSummary.sdkStyleProjects).toBe(1);
      expect(result.projectTypeSummary.legacyFrameworkProjects).toBe(1);
      expect(result.projectTypeSummary.cpmEnabledProjects).toBe(1);

      // Should have an Info diagnostic about transitional solution
      const infoDiagnostics = result.diagnostics.filter((d) => d.severity === 'Info');
      expect(infoDiagnostics.length).toBeGreaterThan(0);
      expect(infoDiagnostics[0].message).toContain('legacy .NET Framework');
      expect(infoDiagnostics[0].message).toContain('modern SDK-style');
    });

    it('should detect mixed mode and transitional solution when SDK-style local and legacy projects exist', () => {
      const propsFile = new BuildConfigFile(
        'C:\\Solution\\Directory.Build.props',
        BuildConfigFileType.DirectoryBuildProps,
        'C:\\Solution'
      );

      const packageReferences = new Map<string, PackageReference[]>();
      packageReferences.set('C:\\Solution\\ModernProject\\ModernProject.csproj', [
        new PackageReference(
          new PackageIdentity('Package1', '1.0.0'),
          'C:\\Solution\\ModernProject\\ModernProject.csproj',
          true
        ),
      ]);

      const legacyPackages = new Map<string, LegacyPackage[]>();
      legacyPackages.set('C:\\Solution\\LegacyProject\\LegacyProject.csproj', [
        new LegacyPackage(
          new PackageIdentity('Newtonsoft.Json', '12.0.3'),
          'C:\\Solution\\LegacyProject\\LegacyProject.csproj',
          'C:\\Solution\\LegacyProject\\packages.config',
          'net472'
        ),
      ]);

      const result = PackageManagementDiagnosticService.analyze(
        [propsFile],
        packageReferences,
        legacyPackages
      );

      expect(result.isCpmEnabled).toBe(false);
      expect(result.mode).toBe(PackageManagementMode.Mixed);
      expect(result.legacyPackages.size).toBe(1);
      expect(result.isTransitional).toBe(true);
      expect(result.projectTypeSummary.sdkStyleProjects).toBe(1);
      expect(result.projectTypeSummary.legacyFrameworkProjects).toBe(1);

      // Should have an Info diagnostic about transitional solution
      const infoDiagnostics = result.diagnostics.filter((d) => d.severity === 'Info');
      expect(infoDiagnostics.length).toBeGreaterThan(0);
      expect(infoDiagnostics[0].message).toContain('progressive migration');
    });
  });
});
