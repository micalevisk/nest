import {
  assignMetadata,
  RESPONSE_PASSTHROUGH_METADATA,
  ROUTE_ARGS_METADATA,
  randomStringGenerator,
  RouteParamtypes,
} from '@nestjs/common/internal';
import { CONTROLLER_ID_KEY } from '../injector/constants.js';
import { DynamicRouteHandler } from './interfaces/dynamic-route.interface.js';

export const FUNCTIONAL_ROUTE_HANDLER_METHOD = 'handle';

/**
 * Adapts a functional dynamic route handler to the shape that
 * `RouterExecutionContext` expects (an instance + method name). The class
 * declares `@Req()` and `@Res({ passthrough: true })` parameter metadata
 * once; each instance owns its `handle` function so per-route metadata
 * can be attached without leaking across routes.
 */
export class FunctionalRouteHost {
  public readonly handle: (req: unknown, res: unknown) => unknown;

  constructor(
    handler: DynamicRouteHandler,
    deps: unknown[],
    metadata?: Record<string | symbol, unknown>,
  ) {
    this.handle = (req: unknown, res: unknown) => handler(req, res, ...deps);
    if (metadata) {
      for (const key of Reflect.ownKeys(metadata)) {
        Reflect.defineMetadata(key, metadata[key], this.handle);
      }
    }
  }

  /**
   * Creates a dedicated subclass for a single dynamic route.
   *
   * `HandlerMetadataStorage` (consumed by `RouterExecutionContext`) caches
   * per-handler metadata — including the resolved HTTP status code — keyed
   * by `controller.constructor[CONTROLLER_ID_KEY] || controller.constructor.name`
   * plus the method name. Every functional route shares the same constant
   * method name (`FUNCTIONAL_ROUTE_HANDLER_METHOD`), so without a distinct
   * constructor per route the cache entry computed for the first-registered
   * functional route would leak into every other one. Assigning a unique
   * `CONTROLLER_ID_KEY` (mirroring `Module.assignControllerUniqueId`) gives
   * each route its own cache entry while inheriting the `@Req()`/`@Res()`
   * parameter metadata declared on the parent class prototype chain.
   */
  public static createRouteClass(name: string): typeof FunctionalRouteHost {
    class DynamicFunctionalRouteHost extends FunctionalRouteHost {}
    Object.defineProperty(DynamicFunctionalRouteHost, CONTROLLER_ID_KEY, {
      enumerable: false,
      writable: false,
      configurable: true,
      value: randomStringGenerator(),
    });
    Object.defineProperty(DynamicFunctionalRouteHost, 'name', {
      value: name,
    });
    return DynamicFunctionalRouteHost;
  }
}

const routeArgs = assignMetadata(
  assignMetadata({}, RouteParamtypes.REQUEST, 0),
  RouteParamtypes.RESPONSE,
  1,
);
Reflect.defineMetadata(
  ROUTE_ARGS_METADATA,
  routeArgs,
  FunctionalRouteHost,
  FUNCTIONAL_ROUTE_HANDLER_METHOD,
);
Reflect.defineMetadata(
  RESPONSE_PASSTHROUGH_METADATA,
  true,
  FunctionalRouteHost,
  FUNCTIONAL_ROUTE_HANDLER_METHOD,
);
