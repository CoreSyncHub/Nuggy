import { type IQuery } from "../../Abstractions/Messaging/IQuery";
import { type PackageUpdateInfoDto } from "../Dtos/PackageUpdateInfoDto";

/**
 * Network query (nuget.org + cache): versions, metadata and per-project
 * compatibility verdicts for a package.
 */
export class GetPackageUpdateInfoQuery implements IQuery<PackageUpdateInfoDto> {
  constructor(
    public readonly packageId: string,
    public readonly solutionPath: string,
  ) {}
}
