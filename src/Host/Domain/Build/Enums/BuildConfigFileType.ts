import { ObjectEnumType } from '@/Shared/Types/ObjetEnumType';

/**
 * Represents the type of MSBuild configuration file
 */
export const BuildConfigFileType = {
  /** Directory.Build.props - Properties applied before project imports */
  DirectoryBuildProps: 'Directory.Build.props',

  /** Directory.Build.targets - Targets applied after project imports */
  DirectoryBuildTargets: 'Directory.Build.targets',

  /** Directory.Packages.props - Central Package Management (CPM) */
  DirectoryPackagesProps: 'Directory.Packages.props',
} as const;

export type BuildConfigFileType = ObjectEnumType<typeof BuildConfigFileType>;
