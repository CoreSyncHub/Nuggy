/**
 * Validation d'entrée des trois commandes d'écriture (Install/Upgrade/Uninstall) : première
 * ligne de défense contre l'injection MSBuild (Finding 3a). `MsBuildTextEditor` refuse déjà
 * toute valeur d'attribut porteuse de `" ' < > &` (Finding 3b) — cette validation-ci rejette
 * la commande AVANT toute résolution de cible ou tentative d'écriture disque, avec un message
 * d'erreur explicite plutôt qu'un `EditResult.ok === false` générique remonté plus tard.
 */
const PACKAGE_ID_PATTERN = /^[A-Za-z0-9_.-]+$/;
const VERSION_PATTERN = /^[0-9A-Za-z.+*-]+$/;

export function isValidPackageId(packageId: string): boolean {
  return PACKAGE_ID_PATTERN.test(packageId);
}

export function isValidVersion(version: string): boolean {
  return VERSION_PATTERN.test(version);
}
