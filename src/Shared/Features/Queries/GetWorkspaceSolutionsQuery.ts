import { IQuery } from '../../Abstractions/Messaging/IQuery';
import { SolutionDto } from '../Dtos/SolutionDto';

/**
 * Query to get all solutions detected in the workspace
 */
export class GetWorkspaceSolutionsQuery implements IQuery<SolutionDto[]> {
  constructor() {}
}
