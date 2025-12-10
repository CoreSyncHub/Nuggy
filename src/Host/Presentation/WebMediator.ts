import type { Webview } from 'vscode';
import type { IDispatcher } from '@Shared/Abstractions/Messaging/IDispatcher';
import { ILogger, LOGGER } from '@Application/Abstractions/Log/ILogger';
import { injectToken } from '@Shared/DependencyInjection/inject';

type MessageHeaders = {
  Type: 'REQUEST' | 'RESPONSE' | 'EVENT';
  Command: string;
  CorrelationId: number;
};

type Envelope = {
  Headers: MessageHeaders;
  Body: any;
};

/**
 * WebMediator: receives envelopes from the webview and routes to IDispatcher.
 * Allows registering request constructors for commands so we can rehydrate
 * request instances from the serialized body.
 * Also supports sending events from Host to WebView.
 */
export class WebMediator {
  private requestTypes = new Map<string, new (...args: any[]) => any>();

  constructor(
    private readonly webview: Webview,
    private readonly dispatcher: IDispatcher,
    @injectToken(LOGGER) private readonly logger: ILogger
  ) {
    this.webview.onDidReceiveMessage((message: Envelope) => {
      this.logger.Info('Received message from webview', { message });
      try {
        this.handleMessage(message);
      } catch (error) {
        this.logger.Error('Error handling message in WebMediator', error as Error);
      }
    });
  }

  /**
   * Send an event to the WebView
   * @param eventName The name of the event
   * @param payload The event payload
   */
  public sendEvent(eventName: string, payload: any): void {
    const envelope: Envelope = {
      Headers: {
        Type: 'EVENT',
        Command: eventName,
        CorrelationId: 0,
      },
      Body: payload,
    };
    this.webview.postMessage(envelope);
  }

  /** Register a request constructor for a command name (usually constructor.name) */
  public registerRequestType(command: string, ctor: new (...args: any[]) => any): void {
    this.requestTypes.set(command, ctor);
  }

  private async handleMessage(message: Envelope): Promise<void> {
    if (!message || !message.Headers) {
      return;
    }
    const headers = message.Headers;
    if (headers.Type === 'REQUEST') {
      await this.handleRequest(message);
    }
    // Host does not handle RESPONSE messages in this mediator
  }

  private async handleRequest(message: Envelope): Promise<void> {
    const { Command, CorrelationId } = message.Headers;
    const ctor = this.requestTypes.get(Command);
    let requestObj: any = message.Body;

    if (ctor) {
      try {
        // Rehydrate request by assigning properties onto new instance
        requestObj = Object.assign(new ctor(), message.Body);
      } catch (e) {
        this.logger.Warning('Failed to instantiate request ctor', { Command, error: e });
      }
    }

    try {
      const response = await this.dispatcher.Send(requestObj);
      const envelope: Envelope = {
        Headers: {
          Type: 'RESPONSE',
          Command: Command,
          CorrelationId: CorrelationId,
        },
        Body: response,
      };
      this.webview.postMessage(envelope);
    } catch (error) {
      const envelope: Envelope = {
        Headers: {
          Type: 'RESPONSE',
          Command: Command,
          CorrelationId: CorrelationId,
        },
        Body: { __error: error instanceof Error ? error.message : String(error) },
      };
      this.webview.postMessage(envelope);
    }
  }
}
