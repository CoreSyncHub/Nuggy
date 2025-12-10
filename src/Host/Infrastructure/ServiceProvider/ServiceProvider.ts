import { DependencyContainer, container, injectable } from 'tsyringe';
import { IServiceProvider } from '@Application/Abstractions/ServiceProvider/IServiceProvider';

/**
 * Simple ServiceProvider wrapper around tsyringe container
 */
@injectable()
export class ServiceProvider implements IServiceProvider {
  private readonly _container: DependencyContainer;

  constructor(containerInstance?: DependencyContainer) {
    this._container = containerInstance ?? container;
  }

  /** @inheritdoc */
  resolve<T>(token: new (...args: any[]) => T): T {
    return this._container.resolve(token);
  }

  /** @inheritdoc */
  resolveAll<T>(tokens: Array<new (...args: any[]) => T>): T[] {
    return tokens.map((token) => this._container.resolve(token));
  }
}
