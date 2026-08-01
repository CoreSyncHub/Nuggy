import { type ICommand } from "../../Abstractions/Messaging/ICommand";
import { type PackageWriteResultDto } from "../Dtos/PackageWriteResultDto";

/**
 * Updates the version of a package on one project, or everywhere it is installed
 * when projectPath is absent. Under CPM: a single write
 * solution-wide dans Directory.Packages.props.
 */
export class UpgradePackageCommand implements ICommand<PackageWriteResultDto> {
  constructor(
    public readonly packageId: string,
    public readonly version: string,
    public readonly solutionPath: string,
    public readonly projectPath?: string,
  ) {}
}
