import { IQuery } from '../../Abstractions/Messaging/IQuery';
import { BuildConfigStructureDto } from '../Dtos/BuildConfigDto';

/**
 * Query to get all MSBuild configuration files in the workspace
 * Includes Directory.Build.props, Directory.Build.targets, and Directory.Packages.props
 */
export class GetBuildConfigurationFilesQuery implements IQuery<BuildConfigStructureDto> {
  /**
   * @param solutionPath Optional: Limit scan to a specific solution directory
   */
  constructor(public readonly solutionPath?: string) {}
}
