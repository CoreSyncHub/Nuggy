import * as fs from 'fs';
import * as os from 'os';
import { NuGetConfigParser } from '../NuGetConfigParser';
import { NuGetConfigScope } from '@Domain/Packages/Enums/NuGetConfigScope';

// Mock filesystem and os
jest.mock('fs');
jest.mock('os');
const mockFs = fs as jest.Mocked<typeof fs>;
const mockOs = os as jest.Mocked<typeof os>;

describe('NuGetConfigParser', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('parse', () => {
    it('should parse package sources from NuGet.Config', () => {
      const configContent = `<?xml version="1.0" encoding="utf-8"?>
<configuration>
  <packageSources>
    <add key="nuget.org" value="https://api.nuget.org/v3/index.json" protocolVersion="3" />
    <add key="MyPrivateFeed" value="https://pkgs.dev.azure.com/myorg/_packaging/myfeed/nuget/v3/index.json" />
  </packageSources>
</configuration>`;

      mockFs.existsSync.mockReturnValue(true);
      mockFs.readFileSync.mockReturnValue(configContent);

      const sources = NuGetConfigParser.parse(
        'C:\\Solution\\NuGet.Config',
        NuGetConfigScope.SolutionLocal
      );

      expect(sources).toHaveLength(2);
      expect(sources[0].name).toBe('nuget.org');
      expect(sources[0].url).toBe('https://api.nuget.org/v3/index.json');
      expect(sources[0].protocolVersion).toBe('3');
      expect(sources[0].isEnabled).toBe(true);
      expect(sources[0].scope).toBe(NuGetConfigScope.SolutionLocal);

      expect(sources[1].name).toBe('MyPrivateFeed');
      expect(sources[1].isEnabled).toBe(true);
    });

    it('should handle disabled package sources', () => {
      const configContent = `<?xml version="1.0" encoding="utf-8"?>
<configuration>
  <packageSources>
    <add key="nuget.org" value="https://api.nuget.org/v3/index.json" />
    <add key="DisabledFeed" value="https://example.com/nuget" />
  </packageSources>
  <disabledPackageSources>
    <add key="DisabledFeed" value="true" />
  </disabledPackageSources>
</configuration>`;

      mockFs.existsSync.mockReturnValue(true);
      mockFs.readFileSync.mockReturnValue(configContent);

      const sources = NuGetConfigParser.parse(
        'C:\\Solution\\NuGet.Config',
        NuGetConfigScope.SolutionLocal
      );

      expect(sources).toHaveLength(2);
      expect(sources[0].isEnabled).toBe(true);
      expect(sources[1].name).toBe('DisabledFeed');
      expect(sources[1].isEnabled).toBe(false);
    });

    it('should return empty array if file does not exist', () => {
      mockFs.existsSync.mockReturnValue(false);

      const sources = NuGetConfigParser.parse(
        'C:\\Solution\\NuGet.Config',
        NuGetConfigScope.SolutionLocal
      );

      expect(sources).toHaveLength(0);
    });

    it('should handle single package source without array', () => {
      const configContent = `<?xml version="1.0" encoding="utf-8"?>
<configuration>
  <packageSources>
    <add key="nuget.org" value="https://api.nuget.org/v3/index.json" />
  </packageSources>
</configuration>`;

      mockFs.existsSync.mockReturnValue(true);
      mockFs.readFileSync.mockReturnValue(configContent);

      const sources = NuGetConfigParser.parse(
        'C:\\Solution\\NuGet.Config',
        NuGetConfigScope.SolutionLocal
      );

      expect(sources).toHaveLength(1);
      expect(sources[0].name).toBe('nuget.org');
    });

    it('should handle invalid XML gracefully', () => {
      const consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation();

      mockFs.existsSync.mockReturnValue(true);
      mockFs.readFileSync.mockReturnValue('<invalid xml');

      const sources = NuGetConfigParser.parse(
        'C:\\Solution\\NuGet.Config',
        NuGetConfigScope.SolutionLocal
      );

      expect(sources).toHaveLength(0);
      expect(consoleErrorSpy).toHaveBeenCalled();

      consoleErrorSpy.mockRestore();
    });
  });

  describe('parsePackageSourceMappings', () => {
    it('should parse package source mappings', () => {
      const configContent = `<?xml version="1.0" encoding="utf-8"?>
<configuration>
  <packageSourceMapping>
    <packageSource key="nuget.org">
      <package pattern="Microsoft.*" />
      <package pattern="System.*" />
    </packageSource>
    <packageSource key="MyPrivateFeed">
      <package pattern="Contoso.*" />
    </packageSource>
  </packageSourceMapping>
</configuration>`;

      mockFs.existsSync.mockReturnValue(true);
      mockFs.readFileSync.mockReturnValue(configContent);

      const mappings = NuGetConfigParser.parsePackageSourceMappings('C:\\Solution\\NuGet.Config');

      expect(mappings).toHaveLength(3);

      // Microsoft.* should map to nuget.org
      const microsoftMapping = mappings.find((m) => m.pattern === 'Microsoft.*');
      expect(microsoftMapping).toBeDefined();
      expect(microsoftMapping!.sourceNames).toContain('nuget.org');

      // Contoso.* should map to MyPrivateFeed
      const contosoMapping = mappings.find((m) => m.pattern === 'Contoso.*');
      expect(contosoMapping).toBeDefined();
      expect(contosoMapping!.sourceNames).toContain('MyPrivateFeed');
    });

    it('should handle single package source mapping', () => {
      const configContent = `<?xml version="1.0" encoding="utf-8"?>
<configuration>
  <packageSourceMapping>
    <packageSource key="nuget.org">
      <package pattern="*" />
    </packageSource>
  </packageSourceMapping>
</configuration>`;

      mockFs.existsSync.mockReturnValue(true);
      mockFs.readFileSync.mockReturnValue(configContent);

      const mappings = NuGetConfigParser.parsePackageSourceMappings('C:\\Solution\\NuGet.Config');

      expect(mappings).toHaveLength(1);
      expect(mappings[0].pattern).toBe('*');
      expect(mappings[0].sourceNames).toContain('nuget.org');
    });

    it('should return empty array if no mappings exist', () => {
      const configContent = `<?xml version="1.0" encoding="utf-8"?>
<configuration>
  <packageSources>
    <add key="nuget.org" value="https://api.nuget.org/v3/index.json" />
  </packageSources>
</configuration>`;

      mockFs.existsSync.mockReturnValue(true);
      mockFs.readFileSync.mockReturnValue(configContent);

      const mappings = NuGetConfigParser.parsePackageSourceMappings('C:\\Solution\\NuGet.Config');

      expect(mappings).toHaveLength(0);
    });
  });

  describe('findMachineWideConfig', () => {
    it('should find machine-wide config on Windows', () => {
      mockOs.platform.mockReturnValue('win32');
      process.env.PROGRAMDATA = 'C:\\ProgramData';
      mockFs.existsSync.mockReturnValue(true);

      const configPath = NuGetConfigParser.findMachineWideConfig();

      expect(configPath).toBe('C:\\ProgramData\\NuGet\\NuGet.Config');
    });

    it('should return undefined if machine-wide config does not exist on Windows', () => {
      mockOs.platform.mockReturnValue('win32');
      process.env.PROGRAMDATA = 'C:\\ProgramData';
      mockFs.existsSync.mockReturnValue(false);

      const configPath = NuGetConfigParser.findMachineWideConfig();

      expect(configPath).toBeUndefined();
    });
  });

  describe('findUserProfileConfig', () => {
    it('should find user-profile config on Windows', () => {
      mockOs.platform.mockReturnValue('win32');
      mockOs.homedir.mockReturnValue('C:\\Users\\TestUser');
      process.env.APPDATA = 'C:\\Users\\TestUser\\AppData\\Roaming';
      mockFs.existsSync.mockReturnValue(true);

      const configPath = NuGetConfigParser.findUserProfileConfig();

      expect(configPath).toBe('C:\\Users\\TestUser\\AppData\\Roaming\\NuGet\\NuGet.Config');
    });

    it('should return undefined if user-profile config does not exist', () => {
      mockOs.platform.mockReturnValue('win32');
      mockOs.homedir.mockReturnValue('C:\\Users\\TestUser');
      process.env.APPDATA = 'C:\\Users\\TestUser\\AppData\\Roaming';
      mockFs.existsSync.mockReturnValue(false);

      const configPath = NuGetConfigParser.findUserProfileConfig();

      expect(configPath).toBeUndefined();
    });
  });

  describe('findSolutionLocalConfigs', () => {
    it('should find NuGet.Config files in directory hierarchy', () => {
      const mockExistsSync = (path: string) => {
        return (
          path === 'C:\\Solution\\NuGet.Config' ||
          path === 'C:\\Solution\\src\\Project1' ||
          path === 'C:\\Solution\\src\\Project1\\Project1.csproj'
        );
      };

      const mockStatSync = (path: string) => {
        return {
          isFile: () => path === 'C:\\Solution\\src\\Project1\\Project1.csproj',
        } as any;
      };

      mockFs.existsSync.mockImplementation(mockExistsSync as any);
      (mockFs.statSync as jest.Mock).mockImplementation(mockStatSync);

      const configs = NuGetConfigParser.findSolutionLocalConfigs(
        'C:\\Solution\\src\\Project1\\Project1.csproj'
      );

      // Should find C:\Solution\NuGet.Config
      // Note: The loop stops before reaching the root directory (C:\)
      expect(configs).toContain('C:\\Solution\\NuGet.Config');
      expect(configs).toHaveLength(1);
    });
  });
});
