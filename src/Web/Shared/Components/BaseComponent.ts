import { LitElement } from 'lit';
import { container } from 'tsyringe';

/**
 * Base class for all Lit components with DI support.
 * Provides automatic dependency resolution from the container.
 */
export abstract class BaseComponent extends LitElement {
  /**
   * Resolve a service from the DI container.
   * Use this in your component's constructor or connectedCallback.
   * @template T - The service type
   * @param token - The service class constructor
   */
  protected resolve<T>(token: new (...args: any[]) => T): T {
    return container.resolve(token);
  }
}
