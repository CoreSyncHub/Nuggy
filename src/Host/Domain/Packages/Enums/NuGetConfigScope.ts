/**
 * Scope of a NuGet configuration file
 */
export const NuGetConfigScope = {
  /** Machine-wide configuration (e.g., C:\ProgramData\NuGet\NuGet.Config on Windows) */
  MachineWide: 'MachineWide',

  /** User-profile configuration (e.g., %APPDATA%\NuGet\NuGet.Config on Windows) */
  UserProfile: 'UserProfile',

  /** Solution-local configuration (NuGet.Config in solution directory or parent directories) */
  SolutionLocal: 'SolutionLocal',
} as const;

export type NuGetConfigScope = (typeof NuGetConfigScope)[keyof typeof NuGetConfigScope];
