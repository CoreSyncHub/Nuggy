import { injectable } from "tsyringe";
import { type IQueryHandler } from "@Shared/Abstractions/Messaging/IQueryHandler";
import { HandlerFor } from "@Shared/Infrastructure/Messaging/HandlerFor";
import { GetOperationLogQuery } from "@Shared/Features/Queries/GetOperationLogQuery";
import { type OperationLogDto } from "@Shared/Features/Dtos/OperationLogDto";
import { OperationLogStore } from "@Infrastructure/MsBuild/OperationLogStore";

@injectable()
@HandlerFor(GetOperationLogQuery)
export class GetOperationLogQueryHandler implements IQueryHandler<
  GetOperationLogQuery,
  OperationLogDto
> {
  constructor(private readonly operationLog: OperationLogStore) {}

  async Handle(_query: GetOperationLogQuery): Promise<OperationLogDto> {
    return { entries: this.operationLog.getEntries() };
  }
}
