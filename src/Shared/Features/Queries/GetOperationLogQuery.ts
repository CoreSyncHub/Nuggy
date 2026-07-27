import { type IQuery } from "../../Abstractions/Messaging/IQuery";
import { type OperationLogDto } from "../Dtos/OperationLogDto";

/**
 * Query du journal de session : runs de restore + opérations d'écriture,
 * anté-chronologique, borné à 50 entrées côté Host.
 */
export class GetOperationLogQuery implements IQuery<OperationLogDto> {}
