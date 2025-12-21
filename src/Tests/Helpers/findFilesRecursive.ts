import * as fs from 'fs';
import * as path from 'path';

/**
 * Helper function to recursively find files matching a pattern in a directory
 */
export function findFilesRecursive(dir: string, pattern: string): string[] {
  const results: string[] = [];

  if (!fs.existsSync(dir)) {
    return results;
  }

  const entries = fs.readdirSync(dir, { withFileTypes: true });

  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);

    // Skip node_modules and build outputs
    if (
      entry.name === 'node_modules' ||
      entry.name === '.git' ||
      entry.name === 'obj' ||
      entry.name === 'bin'
    ) {
      continue;
    }

    if (entry.isDirectory()) {
      results.push(...findFilesRecursive(fullPath, pattern));
    } else if (entry.name === pattern) {
      results.push(fullPath);
    }
  }

  return results;
}
