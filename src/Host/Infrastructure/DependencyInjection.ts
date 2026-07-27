import {
  type IServiceProvider,
  SERVICE_PROVIDER,
} from "@Application/Abstractions/ServiceProvider/IServiceProvider";
import { DependencyInjectionProvider } from "@Shared/DependencyInjection/DependencyInjectionProvider";
import { ServiceProvider } from "./ServiceProvider/ServiceProvider";
import { type IBus, BUS } from "@Shared/Abstractions/Messaging/IBus";
import { LocalBus } from "./Messaging/LocalBus";
import { type ILogger, LOGGER } from "../Application/Abstractions/Log/ILogger";
import { VscLogger } from "./Log/VscLogger";
import { USER_PROMPT, type IUserPrompt } from "@Application/Abstractions/Prompt/IUserPrompt";
import { VscUserPrompt } from "./Prompt/VscUserPrompt";
import { PROCESS_RUNNER, type IProcessRunner, ChildProcessRunner } from "./MsBuild/ProcessRunner";

export class InfrastructureDependencyInjection extends DependencyInjectionProvider {
  public Provide(): void {
    this.Register<IServiceProvider>(SERVICE_PROVIDER, ServiceProvider);
    this.Register<ILogger>(LOGGER, VscLogger);
    this.Register<IBus>(BUS, LocalBus);
    this.Register<IUserPrompt>(USER_PROMPT, VscUserPrompt);
    this.Register<IProcessRunner>(PROCESS_RUNNER, ChildProcessRunner);
  }
}
