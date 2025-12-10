import { CancellationToken } from 'vscode';
import { IBus } from '@Shared/Abstractions/Messaging/IBus';
import { IRequest } from '@Shared/Abstractions/Messaging/IRequest';
import { handlersMap, behaviorsMap } from '@Shared/Infrastructure/Messaging/HandlerRegistry';
import { RequestHandlerDelegate } from '@Shared/Abstractions/Behaviors/IPipelineBehavior';
import { injectable, container } from 'tsyringe';

/**
 * LocalBus executes requests in-process by resolving handlers from the DI container.
 * This is used by the Host to execute commands and queries locally.
 */
@injectable()
export class LocalBus implements IBus {
  private static readonly HandlerTypeCache = new Map<
    new (...args: any[]) => any,
    new (...args: any[]) => any
  >();

  public async Send<TResponse>(
    request: IRequest<TResponse>,
    cancellationToken?: CancellationToken
  ): Promise<TResponse> {
    if (!request) {
      throw new Error('Request cannot be null or undefined.');
    }

    const requestType = request.constructor as new (...args: any[]) => any;

    // Get the handler type from the registry
    let handlerType = LocalBus.HandlerTypeCache.get(requestType);
    if (!handlerType) {
      handlerType = handlersMap.get(requestType);
      if (!handlerType) {
        throw new Error(`No handler registered for request type: ${requestType.name}`);
      }
      LocalBus.HandlerTypeCache.set(requestType, handlerType);
    }

    // Resolve the handler from the DI container
    const handler: any = container.resolve(handlerType);

    // Get the behaviors from the DI container
    const behaviors: any[] = Array.from(behaviorsMap).map((behaviorType) =>
      container.resolve(behaviorType)
    );

    // Create the handler delegate
    const handlerDelegate: RequestHandlerDelegate<TResponse> = (ct?: CancellationToken) => {
      return handler.Handle(request, ct);
    };

    // Build the pipeline by wrapping the handler delegate with behaviors
    const pipeline = behaviors.reduceRight((next, behavior) => {
      return (ct?: CancellationToken) => behavior.Handle(request, next, ct);
    }, handlerDelegate);

    // Execute the pipeline
    return pipeline(cancellationToken);
  }
}
