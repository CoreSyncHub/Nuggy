import { NuGetFramework } from '../NuGetFramework';

describe('NuGetFramework', () => {
  describe('parse - formats courts (csproj)', () => {
    it.each([
      ['net8.0', 'net5plus', 8, 0, undefined],
      ['net5.0', 'net5plus', 5, 0, undefined],
      ['net8.0-windows', 'net5plus', 8, 0, 'windows'],
      ['net8.0-windows10.0.19041.0', 'net5plus', 8, 0, 'windows'],
      ['netstandard2.0', 'netstandard', 2, 0, undefined],
      ['netstandard2.1', 'netstandard', 2, 1, undefined],
      ['netcoreapp3.1', 'netcoreapp', 3, 1, undefined],
      ['net472', 'netframework', 4, 7, undefined],
      ['net48', 'netframework', 4, 8, undefined],
      ['net45', 'netframework', 4, 5, undefined],
    ])('parse %s → %s %i.%i (plateforme %s)', (tfm, family, major, minor, platform) => {
      const fw = NuGetFramework.parse(tfm);
      expect(fw.family).toBe(family);
      expect(fw.major).toBe(major);
      expect(fw.minor).toBe(minor);
      expect(fw.platform).toBe(platform);
    });

    it('parse net472 expose le patch', () => {
      expect(NuGetFramework.parse('net472').patch).toBe(2);
    });
  });

  describe('parse - formats longs (registration nuget.org)', () => {
    it.each([
      ['.NETStandard2.0', 'netstandard', 2, 0],
      ['.NETFramework4.5', 'netframework', 4, 5],
      ['.NETCoreApp3.1', 'netcoreapp', 3, 1],
      ['net6.0', 'net5plus', 6, 0],
    ])('parse %s → %s %i.%i', (tfm, family, major, minor) => {
      const fw = NuGetFramework.parse(tfm);
      expect(fw.family).toBe(family);
      expect(fw.major).toBe(major);
      expect(fw.minor).toBe(minor);
    });
  });

  describe('parse - TFM non couverts', () => {
    it.each([['portable-net45+win8'], ['uap10.0'], ['xamarin.ios'], [''], ['n importe quoi']])(
      'parse %s → unknown',
      (tfm) => {
        expect(NuGetFramework.parse(tfm).family).toBe('unknown');
      }
    );
  });
});
