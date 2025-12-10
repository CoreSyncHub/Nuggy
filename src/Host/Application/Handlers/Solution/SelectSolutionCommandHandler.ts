import { injectable } from 'tsyringe';
import { ICommandHandler } from '../../../../Shared/Abstractions/Messaging/ICommandHandler';
import { SelectSolutionCommand } from '../../../../Shared/Features/Commands/SelectSolutionCommand';
import { HandlerFor } from '../../../../Shared/Infrastructure/Messaging/HandlerFor';
import { SolutionDetector } from '../../../Infrastructure/Solution/SolutionDetector';

/**
 * Handler for SelectSolutionCommand
 * Persists the selected solution to workspace settings
 */
@injectable()
@HandlerFor(SelectSolutionCommand)
export class SelectSolutionCommandHandler
  implements ICommandHandler<SelectSolutionCommand, void>
{
  async Handle(command: SelectSolutionCommand): Promise<void> {
    if (command.solutionPath === null) {
      // Clear selection
      await SolutionDetector.clearSelectedSolution();
    } else {
      // Set selection
      await SolutionDetector.setSelectedSolution(command.solutionPath);
    }
  }
}
