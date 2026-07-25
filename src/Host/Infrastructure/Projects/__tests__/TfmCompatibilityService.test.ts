import { TfmCompatibilityService } from '../TfmCompatibilityService';

describe('TfmCompatibilityService', () => {
  const service = new TfmCompatibilityService();

  describe('verdicts Compatible', () => {
    it.each([
      ['net8.0', ['net8.0']],
      ['net8.0', ['net6.0']],
      ['net8.0', ['netstandard2.0']],
      ['net8.0', ['netstandard2.1']],
      ['net8.0', ['netcoreapp3.1']],
      ['net6.0', ['.NETStandard2.0']],
      ['netcoreapp3.1', ['netstandard2.1']],
      ['netcoreapp2.1', ['netstandard2.0']],
      ['net48', ['netstandard2.0']],
      ['net472', ['netstandard2.0']],
      ['net461', ['netstandard2.0']],
      ['net45', ['.NETFramework4.5']],
      ['net45', ['netstandard1.1']],
      ['net8.0-windows', ['net8.0']],
      ['net8.0-windows', ['net6.0-windows']],
      // Un seul framework compatible dans la liste suffit
      ['net472', ['netstandard2.1', 'netstandard2.0']],
    ])('projet %s ← package %j', (project, pkg) => {
      expect(service.isCompatible(project, pkg).verdict).toBe('Compatible');
    });

    it('package sans groupes de dépendances → Compatible', () => {
      expect(service.isCompatible('net8.0', []).verdict).toBe('Compatible');
    });
  });

  describe('verdicts Incompatible', () => {
    it.each([
      ['net6.0', ['net8.0']],
      ['net472', ['netstandard2.1']],
      ['net45', ['netstandard2.0']],
      ['netcoreapp2.1', ['netstandard2.1']],
      ['net8.0', ['net8.0-windows']], // plateforme requise absente
      ['net472', ['netcoreapp3.1']],
      ['netstandard2.0', ['net8.0']],
    ])('projet %s ← package %j', (project, pkg) => {
      const result = service.isCompatible(project, pkg);
      expect(result.verdict).toBe('Incompatible');
      expect(result.reason).toBeTruthy();
    });
  });

  describe('verdicts Unknown', () => {
    it.each([
      ['uap10.0', ['netstandard2.0']],       // TFM projet non couvert
      ['net8.0', ['portable-net45+win8']],   // TFM package non couvert, aucun autre compatible
    ])('projet %s ← package %j', (project, pkg) => {
      expect(service.isCompatible(project, pkg).verdict).toBe('Unknown');
    });

    it('un TFM package inconnu mais un autre compatible → Compatible', () => {
      expect(service.isCompatible('net8.0', ['portable-net45+win8', 'netstandard2.0']).verdict)
        .toBe('Compatible');
    });
  });
});
