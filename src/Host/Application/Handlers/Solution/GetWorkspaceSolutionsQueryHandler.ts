import { injectable } from 'tsyringe';
import { IQueryHandler } from '@Shared/Abstractions/Messaging/IQueryHandler';
import { GetWorkspaceSolutionsQuery } from '@Shared/Features/Queries/GetWorkspaceSolutionsQuery';
import { SolutionDto } from '@Shared/Features/Dtos/SolutionDto';
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
  async Handle(_: GetWorkspaceSolutionsQuery): Promise<SolutionDto[]> {
    // Find all solutions in the workspace
    const detectedSolutions = await SolutionDetector.findAllSolutions();

    // Get the currently selected solution
    const selectedSolution = SolutionDetector.getSelectedSolution();

    // Map to DTOs
    return detectedSolutions.map((solution) => ({
      path: solution.path,
      name: solution.name,
      format: solution.format,
      workspaceFolder: solution.workspaceFolder.name,
      isSelected: solution.path === selectedSolution,
    }));
  }
}
