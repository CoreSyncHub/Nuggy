import { container } from 'tsyringe';
import { InjectionToken } from '../InjectionToken';

export type PrimitiveTypes = string | number | boolean | null | undefined;

/**
 * Base class for dependency injection providers.
 * Provides type-safe registration methods for services.
 */
export abstract class DependencyInjectionProvider {
  /**
   * Provides the dependency injection tokens for the application.
   * Subclasses should implement this and register services in tsyringe container.
   */
  public abstract Provide(): void;

  /**
   * Registers a class implementation in the tsyringe container.
   * @template T - The interface/type being registered
   * @param token - The injection token
   * @param implementation - The concrete class implementing T
   */
  protected Register<T>(
    token: InjectionToken<T>,
    implementation: new (...args: any[]) => T
  ): void {
    container.register<T>(token.token, { useClass: implementation });
  }

  /**
   * Registers a primitive value in the tsyringe container.
   * @template T - The primitive type
   * @param token - The injection token
   * @param value - The value to register
   */
  protected RegisterPrimitive<T extends PrimitiveTypes>(
    token: InjectionToken<T>,
    value: T
  ): void {
    container.registerInstance<T>(token.token, value);
  }
}
