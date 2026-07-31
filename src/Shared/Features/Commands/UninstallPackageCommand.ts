import { type ICommand } from "../../Abstractions/Messaging/ICommand";
import { type PackageWriteResultDto } from "../Dtos/PackageWriteResultDto";

/**
 * Désinstalle un package d'un projet, ou de tous les projets si
 * projectPath est absent. Sous CPM, le PackageVersion devenu orphelin est
 * retiré du Directory.Packages.props.
 */
export class UninstallPackageCommand implements ICommand<PackageWriteResultDto> {
  constructor(
    public readonly packageId: string,
    public readonly solutionPath: string,
    public readonly projectPath?: string,
  ) {}
}
