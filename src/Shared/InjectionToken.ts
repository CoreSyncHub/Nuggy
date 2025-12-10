/**
 * Type-safe injection token for tsyringe DI container.
 * Uses Symbol for unique identification and type safety.
 * @template T - The type of the service this token represents (for type inference)
 */
export class InjectionToken<T = unknown> {
  private readonly _symbol: symbol;

  constructor(name: string) {
    this._symbol = Symbol(name);
  }

  /**
   * Returns the underlying symbol token.
   * This is used by tsyringe for dependency resolution.
   */
  get token(): symbol {
    return this._symbol;
  }

  /**
   * @deprecated Use .token instead
   */
  toString(): symbol {
    return this._symbol;
  }
}
