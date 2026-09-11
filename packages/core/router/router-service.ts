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
 * immediately, appended in call order — specificity sorting cannot be
 * applied retroactively. Registration is additive: there is no removal
 * API. On Fastify, registering after `app.listen()` throws
 * `LateRouteRegistrationException`; registering after a manual
 * `instance.ready()` is rejected by Fastify itself instead. `path` is
 * always the complete path: the global prefix and the owning module's
 * `RouterModule` path are prepended, but a class handler's own
 * `@Controller()` prefix is not applied.
 *
 * @publicApi
 */
export class RouterService {
  private readonly routes: DynamicRouteDefinition[] = [];
  private readonly pending: DynamicRouteDefinition[] = [];
  private registrar: DynamicRouteRegistrarFn | null = null;

  public register<T = any>(definition: DynamicRouteDefinition<T>): void {
    this.validate(definition as DynamicRouteDefinition);
    const snapshot = Object.freeze({ ...definition }) as DynamicRouteDefinition;

    if (this.registrar) {
      // Call the registrar before recording the snapshot: if it throws
      // (e.g. the route conflicts with an existing one), the rejected
      // registration must not show up in `getRoutes()`.
      this.registrar(snapshot);
      this.routes.push(snapshot);
      return;
    }
    this.routes.push(snapshot);
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
    const isClassHandler = RouterService.isClass(handler);
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
    if (isClassHandler) {
      throw new InvalidDynamicRouteException(
        '"handler" is a class; "handlerMethod" is required to select which method handles the route',
      );
    }
    if (definition.inject !== undefined && !Array.isArray(definition.inject)) {
      throw new InvalidDynamicRouteException(
        '"inject" must be an array of injection tokens',
      );
    }
    if (
      definition.metadata !== undefined &&
      (Array.isArray(definition.metadata) || !isObject(definition.metadata))
    ) {
      throw new InvalidDynamicRouteException(
        '"metadata" must be an object, not an array',
      );
    }
  }

  private static isClass(fn: Function): boolean {
    return Function.prototype.toString.call(fn).startsWith('class');
  }
}
