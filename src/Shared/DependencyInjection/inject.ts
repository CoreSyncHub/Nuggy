import { inject as tsyringeInject } from 'tsyringe';
import { InjectionToken } from '../InjectionToken';

/**
 * Type-safe wrapper around tsyringe's @inject decorator.
 * Use this instead of @inject to avoid type casting.
 *
 * @example
 * ```typescript
 * class MyService {
 *   constructor(
 *     @injectToken(MY_TOKEN) private readonly myDep: IMyDependency
 *   ) {}
 * }
 * ```
 */
export function injectToken<T>(token: InjectionToken<T>) {
  return tsyringeInject(token.token);
}
