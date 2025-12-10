import { CancellationToken } from 'vscode';
import { IBus } from '@Shared/Abstractions/Messaging/IBus';
import { IRequest } from '@Shared/Abstractions/Messaging/IRequest';
import { singleton } from 'tsyringe';
import { ILogger, LOGGER } from '@/Host/Application/Abstractions/Log/ILogger';
import { injectToken } from '@Shared/DependencyInjection/inject';
import type { VsCodeApi } from '../../Types/vscode';

type MessageHeaders = {
  Type: 'REQUEST' | 'RESPONSE' | 'EVENT';
  Command: string;
  CorrelationId: number;
};

type Envelope<T = unknown> = {
  Headers: MessageHeaders;
  Body: T;
};

type ErrorResponse = {
  __error: string;
};

/**
 * RemoteBus sends requests to the Host via VSCode postMessage API.
 * This is used by the WebView to communicate with the Host transparently.
 * Also handles EVENT messages from the Host.
 */
@singleton()
export class RemoteBus implements IBus {
  private locks: Map<number, { resolve: (v: unknown) => void; reject: (e: Error) => void }> =
    new Map();
  private correlationIdCounter = 0;
  private eventListeners: Map<string, Array<(payload: any) => void>> = new Map();
  private static readonly vscode: VsCodeApi | undefined =
    window.vscode ?? window.acquireVsCodeApi?.();

  constructor(@injectToken(LOGGER) private readonly logger: ILogger) {
    // Listen for responses and events from the Host
    window.addEventListener('message', (e: MessageEvent<Envelope>) => {
      this.logger.Debug('Received message from Host', { data: e.data });
      const msg = e.data;
      if (!msg || !msg.Headers) {
        return;
      }

      if (msg.Headers.Type === 'RESPONSE') {
        const lock = this.locks.get(msg.Headers.CorrelationId);
        if (lock) {
          // Check if response contains an error
          const body = msg.Body as ErrorResponse | unknown;
          if (body && typeof body === 'object' && '__error' in body) {
            lock.reject(new Error((body as ErrorResponse).__error));
          } else {
            lock.resolve(msg.Body);
          }
          this.locks.delete(msg.Headers.CorrelationId);
        }
      } else if (msg.Headers.Type === 'EVENT') {
        // Handle EVENT messages from Host
        const eventName = msg.Headers.Command;
        const listeners = this.eventListeners.get(eventName);
        if (listeners) {
          listeners.forEach((listener) => {
            try {
              listener(msg.Body);
            } catch (error) {
              this.logger.Error(`Error in event listener for ${eventName}`, error as Error);
            }
          });
        }
      }
    });
  }

  /**
   * Subscribe to events from the Host
   * @param eventName The name of the event to listen for
   * @param callback The callback to invoke when the event is received
   * @returns Unsubscribe function
   */
  public onEvent(eventName: string, callback: (payload: any) => void): () => void {
    if (!this.eventListeners.has(eventName)) {
      this.eventListeners.set(eventName, []);
    }
    const listeners = this.eventListeners.get(eventName)!;
    listeners.push(callback);

    return () => {
      const index = listeners.indexOf(callback);
      if (index > -1) {
        listeners.splice(index, 1);
      }
    };
  }

  public async Send<TResponse>(
    request: IRequest<TResponse>,
    cancellationToken?: CancellationToken
  ): Promise<TResponse> {
    const vscode = RemoteBus.vscode;
    if (!vscode || !vscode.postMessage) {
      throw new Error('vscode.postMessage not available');
    }

    const commandName = request?.constructor?.name ?? 'Unknown';
    this.logger.Debug('Sending request', { commandName, request });

    const correlationId = ++this.correlationIdCounter;

    const envelope: Envelope = {
      Headers: {
        Type: 'REQUEST',
        Command: commandName,
        CorrelationId: correlationId,
      },
      Body: request,
    };

    return new Promise<TResponse>((resolve, reject) => {
      this.locks.set(correlationId, {
        resolve: (v: unknown) => resolve(v as TResponse),
        reject,
      });
      this.logger.Debug('Sending message to Host', { envelope });
      vscode.postMessage(envelope);

      // Timeout after 30 seconds
      setTimeout(() => {
        if (this.locks.has(correlationId)) {
          this.locks.delete(correlationId);
          reject(new Error(`Request timeout for ${commandName}`));
        }
      }, 30_000);

      // Handle cancellation token if provided
      if (cancellationToken) {
        cancellationToken.onCancellationRequested(() => {
          if (this.locks.has(correlationId)) {
            this.locks.delete(correlationId);
            reject(new Error(`Request cancelled for ${commandName}`));
          }
        });
      }
    });
  }
}
