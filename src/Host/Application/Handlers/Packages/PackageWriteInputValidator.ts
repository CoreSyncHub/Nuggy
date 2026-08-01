/**
 * Validates the input for package write commands (Install, Upgrade, Uninstall) to prevent MSBuild injection.
 * This is the first line of defense against potential injection attacks (Finding 3a). The `MsBuildTextEditor`
 * already rejects any attribute values containing `" ' < > &` (Finding 3b). This validation ensures that
 * the command is rejected before any target resolution or disk write attempts, providing a clear error
 * message instead of a generic `EditResult.ok === false` later on.
 */
const PACKAGE_ID_PATTERN = /^[A-Za-z0-9_.-]+$/;
const VERSION_PATTERN = /^[0-9A-Za-z.+*-]+$/;

export function isValidPackageId(packageId: string): boolean {
  return PACKAGE_ID_PATTERN.test(packageId);
}

export function isValidVersion(version: string): boolean {
  return VERSION_PATTERN.test(version);
}
