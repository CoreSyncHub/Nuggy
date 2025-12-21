import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { NuGetConfigResolver } from '@Infrastructure/Packages/NuGetConfigResolver';
import { NuGetConfigParser } from '@Infrastructure/Packages/NuGetConfigParser';
import { NuGetConfigScope } from '@Domain/Packages/Enums/NuGetConfigScope';

// Mock filesystem and os
jest.mock('fs');
jest.mock('os');
const mockFs = fs as jest.Mocked<typeof fs>;
const mockOs = os as jest.Mocked<typeof os>;

/**
 * Acceptance test for NuGet.Config resolution
 *
 * Scenario: Verify that NuGet.Config files are correctly resolved and merged
 * from Machine-wide, User-profile, and Solution-local scopes
 */
describe('Acceptance: NuGet.Config Resolution', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockOs.platform.mockReturnValue('win32');
    mockOs.homedir.mockReturnValue('C:\\Users\\TestUser');
    process.env.PROGRAMDATA = 'C:\\ProgramData';
    process.env.APPDATA = 'C:\\Users\\TestUser\\AppData\\Roaming';
  });

  describe('Hierarchical resolution (Machine-wide -> User-profile -> Solution-local)', () => {
    it('should merge sources from all three scopes with correct priority', () => {
      // Mock config file locations
      (mockFs.existsSync as any).mockImplementation((path: string) => {
        return (
          path === 'C:\\ProgramData\\NuGet\\NuGet.Config' ||
          path === 'C:\\Users\\TestUser\\AppData\\Roaming\\NuGet\\NuGet.Config' ||
          path === 'C:\\Solution\\NuGet.Config' ||
          path === 'C:\\Solution'
        );
      });

      mockFs.statSync.mockReturnValue({ isFile: () => false } as any);

      // Machine-wide config: nuget.org only
      const machineWideConfig = `<?xml version="1.0" encoding="utf-8"?>
<configuration>
  <packageSources>
    <add key="nuget.org" value="https://api.nuget.org/v3/index.json" />
  </packageSources>
</configuration>`;

      // User-profile config: adds MyPersonalFeed
      const userProfileConfig = `<?xml version="1.0" encoding="utf-8"?>
<configuration>
  <packageSources>
    <add key="MyPersonalFeed" value="https://mypersonal.example.com/nuget" />
  </packageSources>
</configuration>`;

      // Solution-local config: adds CompanyFeed and overrides nuget.org (disables it)
      const solutionLocalConfig = `<?xml version="1.0" encoding="utf-8"?>
<configuration>
  <packageSources>
    <add key="CompanyFeed" value="https://pkgs.dev.azure.com/company/_packaging/feed/nuget/v3/index.json" />
    <add key="nuget.org" value="https://api.nuget.org/v3/index.json" />
  </packageSources>
  <disabledPackageSources>
    <add key="nuget.org" value="true" />
  </disabledPackageSources>
</configuration>`;

      (mockFs.readFileSync as any).mockImplementation((path: string) => {
        if (path === 'C:\\ProgramData\\NuGet\\NuGet.Config') {
          return machineWideConfig;
        }
        if (path === 'C:\\Users\\TestUser\\AppData\\Roaming\\NuGet\\NuGet.Config') {
          return userProfileConfig;
        }
        if (path === 'C:\\Solution\\NuGet.Config') {
          return solutionLocalConfig;
        }
        return '';
      });

      const resolution = NuGetConfigResolver.resolve('C:\\Solution\\MySolution.sln');

      // Should have 3 config files
      expect(resolution.configPaths.machineWide).toBeDefined();
      expect(resolution.configPaths.userProfile).toBeDefined();
      expect(resolution.configPaths.solutionLocal).toHaveLength(1);

      // Solution-local should override nuget.org (disable it)
      // So we should have only: CompanyFeed + MyPersonalFeed (nuget.org is disabled)
      expect(resolution.sources).toHaveLength(2);

      const sourceNames = resolution.sources.map((s) => s.name);
      expect(sourceNames).toContain('CompanyFeed');
      expect(sourceNames).toContain('MyPersonalFeed');
      expect(sourceNames).not.toContain('nuget.org'); // Disabled by solution-local config

      // CompanyFeed should be from solution-local scope
      const companyFeed = resolution.sources.find((s) => s.name === 'CompanyFeed');
      expect(companyFeed).toBeDefined();
      expect(companyFeed!.scope).toBe(NuGetConfigScope.SolutionLocal);
      expect(companyFeed!.isAzureArtifacts()).toBe(true);

      // MyPersonalFeed should be from user-profile scope
      const personalFeed = resolution.sources.find((s) => s.name === 'MyPersonalFeed');
      expect(personalFeed).toBeDefined();
      expect(personalFeed!.scope).toBe(NuGetConfigScope.UserProfile);
    });
  });

  describe('Package Source Mapping', () => {
    it('should enforce package source mappings for package routing', () => {
      (mockFs.existsSync as any).mockImplementation((path: string) => {
        return path === 'C:\\Solution\\NuGet.Config' || path === 'C:\\Solution';
      });

      mockFs.statSync.mockReturnValue({ isFile: () => false } as any);

      // Solution-local config with package source mapping
      const solutionLocalConfig = `<?xml version="1.0" encoding="utf-8"?>
<configuration>
  <packageSources>
    <add key="nuget.org" value="https://api.nuget.org/v3/index.json" />
    <add key="CompanyFeed" value="https://pkgs.dev.azure.com/company/_packaging/feed/nuget/v3/index.json" />
  </packageSources>
  <packageSourceMapping>
    <packageSource key="nuget.org">
      <package pattern="Microsoft.*" />
      <package pattern="System.*" />
    </packageSource>
    <packageSource key="CompanyFeed">
      <package pattern="Contoso.*" />
    </packageSource>
  </packageSourceMapping>
</configuration>`;

      mockFs.readFileSync.mockReturnValue(solutionLocalConfig);

      const resolution = NuGetConfigResolver.resolve('C:\\Solution\\MySolution.sln');

      // Should have package source mappings
      expect(resolution.packageSourceMappings).toHaveLength(3); // 3 patterns

      // Microsoft.* should be allowed from nuget.org only
      const microsoftSources = NuGetConfigResolver.getAllowedSourcesForPackage(
        resolution,
        'Microsoft.Extensions.Logging'
      );
      expect(microsoftSources).toHaveLength(1);
      expect(microsoftSources).toContain('nuget.org');

      // Contoso.* should be allowed from CompanyFeed only
      const contosoSources = NuGetConfigResolver.getAllowedSourcesForPackage(
        resolution,
        'Contoso.Core.Api'
      );
      expect(contosoSources).toHaveLength(1);
      expect(contosoSources).toContain('CompanyFeed');

      // Newtonsoft.Json does NOT match any pattern (strict mode)
      const newtonsoftSources = NuGetConfigResolver.getAllowedSourcesForPackage(
        resolution,
        'Newtonsoft.Json'
      );
      expect(newtonsoftSources).toHaveLength(0); // Not allowed (no mapping)

      // Verify canSourcePackageFrom
      expect(
        NuGetConfigResolver.canSourcePackageFrom(
          resolution,
          'Microsoft.AspNetCore.Mvc',
          'nuget.org'
        )
      ).toBe(true);
      expect(
        NuGetConfigResolver.canSourcePackageFrom(
          resolution,
          'Microsoft.AspNetCore.Mvc',
          'CompanyFeed'
        )
      ).toBe(false);

      expect(
        NuGetConfigResolver.canSourcePackageFrom(resolution, 'Contoso.Api', 'CompanyFeed')
      ).toBe(true);
      expect(
        NuGetConfigResolver.canSourcePackageFrom(resolution, 'Contoso.Api', 'nuget.org')
      ).toBe(false);
    });
  });

  describe('Private feed detection', () => {
    it('should identify Azure Artifacts feeds', () => {
      (mockFs.existsSync as any).mockImplementation((path: string) => {
        return path === 'C:\\Solution\\NuGet.Config' || path === 'C:\\Solution';
      });

      mockFs.statSync.mockReturnValue({ isFile: () => false } as any);

      const solutionLocalConfig = `<?xml version="1.0" encoding="utf-8"?>
<configuration>
  <packageSources>
    <add key="nuget.org" value="https://api.nuget.org/v3/index.json" />
    <add key="AzureFeed1" value="https://pkgs.dev.azure.com/myorg/_packaging/feed1/nuget/v3/index.json" />
    <add key="AzureFeed2" value="https://myorg.pkgs.visualstudio.com/_packaging/feed2/nuget/v3/index.json" />
  </packageSources>
</configuration>`;

      mockFs.readFileSync.mockReturnValue(solutionLocalConfig);

      const resolution = NuGetConfigResolver.resolve('C:\\Solution\\MySolution.sln');

      const azureFeeds = NuGetConfigResolver.getAzureArtifactsFeeds(resolution);
      expect(azureFeeds).toHaveLength(2);
      expect(azureFeeds[0].name).toBe('AzureFeed1');
      expect(azureFeeds[1].name).toBe('AzureFeed2');

      const privateFeeds = NuGetConfigResolver.getPrivateFeeds(resolution);
      expect(privateFeeds).toHaveLength(2); // AzureFeed1 + AzureFeed2 (nuget.org is public)
    });

    it('should identify BaGet feeds', () => {
      (mockFs.existsSync as any).mockImplementation((path: string) => {
        return path === 'C:\\Solution\\NuGet.Config' || path === 'C:\\Solution';
      });

      mockFs.statSync.mockReturnValue({ isFile: () => false } as any);

      const solutionLocalConfig = `<?xml version="1.0" encoding="utf-8"?>
<configuration>
  <packageSources>
    <add key="BaGetServer" value="https://baget.example.com/v3/index.json" />
  </packageSources>
</configuration>`;

      mockFs.readFileSync.mockReturnValue(solutionLocalConfig);

      const resolution = NuGetConfigResolver.resolve('C:\\Solution\\MySolution.sln');

      const bagetFeeds = NuGetConfigResolver.getBaGetFeeds(resolution);
      expect(bagetFeeds).toHaveLength(1);
      expect(bagetFeeds[0].name).toBe('BaGetServer');
      expect(bagetFeeds[0].getFeedType()).toBe('BaGet (or compatible)');
    });
  });

  describe('No config files (fallback to defaults)', () => {
    it('should handle missing config files gracefully', () => {
      mockFs.existsSync.mockReturnValue(false);

      const resolution = NuGetConfigResolver.resolve('C:\\Solution\\MySolution.sln');

      // Should have no sources
      expect(resolution.sources).toHaveLength(0);

      // Should have no config paths
      expect(resolution.configPaths.machineWide).toBeUndefined();
      expect(resolution.configPaths.userProfile).toBeUndefined();
      expect(resolution.configPaths.solutionLocal).toHaveLength(0);

      // Should have no package source mappings
      expect(resolution.packageSourceMappings).toHaveLength(0);
    });
  });
});
