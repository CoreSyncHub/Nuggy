import { IRequestHandler } from './IRequestHandler';

export interface ICommandHandler<TCommand, TResponse>
  extends IRequestHandler<TCommand, TResponse> {}
