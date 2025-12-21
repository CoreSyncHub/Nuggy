import { PackageSourceMapping } from '../PackageSourceMapping';

describe('PackageSourceMapping', () => {
  describe('matches', () => {
    it('should match exact package ID', () => {
      const mapping = new PackageSourceMapping('Newtonsoft.Json', ['nuget.org']);

      expect(mapping.matches('Newtonsoft.Json')).toBe(true);
      expect(mapping.matches('Newtonsoft.Json.Schema')).toBe(false);
    });

    it('should match wildcard pattern with *', () => {
      const mapping = new PackageSourceMapping('Microsoft.*', ['nuget.org']);

      expect(mapping.matches('Microsoft.Extensions.Logging')).toBe(true);
      expect(mapping.matches('Microsoft.AspNetCore.Mvc')).toBe(true);
      expect(mapping.matches('Newtonsoft.Json')).toBe(false);
    });

    it('should match all packages with * pattern', () => {
      const mapping = new PackageSourceMapping('*', ['nuget.org']);

      expect(mapping.matches('Newtonsoft.Json')).toBe(true);
      expect(mapping.matches('Microsoft.Extensions.Logging')).toBe(true);
      expect(mapping.matches('Any.Package.Name')).toBe(true);
    });

    it('should match complex wildcard patterns', () => {
      const mapping = new PackageSourceMapping('Contoso.*.Core', ['MyFeed']);

      expect(mapping.matches('Contoso.Api.Core')).toBe(true);
      expect(mapping.matches('Contoso.Web.Core')).toBe(true);
      expect(mapping.matches('Contoso.Core')).toBe(false);
      expect(mapping.matches('Contoso.Api.Core.Extensions')).toBe(false);
    });

    it('should be case-insensitive', () => {
      const mapping = new PackageSourceMapping('Microsoft.*', ['nuget.org']);

      expect(mapping.matches('microsoft.extensions.logging')).toBe(true);
      expect(mapping.matches('MICROSOFT.ASPNETCORE.MVC')).toBe(true);
    });

    it('should handle multiple wildcards', () => {
      const mapping = new PackageSourceMapping('*.Extensions.*', ['nuget.org']);

      expect(mapping.matches('Microsoft.Extensions.Logging')).toBe(true);
      expect(mapping.matches('System.Extensions.Configuration')).toBe(true);
      expect(mapping.matches('Newtonsoft.Json')).toBe(false);
    });
  });

  describe('sourceNames', () => {
    it('should store multiple source names', () => {
      const mapping = new PackageSourceMapping('Microsoft.*', ['nuget.org', 'MyFeed']);

      expect(mapping.sourceNames).toHaveLength(2);
      expect(mapping.sourceNames).toContain('nuget.org');
      expect(mapping.sourceNames).toContain('MyFeed');
    });
  });
});
