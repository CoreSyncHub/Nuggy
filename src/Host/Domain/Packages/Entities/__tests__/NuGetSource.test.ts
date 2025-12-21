import { NuGetSource } from '../NuGetSource';
import { NuGetConfigScope } from '../../Enums/NuGetConfigScope';

describe('NuGetSource', () => {
  describe('isPrivateFeed', () => {
    it('should return false for nuget.org', () => {
      const source = new NuGetSource(
        'nuget.org',
        'https://api.nuget.org/v3/index.json',
        true,
        NuGetConfigScope.MachineWide,
        'C:\\NuGet.Config'
      );

      expect(source.isPrivateFeed()).toBe(false);
    });

    it('should return true for non-nuget.org feeds', () => {
      const source = new NuGetSource(
        'MyPrivateFeed',
        'https://example.com/nuget',
        true,
        NuGetConfigScope.SolutionLocal,
        'C:\\Solution\\NuGet.Config'
      );

      expect(source.isPrivateFeed()).toBe(true);
    });
  });

  describe('isAzureArtifacts', () => {
    it('should detect Azure Artifacts feed with pkgs.dev.azure.com', () => {
      const source = new NuGetSource(
        'AzureFeed',
        'https://pkgs.dev.azure.com/myorg/_packaging/myfeed/nuget/v3/index.json',
        true,
        NuGetConfigScope.SolutionLocal,
        'C:\\Solution\\NuGet.Config'
      );

      expect(source.isAzureArtifacts()).toBe(true);
    });

    it('should detect Azure Artifacts feed with pkgs.visualstudio.com', () => {
      const source = new NuGetSource(
        'AzureFeed',
        'https://myorg.pkgs.visualstudio.com/_packaging/myfeed/nuget/v3/index.json',
        true,
        NuGetConfigScope.SolutionLocal,
        'C:\\Solution\\NuGet.Config'
      );

      expect(source.isAzureArtifacts()).toBe(true);
    });

    it('should return false for non-Azure feeds', () => {
      const source = new NuGetSource(
        'nuget.org',
        'https://api.nuget.org/v3/index.json',
        true,
        NuGetConfigScope.MachineWide,
        'C:\\NuGet.Config'
      );

      expect(source.isAzureArtifacts()).toBe(false);
    });
  });

  describe('isBaGet', () => {
    it('should detect BaGet feed with v3/index.json pattern', () => {
      const source = new NuGetSource(
        'BaGetFeed',
        'https://baget.example.com/v3/index.json',
        true,
        NuGetConfigScope.SolutionLocal,
        'C:\\Solution\\NuGet.Config'
      );

      expect(source.isBaGet()).toBe(true);
    });

    it('should return false for nuget.org v3 endpoint', () => {
      const source = new NuGetSource(
        'nuget.org',
        'https://api.nuget.org/v3/index.json',
        true,
        NuGetConfigScope.MachineWide,
        'C:\\NuGet.Config'
      );

      expect(source.isBaGet()).toBe(false);
    });
  });

  describe('getFeedType', () => {
    it('should return "NuGet.org" for official NuGet feed', () => {
      const source = new NuGetSource(
        'nuget.org',
        'https://api.nuget.org/v3/index.json',
        true,
        NuGetConfigScope.MachineWide,
        'C:\\NuGet.Config'
      );

      expect(source.getFeedType()).toBe('NuGet.org');
    });

    it('should return "Azure Artifacts" for Azure feeds', () => {
      const source = new NuGetSource(
        'AzureFeed',
        'https://pkgs.dev.azure.com/myorg/_packaging/myfeed/nuget/v3/index.json',
        true,
        NuGetConfigScope.SolutionLocal,
        'C:\\Solution\\NuGet.Config'
      );

      expect(source.getFeedType()).toBe('Azure Artifacts');
    });

    it('should return "BaGet (or compatible)" for BaGet feeds', () => {
      const source = new NuGetSource(
        'BaGetFeed',
        'https://baget.example.com/v3/index.json',
        true,
        NuGetConfigScope.SolutionLocal,
        'C:\\Solution\\NuGet.Config'
      );

      expect(source.getFeedType()).toBe('BaGet (or compatible)');
    });

    it('should return "Private Feed" for other private feeds', () => {
      const source = new NuGetSource(
        'CustomFeed',
        'https://custom.example.com/nuget',
        true,
        NuGetConfigScope.SolutionLocal,
        'C:\\Solution\\NuGet.Config'
      );

      expect(source.getFeedType()).toBe('Private Feed');
    });
  });

  describe('getIdentifier', () => {
    it('should return name@scope identifier', () => {
      const source = new NuGetSource(
        'MyFeed',
        'https://example.com/nuget',
        true,
        NuGetConfigScope.SolutionLocal,
        'C:\\Solution\\NuGet.Config'
      );

      expect(source.getIdentifier()).toBe('MyFeed@SolutionLocal');
    });
  });
});
