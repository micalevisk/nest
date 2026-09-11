import {
  type HttpServer,
  type InjectionToken,
  type Type,
  Logger,
  RequestMethod,
} from '@nestjs/common';
import {
  HOST_METADATA,
  VERSION_METADATA,
  type VersionValue,
  addLeadingSlash,
  isFunction,
} from '@nestjs/common/internal';
import { ApplicationConfig } from '../application-config.js';
import { InvalidDynamicRouteException } from '../errors/exceptions/invalid-dynamic-route.exception.js';
import { NestContainer } from '../injector/container.js';
import {
  InstanceLink,
  InstanceLinksHost,
} from '../injector/instance-links-host.js';
import { InstanceWrapper } from '../injector/instance-wrapper.js';
import { Module } from '../injector/module.js';
import {
  FUNCTIONAL_ROUTE_HANDLER_METHOD,
  FunctionalRouteHost,
} from './functional-route-host.js';
import {
  ControllerDynamicRoute,
  DynamicRouteDefinition,
  FunctionalDynamicRoute,
} from './interfaces/dynamic-route.interface.js';
import { RoutePathMetadata } from './interfaces/route-path-metadata.interface.js';
import { RouteResolutionOptions } from './interfaces/route-resolution-options.interface.js';
import { RouteDefinition, RouterExplorer } from './router-explorer.js';
import { getModulePathMetadata } from './utils/module-path.util.js';

type RouteHost = string | RegExp | Array<string | RegExp> | undefined;

interface ResolvedTarget {
  routeDefinition: RouteDefinition;
  instanceWrapper: InstanceWrapper;
  moduleKey: string;
  routePathMetadata: RoutePathMetadata;
  host: RouteHost;
}

/**
 * Converts `RouterService` definitions into the structures consumed by
 * `RouterExplorer`, so dynamic routes share the exact pipeline used by
 * decorated controllers (execution context, enhancers, versioning, host
 * filtering, graph inspector, logging).
 */
export class DynamicRouteRegistrar {
  private readonly logger = new Logger(DynamicRouteRegistrar.name, {
    timestamp: true,
  });

  constructor(
    private readonly container: NestContainer,
    private readonly applicationConfig: ApplicationConfig,
    private readonly routerExplorer: RouterExplorer,
  ) {}

  /**
   * Resolves the definition and hands it to `RouterExplorer` with the
   * caller's `RouteResolutionOptions` (collect phase: the caller decides
   * whether registration is deferred and observes `onRouteResolved`).
   */
  public register(
    applicationRef: HttpServer,
    globalPrefix: string,
    definition: DynamicRouteDefinition,
    options: RouteResolutionOptions = {},
  ): void {
    const target = this.isControllerRoute(definition)
      ? this.resolveControllerTarget(definition, globalPrefix)
      : this.resolveFunctionalTarget(definition, globalPrefix);

    this.routerExplorer.applyPathsToRouterProxy(
      applicationRef,
      [target.routeDefinition],
      target.instanceWrapper,
      target.moduleKey,
      target.routePathMetadata,
      target.host!,
      options,
    );
  }

  private isControllerRoute(
    definition: DynamicRouteDefinition,
  ): definition is ControllerDynamicRoute {
    return (
      typeof (definition as ControllerDynamicRoute).handlerMethod === 'string'
    );
  }

  private resolveControllerTarget(
    definition: ControllerDynamicRoute,
    globalPrefix: string,
  ): ResolvedTarget {
    const { handler: metatype, handlerMethod } = definition;
    const link = this.findInstanceLink(
      metatype,
      `"${metatype.name}" is not registered in any module; add it to the "controllers" (or "providers") array of a module`,
    );
    const moduleRef = this.findModuleById(link.moduleId);
    const isController = link.collection === moduleRef.controllers;
    if (!isController && !link.wrapperRef.isDependencyTreeStatic()) {
      throw new InvalidDynamicRouteException(
        `"${metatype.name}" is request-scoped or transient; register it in the "controllers" array of its module to use it as a dynamic route handler`,
      );
    }
    const prototypeCallback = metatype.prototype?.[handlerMethod];
    if (!isFunction(prototypeCallback)) {
      throw new InvalidDynamicRouteException(
        `"${metatype.name}" has no method named "${handlerMethod}"`,
      );
    }

    const instance = link.wrapperRef.instance as Record<string, any>;
    const routeDefinition: RouteDefinition = {
      path: this.normalizePaths(definition.path),
      requestMethod: definition.method,
      targetCallback: instance[handlerMethod],
      methodName: handlerMethod,
      version:
        definition.version ??
        Reflect.getMetadata(VERSION_METADATA, prototypeCallback),
    };
    return {
      routeDefinition,
      instanceWrapper: link.wrapperRef,
      moduleKey: moduleRef.token,
      routePathMetadata: {
        ctrlPath: '/',
        modulePath: getModulePathMetadata(this.container, moduleRef.metatype),
        globalPrefix,
        controllerVersion: this.getControllerVersion(metatype),
        versioningOptions: this.applicationConfig.getVersioning(),
      },
      host: definition.host ?? Reflect.getMetadata(HOST_METADATA, metatype),
    };
  }

  private resolveFunctionalTarget(
    definition: FunctionalDynamicRoute,
    globalPrefix: string,
  ): ResolvedTarget {
    const paths = this.normalizePaths(definition.path);
    const deps = (definition.inject ?? []).map(token =>
      this.resolveStaticDependency(token, definition.method, paths),
    );
    const host = new FunctionalRouteHost(
      definition.handler,
      deps,
      definition.metadata,
    );
    const instanceWrapper = new InstanceWrapper({
      name: `DynamicRoute(${RequestMethod[definition.method]} ${paths.join(', ')})`,
      metatype: FunctionalRouteHost,
      instance: host,
      isResolved: true,
    });
    const routeDefinition: RouteDefinition = {
      path: paths,
      requestMethod: definition.method,
      targetCallback: host.handle,
      methodName: FUNCTIONAL_ROUTE_HANDLER_METHOD,
      version: definition.version,
    };
    const versioningOptions = this.applicationConfig.getVersioning();
    return {
      routeDefinition,
      instanceWrapper,
      moduleKey: this.container.getInternalCoreModuleRef()?.token ?? '',
      routePathMetadata: {
        ctrlPath: '/',
        modulePath: undefined,
        globalPrefix,
        controllerVersion: versioningOptions?.defaultVersion,
        versioningOptions,
      },
      host: definition.host,
    };
  }

  private resolveStaticDependency(
    token: InjectionToken,
    method: RequestMethod,
    paths: string[],
  ): unknown {
    const routeLabel = `{${paths[0]}, ${RequestMethod[method]}}`;
    const link = this.findInstanceLink(
      token,
      `cannot inject "${this.tokenToString(token)}" into the handler of ${routeLabel}: no such provider`,
    );
    if (!link.wrapperRef.isDependencyTreeStatic()) {
      throw new InvalidDynamicRouteException(
        `cannot inject "${this.tokenToString(token)}" into the handler of ${routeLabel}: only static (singleton) providers can be injected into functional handlers; use a controller method instead`,
      );
    }
    return link.wrapperRef.instance;
  }

  private findInstanceLink(
    token: InjectionToken,
    reason: string,
  ): InstanceLink {
    try {
      return new InstanceLinksHost(this.container).get(token);
    } catch {
      throw new InvalidDynamicRouteException(reason);
    }
  }

  private findModuleById(moduleId: string): Module {
    for (const moduleRef of this.container.getModules().values()) {
      if (moduleRef.id === moduleId) {
        return moduleRef;
      }
    }
    throw new InvalidDynamicRouteException(
      `could not find the module hosting the handler (module id "${moduleId}")`,
    );
  }

  private getControllerVersion(
    metatype: Type<unknown>,
  ): VersionValue | undefined {
    const versioningConfig = this.applicationConfig.getVersioning();
    if (!versioningConfig) {
      return undefined;
    }
    return (
      Reflect.getMetadata(VERSION_METADATA, metatype) ??
      versioningConfig.defaultVersion
    );
  }

  private normalizePaths(path: string | string[]): string[] {
    return (Array.isArray(path) ? path : [path]).map(p => addLeadingSlash(p));
  }

  private tokenToString(token: InjectionToken): string {
    return isFunction(token) ? (token as Function).name : String(token);
  }
}
