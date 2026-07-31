import * as path from "path";
import { type BuildConfigFile } from "../../Domain/Build/Entities/BuildConfigFile";
import { BuildConfigFileType } from "../../Domain/Build/Enums/BuildConfigFileType";

/**
 * Trouve le `Directory.Packages.props` qui gouverne réellement un projet.
 *
 * MSBuild remonte l'arborescence depuis le projet et retient le premier fichier
 * rencontré : sur une solution qui en contient plusieurs (un par domaine, par
 * exemple), prendre « le premier trouvé » revient à écrire la version centrale
 * dans un fichier qui ne s'applique pas à ce projet — l'écriture réussit, et le
 * restore continue d'utiliser l'ancienne version.
 *
 * Rend `undefined` quand aucun fichier n'est un ancêtre du projet : ce projet
 * n'est alors pas sous gestion centralisée, quoi qu'il existe ailleurs dans la
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
    // Le plus profond des ancêtres est le plus proche du projet : c'est celui
    // que MSBuild retiendrait en remontant depuis le répertoire du projet.
    const depth = file.directory.split(path.sep).filter(Boolean).length;
    if (best === undefined || depth > best.depth) {
      best = { filePath: file.path, depth };
    }
  }

  return best?.filePath;
}

/** `candidate` est-il le répertoire de `target`, ou l'un de ses ancêtres ? */
function isAncestorDirectory(candidate: string, target: string): boolean {
  const relative = path.relative(candidate, target);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}
