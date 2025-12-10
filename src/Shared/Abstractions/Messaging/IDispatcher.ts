import { CancellationToken } from 'vscode';
import { IRequest } from './IRequest';
import { InjectionToken } from '../../InjectionToken';

/**
 * Dispatches requests (commands and queries) to their handlers.
 */
export interface IDispatcher {
  /**
   * Sends a request to the appropriate handler.
   * @template TResponse The type of response expected from the request.
   * @param request  The request to be sent.
   * @returns A promise that resolves to the response from the handler.
   */
  Send<TResponse>(
    request: IRequest<TResponse>,
    cancellationToken?: CancellationToken
  ): Promise<TResponse>;
}

export const DISPATCHER = new InjectionToken<IDispatcher>('IDispatcher');
