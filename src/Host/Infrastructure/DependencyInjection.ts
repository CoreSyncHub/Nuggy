import {
  IServiceProvider,
  SERVICE_PROVIDER,
} from '@Application/Abstractions/ServiceProvider/IServiceProvider';
import { DependencyInjectionProvider } from '@Shared/DependencyInjection/DependencyInjectionProvider';
import { ServiceProvider } from './ServiceProvider/ServiceProvider';
import { IBus, BUS } from '@Shared/Abstractions/Messaging/IBus';
import { LocalBus } from './Messaging/LocalBus';
import { ILogger, LOGGER } from '../Application/Abstractions/Log/ILogger';
import { VscLogger } from './Log/VscLogger';

export class InfrastructureDependencyInjection extends DependencyInjectionProvider {
  public Provide(): void {
    this.Register<IServiceProvider>(SERVICE_PROVIDER, ServiceProvider);
    this.Register<ILogger>(LOGGER, VscLogger);
    this.Register<IBus>(BUS, LocalBus);
  }
}
