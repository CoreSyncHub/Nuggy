import { inject as tsyringeInject, injectAll as tsyringeInjectAll } from "tsyringe";
import { type InjectionToken } from "../InjectionToken";

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

/**
 * Injects EVERY implementation registered under the same token, as an array.
 * Used where several adapters coexist (search sources), and where `injectToken`
 * would resolve only one of them.
 */
export function injectAllTokens<T>(token: InjectionToken<T>) {
  return tsyringeInjectAll(token.token);
}
