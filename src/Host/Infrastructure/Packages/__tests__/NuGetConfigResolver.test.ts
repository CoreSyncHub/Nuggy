import { NuGetConfigResolver } from '../NuGetConfigResolver';
import { NuGetConfigParser } from '../NuGetConfigParser';
import { NuGetSource } from '@Domain/Packages/Entities/NuGetSource';
import { NuGetConfigScope } from '@Domain/Packages/Enums/NuGetConfigScope';
import { PackageSourceMapping } from '@Domain/Packages/Entities/PackageSourceMapping';

// Mock the parser instance methods
const mockParserInstance = {
  findAllConfigs: jest.fn(),
  parse: jest.fn(),
  parsePackageSourceMappings: jest.fn(),
};

jest.mock('../NuGetConfigParser', () => ({
  NuGetConfigParser: jest.fn().mockImplementation(() => mockParserInstance),
}));

describe('NuGetConfigResolver', () => {
  let resolver: NuGetConfigResolver;

  beforeEach(() => {
    jest.clearAllMocks();
    resolver = new NuGetConfigResolver(mockParserInstance as unknown as NuGetConfigParser);
  });

  describe('resolve', () => {
    it('should merge sources from all scopes', () => {
      mockParserInstance.findAllConfigs.mockReturnValue({
        machineWide: '/ProgramData/NuGet/NuGet.Config',
        userProfile: '/Users/Test/.nuget/NuGet/NuGet.Config',
        solutionLocal: ['/Solution/NuGet.Config'],
      });

      const machineWideSources = [
        new NuGetSource(
          'nuget.org',
          'https://api.nuget.org/v3/index.json',
          true,
          NuGetConfigScope.MachineWide,
          '/ProgramData/NuGet/NuGet.Config'
        ),
      ];

      const userProfileSources = [
        new NuGetSource(
          'MyFeed',
          'https://example.com/nuget',
          true,
          NuGetConfigScope.UserProfile,
          '/Users/Test/.nuget/NuGet/NuGet.Config'
        ),
      ];

      const solutionLocalSources = [
        new NuGetSource(
          'PrivateFeed',
          'https://pkgs.dev.azure.com/myorg/_packaging/myfeed/nuget/v3/index.json',
          true,
          NuGetConfigScope.SolutionLocal,
          '/Solution/NuGet.Config'
        ),
      ];

      mockParserInstance.parse
        .mockReturnValueOnce(machineWideSources)
        .mockReturnValueOnce(userProfileSources)
        .mockReturnValueOnce(solutionLocalSources);

      mockParserInstance.parsePackageSourceMappings.mockReturnValue([]);

      const resolution = resolver.resolve('/Solution/MySolution.sln');

      expect(resolution.sources).toHaveLength(3);
      expect(resolution.sourcesByScope.machineWide).toHaveLength(1);
      expect(resolution.sourcesByScope.userProfile).toHaveLength(1);
      expect(resolution.sourcesByScope.solutionLocal).toHaveLength(1);
    });

    it('should override machine-wide sources with user-profile sources of the same name', () => {
      mockParserInstance.findAllConfigs.mockReturnValue({
        machineWide: '/ProgramData/NuGet/NuGet.Config',
        userProfile: '/Users/Test/.nuget/NuGet/NuGet.Config',
        solutionLocal: [],
      });

      const machineWideSources = [
        new NuGetSource(
          'SharedFeed',
          'https://machine.example.com/nuget',
          true,
          NuGetConfigScope.MachineWide,
          '/ProgramData/NuGet/NuGet.Config'
        ),
      ];

      const userProfileSources = [
        new NuGetSource(
          'SharedFeed',
          'https://user.example.com/nuget',
          true,
          NuGetConfigScope.UserProfile,
          '/Users/Test/.nuget/NuGet/NuGet.Config'
        ),
      ];

      mockParserInstance.parse.mockReturnValueOnce(machineWideSources).mockReturnValueOnce(userProfileSources);

      mockParserInstance.parsePackageSourceMappings.mockReturnValue([]);

      const resolution = resolver.resolve('/Solution/MySolution.sln');

      // Should have only 1 source (user-profile overrides machine-wide)
      expect(resolution.sources).toHaveLength(1);
      expect(resolution.sources[0].url).toBe('https://user.example.com/nuget');
      expect(resolution.sources[0].scope).toBe(NuGetConfigScope.UserProfile);
    });

    it('should filter out disabled sources', () => {
      mockParserInstance.findAllConfigs.mockReturnValue({
        machineWide: '/ProgramData/NuGet/NuGet.Config',
        userProfile: undefined,
        solutionLocal: [],
      });

      const machineWideSources = [
        new NuGetSource(
          'EnabledFeed',
          'https://enabled.example.com/nuget',
          true,
          NuGetConfigScope.MachineWide,
          '/ProgramData/NuGet/NuGet.Config'
        ),
        new NuGetSource(
          'DisabledFeed',
          'https://disabled.example.com/nuget',
          false,
          NuGetConfigScope.MachineWide,
          '/ProgramData/NuGet/NuGet.Config'
        ),
      ];

      mockParserInstance.parse.mockReturnValueOnce(machineWideSources);
      mockParserInstance.parsePackageSourceMappings.mockReturnValue([]);

      const resolution = resolver.resolve('/Solution/MySolution.sln');

      expect(resolution.sources).toHaveLength(1);
      expect(resolution.sources[0].name).toBe('EnabledFeed');
    });

    it('should extract package source mappings from solution-local configs', () => {
      mockParserInstance.findAllConfigs.mockReturnValue({
        machineWide: undefined,
        userProfile: undefined,
        solutionLocal: ['/Solution/NuGet.Config'],
      });

      mockParserInstance.parse.mockReturnValue([]);

      const mappings = [
        new PackageSourceMapping('Microsoft.*', ['nuget.org']),
        new PackageSourceMapping('Contoso.*', ['MyPrivateFeed']),
      ];

      mockParserInstance.parsePackageSourceMappings.mockReturnValue(mappings);

      const resolution = resolver.resolve('/Solution/MySolution.sln');

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

      const privateFeeds = resolver.getPrivateFeeds(resolution);

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

      const allowedSources = resolver.getAllowedSourcesForPackage(resolution, 'Newtonsoft.Json');

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

      const allowedSources = resolver.getAllowedSourcesForPackage(resolution, 'Microsoft.Extensions.Logging');

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

      const allowedSources = resolver.getAllowedSourcesForPackage(resolution, 'Newtonsoft.Json');

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

      const canSource = resolver.canSourcePackageFrom(
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

      const canSource = resolver.canSourcePackageFrom(
        resolution,
        'Microsoft.Extensions.Logging',
        'MyFeed'
      );

      expect(canSource).toBe(false);
    });
  });
});
