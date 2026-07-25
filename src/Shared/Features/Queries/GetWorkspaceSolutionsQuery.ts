import { type IQuery } from '../../Abstractions/Messaging/IQuery';
import { type SolutionDto } from '../Dtos/SolutionDto';

/**
 * Query to get all solutions detected in the workspace
 */
export class GetWorkspaceSolutionsQuery implements IQuery<SolutionDto[]> {
  constructor() {}
}
