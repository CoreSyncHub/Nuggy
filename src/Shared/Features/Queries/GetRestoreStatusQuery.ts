import { type IQuery } from "../../Abstractions/Messaging/IQuery";
import { type RestoreStatusDto } from "../Dtos/RestoreStatusDto";

/**
 * Query du statut du dernier dotnet restore programmé par le Host.
 */
export class GetRestoreStatusQuery implements IQuery<RestoreStatusDto> {}
