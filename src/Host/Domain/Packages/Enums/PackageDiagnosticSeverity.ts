/**
 * Severity level for package diagnostics
 */
export const PackageDiagnosticSeverity = {
  /**
   * Error - something is definitely wrong
   */
  Error: 'Error',

  /**
   * Warning - potential issue or misconfiguration
   */
  Warning: 'Warning',

  /**
   * Info - informational message
   */
  Info: 'Info',
} as const;

export type PackageDiagnosticSeverity =
  (typeof PackageDiagnosticSeverity)[keyof typeof PackageDiagnosticSeverity];
