import * as fs from 'fs';
import * as path from 'path';

/**
 * Represents the content of a global.json file
 */
export interface GlobalJson {
  sdk?: {
    version?: string;
    rollForward?: string;
    allowPrerelease?: boolean;
  };
  msbuild?: {
    'sdk-resolvers'?: {
      version?: string;
    };
  };
}

/**
 * Parser for global.json files
 * See: https://learn.microsoft.com/en-us/dotnet/core/tools/global-json
 */
export class GlobalJsonParser {
  /**
   * Searches for global.json file starting from a directory and going up
   */
  public static findGlobalJson(startDir: string): string | null {
    let currentDir = startDir;
    const root = path.parse(currentDir).root;

    while (currentDir !== root) {
      const globalJsonPath = path.join(currentDir, 'global.json');
      if (fs.existsSync(globalJsonPath)) {
        return globalJsonPath;
      }
      currentDir = path.dirname(currentDir);
    }

    // Check root directory
    const rootGlobalJson = path.join(root, 'global.json');
    if (fs.existsSync(rootGlobalJson)) {
      return rootGlobalJson;
    }

    return null;
  }

  /**
   * Parses a global.json file
   */
  public static parse(globalJsonPath: string): GlobalJson | null {
    try {
      const content = fs.readFileSync(globalJsonPath, 'utf-8');
      return JSON.parse(content) as GlobalJson;
    } catch {
      return null;
    }
  }

  /**
   * Gets the .NET SDK version from global.json
   */
  public static getSdkVersion(globalJsonPath: string): string | null {
    const globalJson = this.parse(globalJsonPath);
    return globalJson?.sdk?.version ?? null;
  }

  /**
   * Finds and returns the .NET SDK version for a given directory
   */
  public static findSdkVersion(startDir: string): {
    version: string | null;
    globalJsonPath: string | null;
  } {
    const globalJsonPath = this.findGlobalJson(startDir);
    if (!globalJsonPath) {
      return { version: null, globalJsonPath: null };
    }

    const version = this.getSdkVersion(globalJsonPath);
    return { version, globalJsonPath };
  }
}
