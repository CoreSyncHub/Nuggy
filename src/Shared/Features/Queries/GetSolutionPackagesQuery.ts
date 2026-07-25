import { type IQuery } from "../../Abstractions/Messaging/IQuery";
import { type SolutionPackagesDto } from "../Dtos/SolutionPackagesDto";

/**
 * Query d'agrégation locale : packages consolidés de la solution, sans réseau.
 */
export class GetSolutionPackagesQuery implements IQuery<SolutionPackagesDto> {
  constructor(public readonly solutionPath: string) {}
}
