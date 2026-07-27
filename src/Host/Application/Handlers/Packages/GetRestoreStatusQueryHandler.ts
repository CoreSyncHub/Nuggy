import { injectable } from "tsyringe";
import { type IQueryHandler } from "@Shared/Abstractions/Messaging/IQueryHandler";
import { HandlerFor } from "@Shared/Infrastructure/Messaging/HandlerFor";
import { GetRestoreStatusQuery } from "@Shared/Features/Queries/GetRestoreStatusQuery";
import { type RestoreStatusDto } from "@Shared/Features/Dtos/RestoreStatusDto";
import { RestoreScheduler } from "@Infrastructure/MsBuild/RestoreScheduler";

@injectable()
@HandlerFor(GetRestoreStatusQuery)
export class GetRestoreStatusQueryHandler implements IQueryHandler<
  GetRestoreStatusQuery,
  RestoreStatusDto
> {
  constructor(private readonly restoreScheduler: RestoreScheduler) {}

  async Handle(_query: GetRestoreStatusQuery): Promise<RestoreStatusDto> {
    return this.restoreScheduler.getStatus();
  }
}
