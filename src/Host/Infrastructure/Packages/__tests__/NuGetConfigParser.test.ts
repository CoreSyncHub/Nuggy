import * as fs from 'fs';
import * as os from 'os';
import { NuGetConfigParser } from '../NuGetConfigParser';
import { NuGetConfigScope } from '@Domain/Packages/Enums/NuGetConfigScope';
import { type ILogger } from '../../../Application/Abstractions/Log/ILogger';

// Mock filesystem and os
jest.mock('fs');
// Force POSIX path semantics so the mocked-fs fixtures behave identically on
// every OS (path.win32.join would rewrite '/' to '\\' and break exact-string
// mocks). Platform-specific production code uses path.win32 explicitly.
jest.mock('path', () => jest.requireActual('path').posix);
jest.mock('os');
const mockFs = fs as jest.Mocked<typeof fs>;
const mockOs = os as jest.Mocked<typeof os>;

describe('NuGetConfigParser', () => {
  let parser: NuGetConfigParser;
  const mockLogger: ILogger = {
    Info: jest.fn(),
    Warning: jest.fn(),
    Error: jest.fn(),
    Debug: jest.fn(),
  };

  beforeEach(() => {
    jest.clearAllMocks();
    parser = new NuGetConfigParser(mockLogger);
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

      const sources = parser.parse(
        '/Solution/NuGet.Config',
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

      const sources = parser.parse(
        '/Solution/NuGet.Config',
        NuGetConfigScope.SolutionLocal
      );

      expect(sources).toHaveLength(2);
      expect(sources[0].isEnabled).toBe(true);
      expect(sources[1].name).toBe('DisabledFeed');
      expect(sources[1].isEnabled).toBe(false);
    });

    it('should return empty array if file does not exist', () => {
      mockFs.existsSync.mockReturnValue(false);

      const sources = parser.parse(
        '/Solution/NuGet.Config',
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

      const sources = parser.parse(
        '/Solution/NuGet.Config',
        NuGetConfigScope.SolutionLocal
      );

      expect(sources).toHaveLength(1);
      expect(sources[0].name).toBe('nuget.org');
    });

    it('should handle invalid XML gracefully', () => {
      mockFs.existsSync.mockReturnValue(true);
      mockFs.readFileSync.mockReturnValue('<invalid xml');

      const sources = parser.parse(
        '/Solution/NuGet.Config',
        NuGetConfigScope.SolutionLocal
      );

      expect(sources).toHaveLength(0);
      expect(mockLogger.Error).toHaveBeenCalled();
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

      const mappings = parser.parsePackageSourceMappings('/Solution/NuGet.Config');

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

      const mappings = parser.parsePackageSourceMappings('/Solution/NuGet.Config');

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

      const mappings = parser.parsePackageSourceMappings('/Solution/NuGet.Config');

      expect(mappings).toHaveLength(0);
    });
  });

  describe('findMachineWideConfig', () => {
    it('should find machine-wide config on Windows', () => {
      mockOs.platform.mockReturnValue('win32');
      process.env.PROGRAMDATA = 'C:\\ProgramData';
      mockFs.existsSync.mockReturnValue(true);

      const configPath = parser.findMachineWideConfig();

      expect(configPath).toBe('C:\\ProgramData\\NuGet\\NuGet.Config');
    });

    it('should return undefined if machine-wide config does not exist on Windows', () => {
      mockOs.platform.mockReturnValue('win32');
      process.env.PROGRAMDATA = 'C:\\ProgramData';
      mockFs.existsSync.mockReturnValue(false);

      const configPath = parser.findMachineWideConfig();

      expect(configPath).toBeUndefined();
    });
  });

  describe('findUserProfileConfig', () => {
    it('should find user-profile config on Windows', () => {
      mockOs.platform.mockReturnValue('win32');
      mockOs.homedir.mockReturnValue('C:\\Users\\TestUser');
      process.env.APPDATA = 'C:\\Users\\TestUser\\AppData\\Roaming';
      mockFs.existsSync.mockReturnValue(true);

      const configPath = parser.findUserProfileConfig();

      expect(configPath).toBe('C:\\Users\\TestUser\\AppData\\Roaming\\NuGet\\NuGet.Config');
    });

    it('should return undefined if user-profile config does not exist', () => {
      mockOs.platform.mockReturnValue('win32');
      mockOs.homedir.mockReturnValue('C:\\Users\\TestUser');
      process.env.APPDATA = 'C:\\Users\\TestUser\\AppData\\Roaming';
      mockFs.existsSync.mockReturnValue(false);

      const configPath = parser.findUserProfileConfig();

      expect(configPath).toBeUndefined();
    });
  });

  describe('findSolutionLocalConfigs', () => {
    it('should find NuGet.Config files in directory hierarchy', () => {
      const mockExistsSync = (p: string) => {
        return (
          p === '/solution/NuGet.Config' ||
          p === '/solution/src/Project1' ||
          p === '/solution/src/Project1/Project1.csproj'
        );
      };

      const mockStatSync = (p: string) => {
        return {
          isFile: () => p === '/solution/src/Project1/Project1.csproj',
        } as any;
      };

      mockFs.existsSync.mockImplementation(mockExistsSync as any);
      (mockFs.statSync as jest.Mock).mockImplementation(mockStatSync);

      const configs = parser.findSolutionLocalConfigs(
        '/solution/src/Project1/Project1.csproj'
      );

      // Should find /solution/NuGet.Config
      expect(configs).toContain('/solution/NuGet.Config');
      expect(configs).toHaveLength(1);
    });
  });
});
