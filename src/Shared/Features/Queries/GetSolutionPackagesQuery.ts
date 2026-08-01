import { type IQuery } from "../../Abstractions/Messaging/IQuery";
import { type SolutionPackagesDto } from "../Dtos/SolutionPackagesDto";

/**
 * Local aggregation query: the solution's consolidated packages, no network.
 */
export class GetSolutionPackagesQuery implements IQuery<SolutionPackagesDto> {
  constructor(public readonly solutionPath: string) {}
}
