import { type DependencyContainer, container, injectable } from "tsyringe";
import { type IServiceProvider } from "@Application/Abstractions/ServiceProvider/IServiceProvider";

/**
 * Simple ServiceProvider wrapper around tsyringe container
 */
@injectable()
export class ServiceProvider implements IServiceProvider {
  private readonly _container: DependencyContainer = container;

  /** @inheritdoc */
  resolve<T>(token: new (...args: any[]) => T): T {
    return this._container.resolve(token);
  }

  /** @inheritdoc */
  resolveAll<T>(tokens: Array<new (...args: any[]) => T>): T[] {
    return tokens.map((token) => this._container.resolve(token));
  }
}
