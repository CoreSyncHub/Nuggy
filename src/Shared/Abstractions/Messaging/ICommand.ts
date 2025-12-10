import { IRequest } from './IRequest';

/**
 * Represents a command that modifies state and returns a result.
 * @template TResponse The type of the response wrapped in a Result.
 */
export interface ICommand<TResponse> extends IRequest<TResponse> {}
