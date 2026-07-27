import { type ICommand } from "../../Abstractions/Messaging/ICommand";
import { type PackageWriteResultDto } from "../Dtos/PackageWriteResultDto";

/**
 * Met à jour la version d'un package sur un projet, ou partout où il est
 * installé si projectPath est absent. Sous CPM : écriture unique
 * solution-wide dans Directory.Packages.props.
 */
export class UpgradePackageCommand implements ICommand<PackageWriteResultDto> {
  constructor(
    public readonly packageId: string,
    public readonly version: string,
    public readonly solutionPath: string,
    public readonly projectPath?: string
  ) {}
}
