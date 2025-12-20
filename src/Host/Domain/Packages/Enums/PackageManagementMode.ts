/**
 * Represents how package versions are managed in a project
 */
export const PackageManagementMode = {
  /**
   * Central Package Management (CPM) - versions defined in Directory.Packages.props
   */
  Central: 'Central',

  /**
   * Local management - each project defines its own versions
   */
  Local: 'Local',

  /**
   * Mixed mode - some packages centrally managed, others locally
   * This can indicate a transition state or misconfiguration
   */
  Mixed: 'Mixed',

  /**
   * Unknown - unable to determine the management mode
   */
  Unknown: 'Unknown',
} as const;

export type PackageManagementMode = (typeof PackageManagementMode)[keyof typeof PackageManagementMode];
