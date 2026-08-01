import { type ICommand } from "../../Abstractions/Messaging/ICommand";
import { type PackageWriteResultDto } from "../Dtos/PackageWriteResultDto";

/**
 * Uninstalls a package from one project, or from every project when projectPath
 * is absent. Under CPM, the PackageVersion left orphaned is removed from the
 * Directory.Packages.props.
 */
export class UninstallPackageCommand implements ICommand<PackageWriteResultDto> {
  constructor(
    public readonly packageId: string,
    public readonly solutionPath: string,
    public readonly projectPath?: string,
  ) {}
}
