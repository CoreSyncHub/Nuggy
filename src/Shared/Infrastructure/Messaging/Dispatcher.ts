import { CancellationToken } from 'vscode';
import { IDispatcher } from '../../Abstractions/Messaging/IDispatcher';
import { IRequest } from '../../Abstractions/Messaging/IRequest';
import { IBus } from '../../Abstractions/Messaging/IBus';
import { injectable } from 'tsyringe';
import { BUS } from '../../Abstractions/Messaging/IBus';
import { injectToken } from '@/Shared/DependencyInjection/inject';

/**
 * Default implementation of IDispatcher.
 * Delegates request handling to the configured IBus implementation.
 * The bus can be a LocalBus (in-process execution) or RemoteBus (cross-boundary communication).
 */
@injectable()
export class Dispatcher implements IDispatcher {
  constructor(@injectToken(BUS) private readonly bus: IBus) {}

  /** @inheritdoc */
  public async Send<TResponse>(
    request: IRequest<TResponse>,
    cancellationToken?: CancellationToken
  ): Promise<TResponse> {
    if (!request) {
      throw new Error('Request cannot be null or undefined.');
    }

    // Delegate to the bus (local or remote)
    return this.bus.Send(request, cancellationToken);
  }
}
