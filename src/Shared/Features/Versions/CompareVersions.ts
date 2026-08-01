/**
 * NuGet version comparison (SemVer 2.0.0), shared by the Host (sorting the
 * versions of a registration) and the webview (detecting an available update).
 * Pure functions, no I/O: they live in Shared so the webview bundle never has to
 * import a Host handler — and its fs and vscode dependencies — just to compare
 * two versions.
 */

/** Descending order: numeric components, prerelease after the stable of the same number (SemVer 2.0.0). */
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
  } // stable before the prerelease of the same base
  if (bPre === undefined) {
    return 1;
  }
  return comparePrereleaseIdentifiers(bPre, aPre);
}

/** Strips build metadata ('+...'), which takes no part in SemVer precedence. */
function stripBuildMetadata(version: string): string {
  const plusIndex = version.indexOf("+");
  return plusIndex === -1 ? version : version.slice(0, plusIndex);
}

/** Splits the base ('X.Y.Z') from the prerelease on the first '-' only. */
function splitPrerelease(version: string): [string, string | undefined] {
  const dashIndex = version.indexOf("-");
  return dashIndex === -1
    ? [version, undefined]
    : [version.slice(0, dashIndex), version.slice(dashIndex + 1)];
}

/** Non-numeric component (e.g. leftover build metadata): must not fail the comparison. */
function toNumberOrZero(component: string): number {
  const n = Number(component);
  return Number.isNaN(n) ? 0 : n;
}

/**
 * ASCENDING comparison of prerelease identifiers, separated by '.', per SemVer
 * 2.0.0 §11: numeric identifiers compare numerically, a numeric identifier is
 * always lower than an alphanumeric one, alphanumeric identifiers compare in
 * ASCII order, and a shorter set of identifiers is lower when the shared
 * identifiers are equal.
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
