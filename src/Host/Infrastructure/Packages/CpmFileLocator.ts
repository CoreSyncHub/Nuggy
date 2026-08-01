import * as path from "path";
import { type BuildConfigFile } from "../../Domain/Build/Entities/BuildConfigFile";
import { BuildConfigFileType } from "../../Domain/Build/Enums/BuildConfigFileType";

/**
 * Finds the `Directory.Packages.props` that actually governs a project.
 *
 * MSBuild walks up the tree from the project and keeps the first file it meets:
 * on a solution holding several of them (one per domain, for instance), taking
 * "the first one found" means writing the central version into a file that does
 * not apply to that project — the write succeeds, and restore keeps using the
 * old version.
 *
 * Returns `undefined` when no file is an ancestor of the project: that project
 * is then not under central management, whatever exists elsewhere in the
 * solution.
 */
export function findGoverningCpmFile(
  projectPath: string,
  buildConfigFiles: BuildConfigFile[],
): string | undefined {
  const projectDir = path.dirname(projectPath);
  let best: { filePath: string; depth: number } | undefined;

  for (const file of buildConfigFiles) {
    if (file.type !== BuildConfigFileType.DirectoryPackagesProps) {
      continue;
    }
    if (!isAncestorDirectory(file.directory, projectDir)) {
      continue;
    }
    // The deepest ancestor is the closest to the project: it is the one MSBuild
    // would keep while walking up from the project directory.
    const depth = file.directory.split(path.sep).filter(Boolean).length;
    if (best === undefined || depth > best.depth) {
      best = { filePath: file.path, depth };
    }
  }

  return best?.filePath;
}

/** Is `candidate` the directory of `target`, or one of its ancestors? */
function isAncestorDirectory(candidate: string, target: string): boolean {
  const relative = path.relative(candidate, target);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}
