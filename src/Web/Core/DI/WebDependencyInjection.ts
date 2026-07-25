import { DependencyInjectionProvider } from "@Shared/DependencyInjection/DependencyInjectionProvider";
import { Dispatcher } from "@Shared/Infrastructure/Messaging/Dispatcher";
import { DISPATCHER, type IDispatcher } from "@Shared/Abstractions/Messaging/IDispatcher";
import { type IBus, BUS } from "@Shared/Abstractions/Messaging/IBus";
import { RemoteBus } from "../Infrastructure/Messaging/RemoteBus";
import { type ILogger, LOGGER } from "@/Host/Application/Abstractions/Log/ILogger";
import { WebLogger } from "../Services/WebLogger";

/**
 * Dependency injection configuration for the WebView.
 */
export class WebDependencyInjection extends DependencyInjectionProvider {
  public Provide(): void {
    this.Register<IBus>(BUS, RemoteBus);
    this.Register<IDispatcher>(DISPATCHER, Dispatcher);
    this.Register<ILogger>(LOGGER, WebLogger);
  }
}
