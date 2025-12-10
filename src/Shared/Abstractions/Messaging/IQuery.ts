import { IRequest } from './IRequest';

/**
 * Represents a query that reads state and returns a result.
 * @template TResponse The type of the response wrapped in a Result.
 */
export interface IQuery<TResponse> extends IRequest<TResponse> {}
