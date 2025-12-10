import * as fs from 'fs';
import * as path from 'path';
import { GlobalJsonParser } from '../GlobalJsonParser';

// Mock filesystem
jest.mock('fs');
const mockFs = fs as jest.Mocked<typeof fs>;

describe('GlobalJsonParser', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('parse', () => {
    it('should parse valid global.json with SDK version', () => {
      const globalJsonContent = JSON.stringify({
        sdk: {
          version: '8.0.100',
          rollForward: 'latestMinor',
        },
      });

      mockFs.readFileSync.mockReturnValue(globalJsonContent);

      const result = GlobalJsonParser.parse('C:\\Projects\\global.json');

      expect(result).not.toBeNull();
      expect(result?.sdk?.version).toBe('8.0.100');
      expect(result?.sdk?.rollForward).toBe('latestMinor');
    });

    it('should return null for invalid JSON', () => {
      mockFs.readFileSync.mockReturnValue('Invalid JSON {]');

      const result = GlobalJsonParser.parse('C:\\Projects\\global.json');

      expect(result).toBeNull();
    });

    it('should handle global.json without SDK section', () => {
      const globalJsonContent = JSON.stringify({
        msbuild: {
          'sdk-resolvers': {
            version: '1.0.0',
          },
        },
      });

      mockFs.readFileSync.mockReturnValue(globalJsonContent);

      const result = GlobalJsonParser.parse('C:\\Projects\\global.json');

      expect(result).not.toBeNull();
      expect(result?.sdk).toBeUndefined();
      expect(result?.msbuild).toBeDefined();
    });
  });

  describe('getSdkVersion', () => {
    it('should extract SDK version from global.json', () => {
      const globalJsonContent = JSON.stringify({
        sdk: {
          version: '7.0.400',
        },
      });

      mockFs.readFileSync.mockReturnValue(globalJsonContent);

      const version = GlobalJsonParser.getSdkVersion('C:\\Projects\\global.json');

      expect(version).toBe('7.0.400');
    });

    it('should return null if no SDK section', () => {
      const globalJsonContent = JSON.stringify({});

      mockFs.readFileSync.mockReturnValue(globalJsonContent);

      const version = GlobalJsonParser.getSdkVersion('C:\\Projects\\global.json');

      expect(version).toBeNull();
    });

    it('should return null if SDK section has no version', () => {
      const globalJsonContent = JSON.stringify({
        sdk: {
          rollForward: 'latestMinor',
        },
      });

      mockFs.readFileSync.mockReturnValue(globalJsonContent);

      const version = GlobalJsonParser.getSdkVersion('C:\\Projects\\global.json');

      expect(version).toBeNull();
    });
  });

  describe('findGlobalJson', () => {
    it('should find global.json in current directory', () => {
      const startDir = 'C:\\Projects\\MyApp';
      const expectedPath = path.join(startDir, 'global.json');

      mockFs.existsSync.mockImplementation((p) => p === expectedPath);

      const result = GlobalJsonParser.findGlobalJson(startDir);

      expect(result).toBe(expectedPath);
    });

    it('should find global.json in parent directory', () => {
      const startDir = 'C:\\Projects\\MyApp\\src';
      const parentGlobalJson = 'C:\\Projects\\MyApp\\global.json';

      mockFs.existsSync.mockImplementation((p) => p === parentGlobalJson);

      const result = GlobalJsonParser.findGlobalJson(startDir);

      expect(result).toBe(parentGlobalJson);
    });

    it('should return null if no global.json found', () => {
      mockFs.existsSync.mockReturnValue(false);

      const result = GlobalJsonParser.findGlobalJson('C:\\Projects\\MyApp');

      expect(result).toBeNull();
    });

    it('should search up to root directory', () => {
      const startDir = 'C:\\Projects\\Deep\\Nested\\Path';

      mockFs.existsSync.mockReturnValue(false);

      const result = GlobalJsonParser.findGlobalJson(startDir);

      expect(result).toBeNull();
      expect(mockFs.existsSync).toHaveBeenCalled();
    });
  });

  describe('findSdkVersion', () => {
    it('should return SDK version and path when global.json exists', () => {
      const startDir = 'C:\\Projects\\MyApp';
      const globalJsonPath = path.join(startDir, 'global.json');
      const globalJsonContent = JSON.stringify({
        sdk: {
          version: '8.0.200',
        },
      });

      mockFs.existsSync.mockImplementation((p) => p === globalJsonPath);
      mockFs.readFileSync.mockReturnValue(globalJsonContent);

      const result = GlobalJsonParser.findSdkVersion(startDir);

      expect(result.version).toBe('8.0.200');
      expect(result.globalJsonPath).toBe(globalJsonPath);
    });

    it('should return null values when no global.json found', () => {
      mockFs.existsSync.mockReturnValue(false);

      const result = GlobalJsonParser.findSdkVersion('C:\\Projects\\MyApp');

      expect(result.version).toBeNull();
      expect(result.globalJsonPath).toBeNull();
    });

    it('should return null version when global.json has no SDK', () => {
      const startDir = 'C:\\Projects\\MyApp';
      const globalJsonPath = path.join(startDir, 'global.json');
      const globalJsonContent = JSON.stringify({});

      mockFs.existsSync.mockImplementation((p) => p === globalJsonPath);
      mockFs.readFileSync.mockReturnValue(globalJsonContent);

      const result = GlobalJsonParser.findSdkVersion(startDir);

      expect(result.version).toBeNull();
      expect(result.globalJsonPath).toBe(globalJsonPath);
    });
  });
});
