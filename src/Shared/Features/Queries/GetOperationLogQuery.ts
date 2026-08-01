import { type IQuery } from "../../Abstractions/Messaging/IQuery";
import { type OperationLogDto } from "../Dtos/OperationLogDto";

/**
 * Query for the session journal: restore runs plus write operations,
 * newest-first, bounded to 50 entries Host-side.
 */
export class GetOperationLogQuery implements IQuery<OperationLogDto> {}
