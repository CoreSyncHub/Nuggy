import { CancellationToken } from 'vscode';

export type RequestHandlerDelegate<TResponse> = (
  cancellationToken?: CancellationToken
) => Promise<TResponse>;

export interface IPipelineBehavior<TRequest, TResponse> {
  /**
   * Handles a request in the pipeline.
   * @param request The incoming request.
   * @param next The delegate for the next action in the pipeline.
   * @param cancellationToken Cancellation token.
   * @returns The response.
   */
  Handle(
    request: TRequest,
    next: RequestHandlerDelegate<TResponse>,
    cancellationToken?: CancellationToken
  ): Promise<TResponse>;
}
