import { IQuery } from '../../Abstractions/Messaging/IQuery';
import { ProjectsTfmDto } from '../Dtos/ProjectTfmDto';

/**
 * Query to get effective TFM information for all projects in a solution
 */
export class GetProjectsTfmQuery implements IQuery<ProjectsTfmDto> {
  /**
   * @param solutionPath Path to the solution file (.sln or .slnx)
   */
  constructor(public readonly solutionPath: string) {}
}
