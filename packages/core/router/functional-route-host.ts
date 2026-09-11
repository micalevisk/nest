import {
  assignMetadata,
  RESPONSE_PASSTHROUGH_METADATA,
  ROUTE_ARGS_METADATA,
  RouteParamtypes,
} from '@nestjs/common/internal';
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
        Reflect.defineMetadata(key, metadata[key as any], this.handle);
      }
    }
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
