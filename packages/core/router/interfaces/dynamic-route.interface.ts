import type { InjectionToken, RequestMethod, Type } from '@nestjs/common';
import type { VersionValue } from '@nestjs/common/internal';

/**
 * Fields shared by every dynamic route definition.
 *
 * @publicApi
 */
export interface DynamicRouteBase {
  /**
   * HTTP method to handle (use `RequestMethod.ALL` for every method).
   */
  method: RequestMethod;
  /**
   * Complete route path (or paths). The global prefix and the owning
   * module's `RouterModule` path are prepended automatically; the
   * `@Controller()` prefix of a class handler is NOT applied.
   */
  path: string | string[];
  /**
   * Route version (requires `app.enableVersioning()`). For class handlers,
   * defaults to the method's `@Version()` and then the controller version.
   */
  version?: VersionValue;
  /**
   * Host filter, same semantics as `@Controller({ host })`. For class
   * handlers, defaults to the controller's host.
   */
  host?: string | RegExp | Array<string | RegExp>;
}

/**
 * Registers a method of a class that Nest instantiates (a `@Controller()`
 * listed in a module's `controllers`, or a static provider). Parameter
 * decorators, guards, pipes, interceptors and filters declared on the
 * class/method apply as usual.
 *
 * @publicApi
 */
export interface ControllerDynamicRoute<T = any> extends DynamicRouteBase {
  /**
   * A controller listed in more than one module resolves to whichever
   * module registered it last.
   */
  handler: Type<T>;
  handlerMethod: Extract<keyof T, string>;
  inject?: never;
  metadata?: never;
}

/**
 * Functional handler signature: `(req, res, ...deps)`. `deps` are the
 * resolved providers listed in `inject`, in order. The returned value is
 * sent as the response body (like `@Res({ passthrough: true })`).
 *
 * @publicApi
 */
export type DynamicRouteHandler<
  TRequest = any,
  TResponse = any,
  TDeps extends unknown[] = any[],
> = (req: TRequest, res: TResponse, ...deps: TDeps) => unknown;

/**
 * Registers a plain function as the route handler. Only global enhancers
 * (guards, pipes, interceptors, filters) apply; `metadata` entries are
 * defined on the handler function via `Reflect.defineMetadata` so
 * `Reflector`-based enhancers and integrations (e.g. Swagger) can read them.
 *
 * @publicApi
 */
export interface FunctionalDynamicRoute extends DynamicRouteBase {
  handler: DynamicRouteHandler;
  handlerMethod?: never;
  /**
   * Static (singleton) providers to resolve and pass to the handler after
   * `(req, res)`, in order.
   */
  inject?: InjectionToken[];
  metadata?: Record<string | symbol, unknown>;
}

/**
 * @publicApi
 */
export type DynamicRouteDefinition<T = any> =
  | ControllerDynamicRoute<T>
  | FunctionalDynamicRoute;
