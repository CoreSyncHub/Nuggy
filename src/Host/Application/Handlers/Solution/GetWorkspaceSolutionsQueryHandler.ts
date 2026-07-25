import { injectable } from 'tsyringe';
import { type IQueryHandler } from '@Shared/Abstractions/Messaging/IQueryHandler';
import { GetWorkspaceSolutionsQuery } from '@Shared/Features/Queries/GetWorkspaceSolutionsQuery';
import { type SolutionDto } from '@Shared/Features/Dtos/SolutionDto';
import { HandlerFor } from '@Shared/Infrastructure/Messaging/HandlerFor';
import { SolutionDetector } from '@Infrastructure/Solution/SolutionDetector';

/**
 * Handler for GetWorkspaceSolutionsQuery
 * Returns all detected solutions in the workspace
 */
@injectable()
@HandlerFor(GetWorkspaceSolutionsQuery)
export class GetWorkspaceSolutionsQueryHandler
  implements IQueryHandler<GetWorkspaceSolutionsQuery, SolutionDto[]>
{
  constructor(private readonly solutionDetector: SolutionDetector) {}

  async Handle(_: GetWorkspaceSolutionsQuery): Promise<SolutionDto[]> {
    const detectedSolutions = await this.solutionDetector.findAllSolutions();
    const selectedSolution = this.solutionDetector.getSelectedSolution();

    return detectedSolutions.map((solution) => ({
      path: solution.path,
      name: solution.name,
      format: solution.format,
      workspaceFolder: solution.workspaceFolder.name,
      isSelected: solution.path === selectedSolution,
    }));
  }
}
