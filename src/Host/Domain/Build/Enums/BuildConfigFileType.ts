/**
 * Represents the type of MSBuild configuration file
 */
export enum BuildConfigFileType {
  /** Directory.Build.props - Properties applied before project imports */
  DirectoryBuildProps = 'Directory.Build.props',

  /** Directory.Build.targets - Targets applied after project imports */
  DirectoryBuildTargets = 'Directory.Build.targets',

  /** Directory.Packages.props - Central Package Management (CPM) */
  DirectoryPackagesProps = 'Directory.Packages.props',
}
