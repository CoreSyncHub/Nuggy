import * as fs from 'fs';
import { PackagesConfigParser } from '../PackagesConfigParser';
import { ILogger } from '../../../Application/Abstractions/Log/ILogger';

// Mock filesystem
jest.mock('fs');
// Force POSIX path semantics so the mocked-fs fixtures behave identically on
// every OS (path.win32.join would rewrite '/' to '\\' and break exact-string
// mocks). Platform-specific production code uses path.win32 explicitly.
jest.mock('path', () => jest.requireActual('path').posix);
const mockFs = fs as jest.Mocked<typeof fs>;

describe('PackagesConfigParser', () => {
  let parser: PackagesConfigParser;
  const mockLogger: ILogger = {
    Info: jest.fn(),
    Warning: jest.fn(),
    Error: jest.fn(),
    Debug: jest.fn(),
  };

  beforeEach(() => {
    jest.clearAllMocks();
    parser = new PackagesConfigParser(mockLogger);
  });

  describe('parse', () => {
    it('should parse packages from packages.config', () => {
      const content = `<?xml version="1.0" encoding="utf-8"?>
<packages>
  <package id="Newtonsoft.Json" version="13.0.3" targetFramework="net472" />
  <package id="Serilog" version="3.1.1" targetFramework="net472" />
  <package id="AutoMapper" version="12.0.1" targetFramework="net48" />
</packages>`;

      mockFs.readFileSync.mockReturnValue(content);

      const result = parser.parse(
        '/solution/Project1/packages.config',
        '/solution/Project1/Project1.csproj'
      );

      expect(result).toHaveLength(3);
      expect(result[0].name).toBe('Newtonsoft.Json');
      expect(result[0].version).toBe('13.0.3');
      expect(result[0].targetFramework).toBe('net472');
      expect(result[0].projectPath).toBe('/solution/Project1/Project1.csproj');
      expect(result[0].configPath).toBe('/solution/Project1/packages.config');

      expect(result[1].name).toBe('Serilog');
      expect(result[1].version).toBe('3.1.1');
      expect(result[1].targetFramework).toBe('net472');

      expect(result[2].name).toBe('AutoMapper');
      expect(result[2].version).toBe('12.0.1');
      expect(result[2].targetFramework).toBe('net48');
    });

    it('should handle packages without targetFramework', () => {
      const content = `<?xml version="1.0" encoding="utf-8"?>
<packages>
  <package id="Package1" version="1.0.0" />
</packages>`;

      mockFs.readFileSync.mockReturnValue(content);

      const result = parser.parse(
        '/solution/Project1/packages.config',
        '/solution/Project1/Project1.csproj'
      );

      expect(result).toHaveLength(1);
      expect(result[0].name).toBe('Package1');
      expect(result[0].version).toBe('1.0.0');
      expect(result[0].targetFramework).toBeUndefined();
    });

    it('should return empty array if packages.config is empty', () => {
      const content = `<?xml version="1.0" encoding="utf-8"?>
<packages>
</packages>`;

      mockFs.readFileSync.mockReturnValue(content);

      const result = parser.parse(
        '/solution/Project1/packages.config',
        '/solution/Project1/Project1.csproj'
      );

      expect(result).toHaveLength(0);
    });

    it('should return empty array if packages.config is malformed', () => {
      const content = `<?xml version="1.0" encoding="utf-8"?>
<invalid>
</invalid>`;

      mockFs.readFileSync.mockReturnValue(content);

      const result = parser.parse(
        '/solution/Project1/packages.config',
        '/solution/Project1/Project1.csproj'
      );

      expect(result).toHaveLength(0);
    });

    it('should handle errors gracefully', () => {
      mockFs.readFileSync.mockImplementation(() => {
        throw new Error('File not found');
      });

      const result = parser.parse(
        '/solution/Project1/packages.config',
        '/solution/Project1/Project1.csproj'
      );

      expect(result).toHaveLength(0);
      expect(mockLogger.Error).toHaveBeenCalledWith(
        expect.stringContaining('Error parsing packages.config'),
        expect.any(Error)
      );
    });

    it('should handle single package element', () => {
      const content = `<?xml version="1.0" encoding="utf-8"?>
<packages>
  <package id="SinglePackage" version="1.0.0" targetFramework="net472" />
</packages>`;

      mockFs.readFileSync.mockReturnValue(content);

      const result = parser.parse(
        '/solution/Project1/packages.config',
        '/solution/Project1/Project1.csproj'
      );

      expect(result).toHaveLength(1);
      expect(result[0].name).toBe('SinglePackage');
      expect(result[0].version).toBe('1.0.0');
    });
  });

  describe('findPackagesConfig', () => {
    it('should find packages.config in project directory', () => {
      const projectPath = '/solution/Project1/Project1.csproj';
      const expectedConfigPath = '/solution/Project1/packages.config';

      mockFs.existsSync.mockImplementation((filePath) => {
        return filePath === expectedConfigPath;
      });

      const result = parser.findPackagesConfig(projectPath);

      expect(result).toBe(expectedConfigPath);
    });

    it('should return undefined if packages.config does not exist', () => {
      const projectPath = '/solution/Project1/Project1.csproj';

      mockFs.existsSync.mockReturnValue(false);

      const result = parser.findPackagesConfig(projectPath);

      expect(result).toBeUndefined();
    });
  });

  describe('isLegacyProject', () => {
    it('should return true if packages.config exists', () => {
      const projectPath = '/solution/Project1/Project1.csproj';
      const expectedConfigPath = '/solution/Project1/packages.config';

      mockFs.existsSync.mockImplementation((filePath) => {
        return filePath === expectedConfigPath;
      });

      const result = parser.isLegacyProject(projectPath);

      expect(result).toBe(true);
    });

    it('should return false if packages.config does not exist', () => {
      const projectPath = '/solution/Project1/Project1.csproj';

      mockFs.existsSync.mockReturnValue(false);

      const result = parser.isLegacyProject(projectPath);

      expect(result).toBe(false);
    });
  });

  describe('parseMultiple', () => {
    it('should parse packages.config for multiple projects', () => {
      const projectPaths = [
        '/solution/Project1/Project1.csproj',
        '/solution/Project2/Project2.csproj',
        '/solution/Project3/Project3.csproj',
      ];

      const packagesConfig1 = `<?xml version="1.0" encoding="utf-8"?>
<packages>
  <package id="Package1" version="1.0.0" targetFramework="net472" />
</packages>`;

      const packagesConfig2 = `<?xml version="1.0" encoding="utf-8"?>
<packages>
  <package id="Package2" version="2.0.0" targetFramework="net48" />
</packages>`;

      mockFs.existsSync.mockImplementation((filePath) => {
        return (
          filePath === '/solution/Project1/packages.config' ||
          filePath === '/solution/Project2/packages.config'
        );
      });

      mockFs.readFileSync.mockImplementation((filePath) => {
        if (filePath === '/solution/Project1/packages.config') {
          return packagesConfig1;
        } else if (filePath === '/solution/Project2/packages.config') {
          return packagesConfig2;
        }
        throw new Error('File not found');
      });

      const result = parser.parseMultiple(projectPaths);

      expect(result.size).toBe(2);
      expect(result.has('/solution/Project1/Project1.csproj')).toBe(true);
      expect(result.has('/solution/Project2/Project2.csproj')).toBe(true);
      expect(result.has('/solution/Project3/Project3.csproj')).toBe(false);

      const project1Packages = result.get('/solution/Project1/Project1.csproj');
      expect(project1Packages).toHaveLength(1);
      expect(project1Packages![0].name).toBe('Package1');

      const project2Packages = result.get('/solution/Project2/Project2.csproj');
      expect(project2Packages).toHaveLength(1);
      expect(project2Packages![0].name).toBe('Package2');
    });

    it('should skip projects without packages.config', () => {
      const projectPaths = [
        '/solution/Project1/Project1.csproj',
        '/solution/Project2/Project2.csproj',
      ];

      mockFs.existsSync.mockReturnValue(false);

      const result = parser.parseMultiple(projectPaths);

      expect(result.size).toBe(0);
    });
  });
});
