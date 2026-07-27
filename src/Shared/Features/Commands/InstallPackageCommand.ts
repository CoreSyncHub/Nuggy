import { type ICommand } from "../../Abstractions/Messaging/ICommand";
import { type PackageWriteResultDto } from "../Dtos/PackageWriteResultDto";

/**
 * Installe un package sur un projet, ou sur tous les projets compatibles
 * non équipés si projectPath est absent.
 */
export class InstallPackageCommand implements ICommand<PackageWriteResultDto> {
  constructor(
    public readonly packageId: string,
    public readonly version: string,
    public readonly solutionPath: string,
    public readonly projectPath?: string
  ) {}
}
