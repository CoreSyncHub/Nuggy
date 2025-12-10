import { CancellationToken } from 'vscode';

/**
 * Defines a handler for a request.
 * @template TRequest The type of request being handled.
 * @template TResponse The type of response from the handler.
 */
export interface IRequestHandler<in TRequest, TResponse> {
  /**
   * Handles a request.
   * @param request The request to handle.
   * @param cancellationToken Cancellation token.
   * @returns Response from the request.
   */
  Handle(request: TRequest, cancellationToken?: CancellationToken): Promise<TResponse>;
}
