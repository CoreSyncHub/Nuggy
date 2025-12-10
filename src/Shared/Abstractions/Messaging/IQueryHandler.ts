import { IRequestHandler } from './IRequestHandler';

/**
 * Defines a handler for a query.
 * @template TQuery The type of query being handled.
 * @template TResponse The type of response from the handler.
 */
export interface IQueryHandler<TQuery, TResponse> extends IRequestHandler<TQuery, TResponse> {}
