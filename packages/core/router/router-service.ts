import { RequestMethod } from '@nestjs/common';
import { isFunction, isObject, isString } from '@nestjs/common/internal';
import { InvalidDynamicRouteException } from '../errors/exceptions/invalid-dynamic-route.exception.js';
import { DynamicRouteDefinition } from './interfaces/dynamic-route.interface.js';

export type DynamicRouteRegistrarFn = (
  definition: DynamicRouteDefinition,
) => void;

/**
 * Registers HTTP routes at runtime through the regular Nest routing
 * pipeline. Inject it into any provider:
 *
 * ```ts
 * @Injectable()
 * export class FeatureRoutes implements OnModuleInit {
 *   constructor(private readonly router: RouterService) {}
 *
 *   onModuleInit() {
 *     this.router.register({
 *       method: RequestMethod.GET,
 *       path: '/health',
 *       handler: HealthController,
 *       handlerMethod: 'check',
 *     });
 *   }
 * }
 * ```
 *
 * Routes registered before the application routes are resolved take part
 * in the normal resolution process (specificity sorting, conflict
 * detection, etc.). Routes registered afterwards are installed
 * immediately. Registration is additive: there is no removal API.
 *
 * @publicApi
 */
export class RouterService {
  private readonly routes: DynamicRouteDefinition[] = [];
  private readonly pending: DynamicRouteDefinition[] = [];
  private registrar: DynamicRouteRegistrarFn | null = null;

  public register(definition: DynamicRouteDefinition): void {
    this.validate(definition);
    const snapshot = Object.freeze({ ...definition }) as DynamicRouteDefinition;
    this.routes.push(snapshot);

    if (this.registrar) {
      this.registrar(snapshot);
      return;
    }
    this.pending.push(snapshot);
  }

  /**
   * Returns every definition passed to `register()`, in registration order.
   */
  public getRoutes(): ReadonlyArray<DynamicRouteDefinition> {
    return [...this.routes];
  }

  /**
   * Binds the function that installs definitions. Definitions registered
   * before the first bind are replayed synchronously, in order.
   *
   * @internal
   */
  public bindRegistrar(registrar: DynamicRouteRegistrarFn): void {
    this.registrar = registrar;
    const queued = this.pending.splice(0, this.pending.length);
    queued.forEach(definition => registrar(definition));
  }

  private validate(definition: DynamicRouteDefinition): void {
    if (!isObject(definition)) {
      throw new InvalidDynamicRouteException('expected an object');
    }
    const { method, path, handler } = definition as unknown as Record<
      string,
      unknown
    >;
    if (typeof method !== 'number' || RequestMethod[method] === undefined) {
      throw new InvalidDynamicRouteException(
        '"method" must be a RequestMethod enum value',
      );
    }
    const paths = Array.isArray(path) ? path : [path];
    if (paths.length === 0 || !paths.every(p => isString(p) && p.length > 0)) {
      throw new InvalidDynamicRouteException(
        '"path" must be a non-empty string or a non-empty array of strings',
      );
    }
    if (!isFunction(handler)) {
      throw new InvalidDynamicRouteException(
        '"handler" must be a class or a function',
      );
    }
    if (
      'handlerMethod' in definition &&
      definition.handlerMethod !== undefined
    ) {
      if (!isString(definition.handlerMethod)) {
        throw new InvalidDynamicRouteException(
          '"handlerMethod" must be the name of a method on the handler class',
        );
      }
      return;
    }
    if (definition.inject !== undefined && !Array.isArray(definition.inject)) {
      throw new InvalidDynamicRouteException(
        '"inject" must be an array of injection tokens',
      );
    }
    if (definition.metadata !== undefined && !isObject(definition.metadata)) {
      throw new InvalidDynamicRouteException('"metadata" must be an object');
    }
  }
}
