import { type IQuery } from "../../Abstractions/Messaging/IQuery";
import { type RestoreStatusDto } from "../Dtos/RestoreStatusDto";

/**
 * Query for the status of the last dotnet restore scheduled by the Host.
 */
export class GetRestoreStatusQuery implements IQuery<RestoreStatusDto> {}
