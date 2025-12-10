import { behaviorsMap } from '../../Infrastructure/Messaging/HandlerRegistry';
import { IPipelineBehavior } from './IPipelineBehavior';

/**
 * Decorator to register a behavior in the pipeline.
 * Behaviors are executed in the order they are registered.
 * @example
 * @Behavior()
 * class LoggingBehavior<TRequest, TResponse> implements IPipelineBehavior<TRequest, TResponse> {
 *   async Handle(request: TRequest, next: RequestHandlerDelegate<TResponse>): Promise<TResponse> {
 *     console.log('Executing request:', request);
 *     return next();
 *   }
 * }
 */
export function Behavior<TRequest = any, TResponse = any>() {
  return function (target: new (...args: any[]) => IPipelineBehavior<TRequest, TResponse>) {
    behaviorsMap.add(target);
  };
}
