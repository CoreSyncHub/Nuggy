import { type ICommand } from "../../Abstractions/Messaging/ICommand";
import { type PackageWriteResultDto } from "../Dtos/PackageWriteResultDto";

/**
 * Installs a package on one project, or on every compatible project that does
 * not have it yet when projectPath is absent.
 */
export class InstallPackageCommand implements ICommand<PackageWriteResultDto> {
  constructor(
    public readonly packageId: string,
    public readonly version: string,
    public readonly solutionPath: string,
    public readonly projectPath?: string,
  ) {}
}
