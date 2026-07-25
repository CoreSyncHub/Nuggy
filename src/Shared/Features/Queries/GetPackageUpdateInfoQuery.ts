import { type IQuery } from '../../Abstractions/Messaging/IQuery';
import { type PackageUpdateInfoDto } from '../Dtos/PackageUpdateInfoDto';

/**
 * Query réseau (nuget.org + cache) : versions, métadonnées et verdicts
 * de compatibilité par projet pour un package.
 */
export class GetPackageUpdateInfoQuery implements IQuery<PackageUpdateInfoDto> {
  constructor(
    public readonly packageId: string,
    public readonly solutionPath: string
  ) {}
}
