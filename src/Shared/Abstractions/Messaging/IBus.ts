import { CancellationToken } from 'vscode';
import { IRequest } from './IRequest';
import { InjectionToken } from '../../InjectionToken';

/**
 * Abstraction for sending requests to their handlers.
 * Can be implemented as a local bus (in-process) or remote bus (cross-boundary communication).
 */
export interface IBus {
  /**
   * Sends a request and returns the response.
   * The bus is responsible for routing the request to the appropriate handler,
   * whether locally or remotely.
   * @template TResponse The type of response expected from the request.
   * @param request The request to be sent.
   * @param cancellationToken Optional cancellation token.
   * @returns A promise that resolves to the response from the handler.
   */
  Send<TResponse>(
    request: IRequest<TResponse>,
    cancellationToken?: CancellationToken
  ): Promise<TResponse>;
}

export const BUS = new InjectionToken<IBus>('IBus');
