import * as fs from 'fs';
import { CpmDiagnosticService } from '../CpmDiagnosticService';
import { PackageVersion } from '@Domain/Packages/Entities/PackageVersion';
import { PackageReference } from '@Domain/Packages/Entities/PackageReference';
import { PackageIdentity } from '@Domain/Packages/ValueObjects/PackageIdentity';
import { BuildConfigFile } from '@Domain/Build/Entities/BuildConfigFile';
import { BuildConfigFileType } from '@Domain/Build/Enums/BuildConfigFileType';
import { PackageManagementMode } from '@Domain/Packages/Enums/PackageManagementMode';
import { PackageDiagnosticSeverity } from '@Domain/Packages/Enums/PackageDiagnosticSeverity';

// Mock filesystem
jest.mock('fs');
const mockFs = fs as jest.Mocked<typeof fs>;

describe('CpmDiagnosticService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    // Default mock: empty CPM file
    mockFs.readFileSync.mockReturnValue('<Project></Project>');
  });
  describe('analyze - CPM enabled', () => {
    it('should detect CPM is enabled when Directory.Packages.props exists', () => {
      const cpmFile = new BuildConfigFile(
        'C:\\Solution\\Directory.Packages.props',
        BuildConfigFileType.DirectoryPackagesProps,
        'C:\\Solution'
      );

      const result = CpmDiagnosticService.analyze([cpmFile], new Map());

      expect(result.isCpmEnabled).toBe(true);
      expect(result.cpmFilePath).toBe('C:\\Solution\\Directory.Packages.props');
    });

    it('should detect CPM is not enabled when no Directory.Packages.props exists', () => {
      const propsFile = new BuildConfigFile(
        'C:\\Solution\\Directory.Build.props',
        BuildConfigFileType.DirectoryBuildProps,
        'C:\\Solution'
      );

      const result = CpmDiagnosticService.analyze([propsFile], new Map());

      expect(result.isCpmEnabled).toBe(false);
      expect(result.cpmFilePath).toBeUndefined();
    });
  });

  describe('analyze - Management mode detection', () => {
    it('should detect Local mode when CPM is not enabled', () => {
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

      const result = CpmDiagnosticService.analyze([propsFile], packageReferences);

      expect(result.mode).toBe(PackageManagementMode.Local);
    });

    it('should detect Central mode when CPM is enabled and no local versions', () => {
      const cpmFile = new BuildConfigFile(
        'C:\\Solution\\Directory.Packages.props',
        BuildConfigFileType.DirectoryPackagesProps,
        'C:\\Solution'
      );

      const packageReferences = new Map<string, PackageReference[]>();
      packageReferences.set('C:\\Solution\\Project1\\Project1.csproj', [
        new PackageReference(
          new PackageIdentity('Package1'),
          'C:\\Solution\\Project1\\Project1.csproj',
          false
        ),
      ]);

      const result = CpmDiagnosticService.analyze([cpmFile], packageReferences);

      expect(result.mode).toBe(PackageManagementMode.Central);
    });

    it('should detect Mixed mode when CPM is enabled but some packages have local versions', () => {
      const cpmFile = new BuildConfigFile(
        'C:\\Solution\\Directory.Packages.props',
        BuildConfigFileType.DirectoryPackagesProps,
        'C:\\Solution'
      );

      const packageReferences = new Map<string, PackageReference[]>();
      packageReferences.set('C:\\Solution\\Project1\\Project1.csproj', [
        new PackageReference(
          new PackageIdentity('Package1', '1.0.0'),
          'C:\\Solution\\Project1\\Project1.csproj',
          true
        ),
        new PackageReference(
          new PackageIdentity('Package2'),
          'C:\\Solution\\Project1\\Project1.csproj',
          false
        ),
      ]);

      const result = CpmDiagnosticService.analyze([cpmFile], packageReferences);

      expect(result.mode).toBe(PackageManagementMode.Mixed);
    });
  });

  describe('analyze - Version conflict detection', () => {
    it('should detect version conflicts when package has local version but is centrally managed', () => {
      const cpmFile = new BuildConfigFile(
        'C:\\Solution\\Directory.Packages.props',
        BuildConfigFileType.DirectoryPackagesProps,
        'C:\\Solution'
      );

      // Mock the Directory.Packages.props content
      const cpmContent = `<Project>
  <ItemGroup>
    <PackageVersion Include="Newtonsoft.Json" Version="13.0.3" />
  </ItemGroup>
</Project>`;

      mockFs.readFileSync.mockReturnValue(cpmContent);

      const packageReferences = new Map<string, PackageReference[]>();
      packageReferences.set('C:\\Solution\\Project1\\Project1.csproj', [
        new PackageReference(
          new PackageIdentity('Newtonsoft.Json', '12.0.0'),
          'C:\\Solution\\Project1\\Project1.csproj',
          true
        ),
      ]);

      const result = CpmDiagnosticService.analyze([cpmFile], packageReferences);

      expect(result.diagnostics).toHaveLength(1);
      expect(result.diagnostics[0].severity).toBe(PackageDiagnosticSeverity.Warning);
      expect(result.diagnostics[0].packageName).toBe('Newtonsoft.Json');
      expect(result.diagnostics[0].message).toContain('centrally managed');
    });

    it('should not create diagnostics for packages with local versions that are not centrally managed', () => {
      const cpmFile = new BuildConfigFile(
        'C:\\Solution\\Directory.Packages.props',
        BuildConfigFileType.DirectoryPackagesProps,
        'C:\\Solution'
      );

      // Mock the Directory.Packages.props content
      const cpmContent = `<Project>
  <ItemGroup>
    <PackageVersion Include="Package1" Version="1.0.0" />
  </ItemGroup>
</Project>`;

      mockFs.readFileSync.mockReturnValue(cpmContent);

      const packageReferences = new Map<string, PackageReference[]>();
      packageReferences.set('C:\\Solution\\Project1\\Project1.csproj', [
        new PackageReference(
          new PackageIdentity('Package2', '2.0.0'),
          'C:\\Solution\\Project1\\Project1.csproj',
          true
        ),
      ]);

      const result = CpmDiagnosticService.analyze([cpmFile], packageReferences);

      expect(result.diagnostics).toHaveLength(0);
    });
  });

  describe('analyze - Package version to project mapping', () => {
    it('should map package versions to projects that reference them', () => {
      const cpmFile = new BuildConfigFile(
        'C:\\Solution\\Directory.Packages.props',
        BuildConfigFileType.DirectoryPackagesProps,
        'C:\\Solution'
      );

      // Mock the Directory.Packages.props content
      const cpmContent = `<Project>
  <ItemGroup>
    <PackageVersion Include="Package1" Version="1.0.0" />
    <PackageVersion Include="Package2" Version="2.0.0" />
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
      packageReferences.set('C:\\Solution\\Project2\\Project2.csproj', [
        new PackageReference(
          new PackageIdentity('Package1'),
          'C:\\Solution\\Project2\\Project2.csproj',
          false
        ),
        new PackageReference(
          new PackageIdentity('Package2'),
          'C:\\Solution\\Project2\\Project2.csproj',
          false
        ),
      ]);

      const result = CpmDiagnosticService.analyze([cpmFile], packageReferences);

      // Package1 should be mapped to both projects
      expect(result.packageVersions[0].affectedProjects).toHaveLength(2);
      expect(result.packageVersions[0].affectedProjects).toContain(
        'C:\\Solution\\Project1\\Project1.csproj'
      );
      expect(result.packageVersions[0].affectedProjects).toContain(
        'C:\\Solution\\Project2\\Project2.csproj'
      );

      // Package2 should be mapped only to Project2
      expect(result.packageVersions[1].affectedProjects).toHaveLength(1);
      expect(result.packageVersions[1].affectedProjects).toContain(
        'C:\\Solution\\Project2\\Project2.csproj'
      );
    });
  });
});
