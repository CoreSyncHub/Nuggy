import { handlersMap } from './HandlerRegistry';

/**
 * Decorator to register a handler for a specific request type.
 * @example
 * @HandlerFor(GetUserQuery)
 * class GetUserQueryHandler implements IQueryHandler<GetUserQuery, UserDto> {
 *   async Handle(request: GetUserQuery): Promise<UserDto> { ... }
 * }
 */
export function HandlerFor<TRequest = any, TResponse = any>(
  requestType: new (...args: any[]) => TRequest
) {
  return function (target: new (...args: any[]) => any) {
    handlersMap.set(requestType, target);
  };
}
