import { ICommand } from '../../Abstractions/Messaging/ICommand';

/**
 * Command to select a solution and persist the choice in workspace settings
 */
export class SelectSolutionCommand implements ICommand<void> {
  /**
   * @param solutionPath Absolute path to the solution file to select (null to clear selection)
   */
  constructor(public readonly solutionPath: string | null) {}
}
