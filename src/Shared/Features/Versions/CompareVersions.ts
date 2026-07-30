/**
 * Comparaison de versions NuGet (SemVer 2.0.0), partagée par le Host (tri des
 * versions d'une registration) et la webview (détection d'une mise à jour
 * disponible). Fonctions pures, sans I/O : elles vivent en Shared pour ne pas
 * obliger le bundle webview à importer un handler Host (et ses dépendances fs
 * et vscode) pour une simple comparaison.
 */

/** Tri décroissant : composantes numériques, préversion après la stable de même numéro (SemVer 2.0.0). */
export function compareVersionsDesc(a: string, b: string): number {
  const [aBase, aPre] = splitPrerelease(stripBuildMetadata(a));
  const [bBase, bPre] = splitPrerelease(stripBuildMetadata(b));
  const aParts = aBase.split(".").map(toNumberOrZero);
  const bParts = bBase.split(".").map(toNumberOrZero);
  for (let i = 0; i < Math.max(aParts.length, bParts.length); i++) {
    const diff = (bParts[i] ?? 0) - (aParts[i] ?? 0);
    if (diff !== 0) {
      return diff;
    }
  }
  if (aPre === undefined && bPre === undefined) {
    return 0;
  }
  if (aPre === undefined) {
    return -1;
  } // stable avant la préversion de même base
  if (bPre === undefined) {
    return 1;
  }
  return comparePrereleaseIdentifiers(bPre, aPre);
}

/** Retire les métadonnées de build ('+...') qui ne participent pas à la précédence SemVer. */
function stripBuildMetadata(version: string): string {
  const plusIndex = version.indexOf("+");
  return plusIndex === -1 ? version : version.slice(0, plusIndex);
}

/** Sépare la base ('X.Y.Z') de la préversion sur le premier '-' seulement. */
function splitPrerelease(version: string): [string, string | undefined] {
  const dashIndex = version.indexOf("-");
  return dashIndex === -1
    ? [version, undefined]
    : [version.slice(0, dashIndex), version.slice(dashIndex + 1)];
}

/** Composante non numérique (ex. build metadata résiduelle) : ne fait pas échouer la comparaison. */
function toNumberOrZero(component: string): number {
  const n = Number(component);
  return Number.isNaN(n) ? 0 : n;
}

/**
 * Comparaison ASCENDANTE des identifiants de préversion, séparés par '.', selon SemVer 2.0.0 §11 :
 * les identifiants numériques se comparent numériquement, un identifiant numérique est toujours
 * plus petit qu'un identifiant alphanumérique, les identifiants alphanumériques se comparent en
 * ordre ASCII, et un jeu d'identifiants plus court est plus petit lorsque les identifiants communs
 * sont égaux.
 */
function comparePrereleaseIdentifiers(x: string, y: string): number {
  const xIds = x.split(".");
  const yIds = y.split(".");
  const length = Math.max(xIds.length, yIds.length);
  for (let i = 0; i < length; i++) {
    if (xIds[i] === undefined) {
      return -1;
    }
    if (yIds[i] === undefined) {
      return 1;
    }
    const xIsNumeric = /^\d+$/.test(xIds[i]);
    const yIsNumeric = /^\d+$/.test(yIds[i]);
    if (xIsNumeric && yIsNumeric) {
      const diff = Number(xIds[i]) - Number(yIds[i]);
      if (diff !== 0) {
        return diff;
      }
      continue;
    }
    if (xIsNumeric !== yIsNumeric) {
      return xIsNumeric ? -1 : 1;
    }
    if (xIds[i] !== yIds[i]) {
      return xIds[i] < yIds[i] ? -1 : 1;
    }
  }
  return 0;
}
