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
 * Injecte TOUTES les implémentations enregistrées sous un même token, sous
 * forme de tableau. Utilisé là où plusieurs adaptateurs coexistent (sources de
 * recherche), là où `injectToken` n'en résoudrait qu'une.
 */
export function injectAllTokens<T>(token: InjectionToken<T>) {
  return tsyringeInjectAll(token.token);
}
