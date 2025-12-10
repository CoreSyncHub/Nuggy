import { IQuery } from '../../Abstractions/Messaging/IQuery';
import { SolutionStructureDto } from '../Dtos/SolutionDto';

/**
 * Query to get the complete structure of a solution
 */
export class GetSolutionStructureQuery implements IQuery<SolutionStructureDto> {
  /**
   * @param solutionPath Absolute path to the solution file (.sln or .slnx)
   */
  constructor(public readonly solutionPath: string) {}
}
