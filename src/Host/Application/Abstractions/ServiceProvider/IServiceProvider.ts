import { InjectionToken } from '@Shared/InjectionToken';

/**
 * Simple ServiceProvider wrapper around tsyringe container
 */
export interface IServiceProvider {
  /**
   * Resolve a service from the container
   * @param token The constructor or token to resolve
   */
  resolve<T>(token: new (...args: any[]) => T): T;

  /**
   * Resolve multiple services from a list of classes
   * @param tokens Array of classes to resolve
   */
  resolveAll<T>(tokens: Array<new (...args: any[]) => T>): T[];
}

export const SERVICE_PROVIDER = new InjectionToken<IServiceProvider>('ServiceProvider');
