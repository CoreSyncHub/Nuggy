import { injectable } from "tsyringe";
import { type ICommandHandler } from "@Shared/Abstractions/Messaging/ICommandHandler";
import { SelectSolutionCommand } from "@Shared/Features/Commands/SelectSolutionCommand";
import { HandlerFor } from "@Shared/Infrastructure/Messaging/HandlerFor";
import { SolutionDetector } from "@Infrastructure/Solution/SolutionDetector";

/**
 * Handler for SelectSolutionCommand
 * Persists the selected solution to workspace settings
 */
@injectable()
@HandlerFor(SelectSolutionCommand)
export class SelectSolutionCommandHandler implements ICommandHandler<SelectSolutionCommand, void> {
  constructor(private readonly solutionDetector: SolutionDetector) {}

  async Handle(command: SelectSolutionCommand): Promise<void> {
    if (command.solutionPath === null) {
      await this.solutionDetector.clearSelectedSolution();
    } else {
      await this.solutionDetector.setSelectedSolution(command.solutionPath);
    }
  }
}
