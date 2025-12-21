import { NuGetConfigResolver } from '../NuGetConfigResolver';
import { NuGetConfigParser } from '../NuGetConfigParser';
import { NuGetSource } from '@Domain/Packages/Entities/NuGetSource';
import { NuGetConfigScope } from '@Domain/Packages/Enums/NuGetConfigScope';
import { PackageSourceMapping } from '@Domain/Packages/Entities/PackageSourceMapping';

// Mock the parser
jest.mock('../NuGetConfigParser');
const mockParser = NuGetConfigParser as jest.Mocked<typeof NuGetConfigParser>;

describe('NuGetConfigResolver', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('resolve', () => {
    it('should merge sources from all scopes', () => {
      mockParser.findAllConfigs.mockReturnValue({
        machineWide: 'C:\\ProgramData\\NuGet\\NuGet.Config',
        userProfile: 'C:\\Users\\Test\\.nuget\\NuGet\\NuGet.Config',
        solutionLocal: ['C:\\Solution\\NuGet.Config'],
      });

      const machineWideSources = [
        new NuGetSource(
          'nuget.org',
          'https://api.nuget.org/v3/index.json',
          true,
          NuGetConfigScope.MachineWide,
          'C:\\ProgramData\\NuGet\\NuGet.Config'
        ),
      ];

      const userProfileSources = [
        new NuGetSource(
          'MyFeed',
          'https://example.com/nuget',
          true,
          NuGetConfigScope.UserProfile,
          'C:\\Users\\Test\\.nuget\\NuGet\\NuGet.Config'
        ),
      ];

      const solutionLocalSources = [
        new NuGetSource(
          'PrivateFeed',
          'https://pkgs.dev.azure.com/myorg/_packaging/myfeed/nuget/v3/index.json',
          true,
          NuGetConfigScope.SolutionLocal,
          'C:\\Solution\\NuGet.Config'
        ),
      ];

      mockParser.parse
        .mockReturnValueOnce(machineWideSources)
        .mockReturnValueOnce(userProfileSources)
        .mockReturnValueOnce(solutionLocalSources);

      mockParser.parsePackageSourceMappings.mockReturnValue([]);

      const resolution = NuGetConfigResolver.resolve('C:\\Solution\\MySolution.sln');

      expect(resolution.sources).toHaveLength(3);
      expect(resolution.sourcesByScope.machineWide).toHaveLength(1);
      expect(resolution.sourcesByScope.userProfile).toHaveLength(1);
      expect(resolution.sourcesByScope.solutionLocal).toHaveLength(1);
    });

    it('should override machine-wide sources with user-profile sources of the same name', () => {
      mockParser.findAllConfigs.mockReturnValue({
        machineWide: 'C:\\ProgramData\\NuGet\\NuGet.Config',
        userProfile: 'C:\\Users\\Test\\.nuget\\NuGet\\NuGet.Config',
        solutionLocal: [],
      });

      const machineWideSources = [
        new NuGetSource(
          'SharedFeed',
          'https://machine.example.com/nuget',
          true,
          NuGetConfigScope.MachineWide,
          'C:\\ProgramData\\NuGet\\NuGet.Config'
        ),
      ];

      const userProfileSources = [
        new NuGetSource(
          'SharedFeed',
          'https://user.example.com/nuget',
          true,
          NuGetConfigScope.UserProfile,
          'C:\\Users\\Test\\.nuget\\NuGet\\NuGet.Config'
        ),
      ];

      mockParser.parse.mockReturnValueOnce(machineWideSources).mockReturnValueOnce(userProfileSources);

      mockParser.parsePackageSourceMappings.mockReturnValue([]);

      const resolution = NuGetConfigResolver.resolve('C:\\Solution\\MySolution.sln');

      // Should have only 1 source (user-profile overrides machine-wide)
      expect(resolution.sources).toHaveLength(1);
      expect(resolution.sources[0].url).toBe('https://user.example.com/nuget');
      expect(resolution.sources[0].scope).toBe(NuGetConfigScope.UserProfile);
    });

    it('should filter out disabled sources', () => {
      mockParser.findAllConfigs.mockReturnValue({
        machineWide: 'C:\\ProgramData\\NuGet\\NuGet.Config',
        userProfile: undefined,
        solutionLocal: [],
      });

      const machineWideSources = [
        new NuGetSource(
          'EnabledFeed',
          'https://enabled.example.com/nuget',
          true,
          NuGetConfigScope.MachineWide,
          'C:\\ProgramData\\NuGet\\NuGet.Config'
        ),
        new NuGetSource(
          'DisabledFeed',
          'https://disabled.example.com/nuget',
          false,
          NuGetConfigScope.MachineWide,
          'C:\\ProgramData\\NuGet\\NuGet.Config'
        ),
      ];

      mockParser.parse.mockReturnValueOnce(machineWideSources);
      mockParser.parsePackageSourceMappings.mockReturnValue([]);

      const resolution = NuGetConfigResolver.resolve('C:\\Solution\\MySolution.sln');

      expect(resolution.sources).toHaveLength(1);
      expect(resolution.sources[0].name).toBe('EnabledFeed');
    });

    it('should extract package source mappings from solution-local configs', () => {
      mockParser.findAllConfigs.mockReturnValue({
        machineWide: undefined,
        userProfile: undefined,
        solutionLocal: ['C:\\Solution\\NuGet.Config'],
      });

      mockParser.parse.mockReturnValue([]);

      const mappings = [
        new PackageSourceMapping('Microsoft.*', ['nuget.org']),
        new PackageSourceMapping('Contoso.*', ['MyPrivateFeed']),
      ];

      mockParser.parsePackageSourceMappings.mockReturnValue(mappings);

      const resolution = NuGetConfigResolver.resolve('C:\\Solution\\MySolution.sln');

      expect(resolution.packageSourceMappings).toHaveLength(2);
      expect(resolution.packageSourceMappings[0].pattern).toBe('Microsoft.*');
      expect(resolution.packageSourceMappings[1].pattern).toBe('Contoso.*');
    });
  });

  describe('getPrivateFeeds', () => {
    it('should filter private feeds', () => {
      const resolution = {
        sources: [
          new NuGetSource(
            'nuget.org',
            'https://api.nuget.org/v3/index.json',
            true,
            NuGetConfigScope.MachineWide,
            ''
          ),
          new NuGetSource(
            'PrivateFeed',
            'https://example.com/nuget',
            true,
            NuGetConfigScope.SolutionLocal,
            ''
          ),
        ],
        sourcesByScope: { machineWide: [], userProfile: [], solutionLocal: [] },
        packageSourceMappings: [],
        configPaths: { solutionLocal: [] },
      };

      const privateFeeds = NuGetConfigResolver.getPrivateFeeds(resolution);

      expect(privateFeeds).toHaveLength(1);
      expect(privateFeeds[0].name).toBe('PrivateFeed');
    });
  });

  describe('getAllowedSourcesForPackage', () => {
    it('should return all sources if no mappings exist', () => {
      const resolution = {
        sources: [
          new NuGetSource('nuget.org', 'https://api.nuget.org/v3/index.json', true, NuGetConfigScope.MachineWide, ''),
          new NuGetSource('MyFeed', 'https://example.com/nuget', true, NuGetConfigScope.SolutionLocal, ''),
        ],
        sourcesByScope: { machineWide: [], userProfile: [], solutionLocal: [] },
        packageSourceMappings: [],
        configPaths: { solutionLocal: [] },
      };

      const allowedSources = NuGetConfigResolver.getAllowedSourcesForPackage(resolution, 'Newtonsoft.Json');

      expect(allowedSources).toHaveLength(2);
      expect(allowedSources).toContain('nuget.org');
      expect(allowedSources).toContain('MyFeed');
    });

    it('should return mapped sources for matching package patterns', () => {
      const resolution = {
        sources: [
          new NuGetSource('nuget.org', 'https://api.nuget.org/v3/index.json', true, NuGetConfigScope.MachineWide, ''),
          new NuGetSource('MyFeed', 'https://example.com/nuget', true, NuGetConfigScope.SolutionLocal, ''),
        ],
        sourcesByScope: { machineWide: [], userProfile: [], solutionLocal: [] },
        packageSourceMappings: [
          new PackageSourceMapping('Microsoft.*', ['nuget.org']),
          new PackageSourceMapping('Contoso.*', ['MyFeed']),
        ],
        configPaths: { solutionLocal: [] },
      };

      const allowedSources = NuGetConfigResolver.getAllowedSourcesForPackage(resolution, 'Microsoft.Extensions.Logging');

      expect(allowedSources).toHaveLength(1);
      expect(allowedSources).toContain('nuget.org');
    });

    it('should return empty array if package does not match any mapping (strict mode)', () => {
      const resolution = {
        sources: [
          new NuGetSource('nuget.org', 'https://api.nuget.org/v3/index.json', true, NuGetConfigScope.MachineWide, ''),
        ],
        sourcesByScope: { machineWide: [], userProfile: [], solutionLocal: [] },
        packageSourceMappings: [
          new PackageSourceMapping('Microsoft.*', ['nuget.org']),
        ],
        configPaths: { solutionLocal: [] },
      };

      const allowedSources = NuGetConfigResolver.getAllowedSourcesForPackage(resolution, 'Newtonsoft.Json');

      expect(allowedSources).toHaveLength(0);
    });
  });

  describe('canSourcePackageFrom', () => {
    it('should return true if package can be sourced from feed', () => {
      const resolution = {
        sources: [
          new NuGetSource('nuget.org', 'https://api.nuget.org/v3/index.json', true, NuGetConfigScope.MachineWide, ''),
        ],
        sourcesByScope: { machineWide: [], userProfile: [], solutionLocal: [] },
        packageSourceMappings: [
          new PackageSourceMapping('Microsoft.*', ['nuget.org']),
        ],
        configPaths: { solutionLocal: [] },
      };

      const canSource = NuGetConfigResolver.canSourcePackageFrom(
        resolution,
        'Microsoft.Extensions.Logging',
        'nuget.org'
      );

      expect(canSource).toBe(true);
    });

    it('should return false if package cannot be sourced from feed', () => {
      const resolution = {
        sources: [
          new NuGetSource('nuget.org', 'https://api.nuget.org/v3/index.json', true, NuGetConfigScope.MachineWide, ''),
          new NuGetSource('MyFeed', 'https://example.com/nuget', true, NuGetConfigScope.SolutionLocal, ''),
        ],
        sourcesByScope: { machineWide: [], userProfile: [], solutionLocal: [] },
        packageSourceMappings: [
          new PackageSourceMapping('Microsoft.*', ['nuget.org']),
        ],
        configPaths: { solutionLocal: [] },
      };

      const canSource = NuGetConfigResolver.canSourcePackageFrom(
        resolution,
        'Microsoft.Extensions.Logging',
        'MyFeed'
      );

      expect(canSource).toBe(false);
    });
  });
});
