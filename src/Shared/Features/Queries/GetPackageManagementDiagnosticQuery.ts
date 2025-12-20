import { IQuery } from '../../Abstractions/Messaging/IQuery';
import { PackageManagementDiagnosticDto } from '../Dtos/PackageManagementDto';

/**
 * Query to get package management diagnostic information
 * Analyzes CPM configuration and detects anomalies
 */
export class GetPackageManagementDiagnosticQuery implements IQuery<PackageManagementDiagnosticDto> {
  /**
   * @param solutionPath Path to the solution file (.sln or .slnx)
   */
  constructor(public readonly solutionPath: string) {}
}
