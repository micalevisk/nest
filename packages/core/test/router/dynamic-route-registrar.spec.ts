import {
  Controller,
  Get,
  Injectable,
  Module,
  RequestMethod,
  Scope,
  Version,
  VersioningType,
} from '@nestjs/common';
import { MODULE_PATH } from '@nestjs/common/internal';
import { ApplicationConfig } from '../../application-config.js';
import { InvalidDynamicRouteException } from '../../errors/exceptions/invalid-dynamic-route.exception.js';
import { LateRouteRegistrationException } from '../../errors/exceptions/late-route-registration.exception.js';
import { RouteConflictException } from '../../errors/exceptions/route-conflict.exception.js';
import { HandlerMetadataStorage } from '../../helpers/handler-metadata-storage.js';
import { NestContainer } from '../../injector/container.js';
import { Injector } from '../../injector/injector.js';
import { InstanceWrapper } from '../../injector/instance-wrapper.js';
import { GraphInspector } from '../../inspector/graph-inspector.js';
import { MetadataScanner } from '../../metadata-scanner.js';
import { DynamicRouteRegistrar } from '../../router/dynamic-route-registrar.js';
import {
  FUNCTIONAL_ROUTE_HANDLER_METHOD,
  FunctionalRouteHost,
} from '../../router/functional-route-host.js';
import { ResolvedRoute } from '../../router/interfaces/resolved-route.interface.js';
import { RoutePathFactory } from '../../router/route-path-factory.js';
import { RouterExceptionFilters } from '../../router/router-exception-filters.js';
import { RouterExplorer } from '../../router/router-explorer.js';
import { RouterProxy } from '../../router/router-proxy.js';
import { NoopHttpAdapter } from '../utils/noop-adapter.js';

describe('DynamicRouteRegistrar', () => {
  @Injectable()
  class MetricsService {
    collect() {
      return 'metrics';
    }
  }

  @Injectable({ scope: Scope.REQUEST })
  class RequestScopedService {}

  @Controller({ host: 'api.example.com', version: '1' })
  class HealthController {
    check() {}

    @Version('3')
    versioned() {}
  }

  @Module({
    controllers: [HealthController],
    providers: [MetricsService, RequestScopedService],
  })
  class FeatureModule {}

  let container: NestContainer;
  let applicationConfig: ApplicationConfig;
  let routerExplorer: RouterExplorer;
  let registrar: DynamicRouteRegistrar;
  let applyPathsSpy: ReturnType<typeof vi.spyOn>;
  let moduleKey: string;
  const adapter = new NoopHttpAdapter({});

  beforeEach(async () => {
    applicationConfig = new ApplicationConfig();
    container = new NestContainer(applicationConfig);
    const { moduleRef } = (await container.addModule(FeatureModule, []))!;
    moduleKey = moduleRef.token;
    container.addController(HealthController, moduleKey);
    container.addProvider(MetricsService, moduleKey);
    container.addProvider(RequestScopedService, moduleKey);
    moduleRef.controllers.get(HealthController)!.instance =
      new HealthController();
    moduleRef.providers.get(MetricsService)!.instance = new MetricsService();

    routerExplorer = new RouterExplorer(
      new MetadataScanner(),
      container,
      new Injector(),
      new RouterProxy(),
      new RouterExceptionFilters(container, applicationConfig, adapter),
      applicationConfig,
      new RoutePathFactory(applicationConfig),
      new GraphInspector(container),
    );
    applyPathsSpy = vi
      .spyOn(routerExplorer, 'applyPathsToRouterProxy')
      .mockImplementation(() => {});
    registrar = new DynamicRouteRegistrar(
      container,
      applicationConfig,
      routerExplorer,
    );
  });

  describe('register (controller form)', () => {
    it('should hand the controller instance and a RouteDefinition to the explorer', () => {
      const options = { deferRegistration: true };
      registrar.register(
        adapter,
        '/api',
        {
          method: RequestMethod.GET,
          path: 'health',
          handler: HealthController,
          handlerMethod: 'check',
        },
        options,
      );

      expect(applyPathsSpy).toHaveBeenCalledTimes(1);
      const [router, definitions, wrapper, key, pathMetadata, host, opts] =
        applyPathsSpy.mock.calls[0];
      expect(router).toBe(adapter);
      expect(definitions).toEqual([
        {
          path: ['/health'],
          requestMethod: RequestMethod.GET,
          targetCallback: HealthController.prototype.check,
          methodName: 'check',
          version: undefined,
        },
      ]);
      expect((wrapper as InstanceWrapper).metatype).toBe(HealthController);
      expect(key).toBe(moduleKey);
      expect(pathMetadata).toEqual({
        ctrlPath: '/',
        modulePath: undefined,
        globalPrefix: '/api',
        controllerVersion: undefined,
        versioningOptions: undefined,
      });
      expect(host).toBe('api.example.com');
      expect(opts).toBe(options);
    });

    it('should apply the module path registered through RouterModule', () => {
      Reflect.defineMetadata(
        MODULE_PATH + container.getModules().applicationId,
        '/feature',
        FeatureModule,
      );
      registrar.register(adapter, '', {
        method: RequestMethod.GET,
        path: '/health',
        handler: HealthController,
        handlerMethod: 'check',
      });
      expect(applyPathsSpy.mock.calls[0][4]).toMatchObject({
        modulePath: '/feature',
      });
    });

    it('should resolve versions from the definition, the method and the controller', () => {
      applicationConfig.enableVersioning({
        type: VersioningType.URI,
        defaultVersion: '9',
      });

      registrar.register(adapter, '', {
        method: RequestMethod.GET,
        path: '/a',
        handler: HealthController,
        handlerMethod: 'versioned',
      });
      registrar.register(adapter, '', {
        method: RequestMethod.GET,
        path: '/b',
        handler: HealthController,
        handlerMethod: 'versioned',
        version: '5',
      });

      expect(applyPathsSpy.mock.calls[0][1][0].version).toBe('3');
      expect(applyPathsSpy.mock.calls[0][4]).toMatchObject({
        controllerVersion: '1',
      });
      expect(applyPathsSpy.mock.calls[1][1][0].version).toBe('5');
    });

    it('should let the definition override the host', () => {
      registrar.register(adapter, '', {
        method: RequestMethod.GET,
        path: '/health',
        handler: HealthController,
        handlerMethod: 'check',
        host: 'other.example.com',
      });
      expect(applyPathsSpy.mock.calls[0][5]).toBe('other.example.com');
    });

    it('should throw when the class is not registered in any module', () => {
      class Unknown {
        check() {}
      }
      expect(() =>
        registrar.register(adapter, '', {
          method: RequestMethod.GET,
          path: '/x',
          handler: Unknown,
          handlerMethod: 'check',
        }),
      ).toThrow(InvalidDynamicRouteException);
    });

    it('should throw when the method does not exist on the class', () => {
      expect(() =>
        registrar.register(adapter, '', {
          method: RequestMethod.GET,
          path: '/x',
          handler: HealthController,
          handlerMethod: 'missing' as any,
        }),
      ).toThrow(InvalidDynamicRouteException);
    });

    it('should throw when a request-scoped provider (not controller) is used', () => {
      expect(() =>
        registrar.register(adapter, '', {
          method: RequestMethod.GET,
          path: '/x',
          handler: RequestScopedService,
          handlerMethod: 'toString',
        }),
      ).toThrow(InvalidDynamicRouteException);
    });
  });

  describe('register (functional form)', () => {
    it('should wrap the handler in a FunctionalRouteHost with resolved deps', () => {
      const handler = vi.fn().mockReturnValue('ok');
      registrar.register(adapter, '/api', {
        method: RequestMethod.POST,
        path: ['/metrics', '/m'],
        handler,
        inject: [MetricsService],
        metadata: { tag: 'metrics' },
      });

      const [, definitions, wrapper, , pathMetadata, host] =
        applyPathsSpy.mock.calls[0];
      const instance = (wrapper as InstanceWrapper)
        .instance as FunctionalRouteHost;
      expect(instance).toBeInstanceOf(FunctionalRouteHost);
      expect(definitions).toEqual([
        {
          path: ['/metrics', '/m'],
          requestMethod: RequestMethod.POST,
          targetCallback: instance.handle,
          methodName: FUNCTIONAL_ROUTE_HANDLER_METHOD,
          version: undefined,
        },
      ]);
      expect((wrapper as InstanceWrapper).name).toBe(
        'DynamicRoute(POST /metrics, /m)',
      );
      expect(pathMetadata).toMatchObject({
        ctrlPath: '/',
        globalPrefix: '/api',
      });
      expect(host).toBeUndefined();
      expect(Reflect.getMetadata('tag', instance.handle)).toBe('metrics');

      const req = {};
      const res = {};
      instance.handle(req, res);
      expect(handler).toHaveBeenCalledWith(
        req,
        res,
        expect.any(MetricsService),
      );
    });

    it('should give back-to-back functional routes distinct metatype subclasses of FunctionalRouteHost', () => {
      registrar.register(adapter, '', {
        method: RequestMethod.GET,
        path: '/first',
        handler: () => 'first',
      });
      registrar.register(adapter, '', {
        method: RequestMethod.GET,
        path: '/second',
        handler: () => 'second',
      });

      const firstWrapper = applyPathsSpy.mock.calls[0][2] as InstanceWrapper;
      const secondWrapper = applyPathsSpy.mock.calls[1][2] as InstanceWrapper;

      expect(firstWrapper.metatype).not.toBe(secondWrapper.metatype);
      expect(
        (firstWrapper.instance as FunctionalRouteHost) instanceof
          FunctionalRouteHost,
      ).toBe(true);
      expect(
        (secondWrapper.instance as FunctionalRouteHost) instanceof
          FunctionalRouteHost,
      ).toBe(true);

      // HandlerMetadataStorage keys its cache by constructor + method name;
      // distinct metatypes must therefore produce distinct cache entries
      // instead of the two routes sharing (and clobbering) one another's
      // cached httpStatusCode/etc.
      const storage = new HandlerMetadataStorage();
      storage.set(firstWrapper.instance, 'handle', { httpStatusCode: 200 });
      storage.set(secondWrapper.instance, 'handle', { httpStatusCode: 201 });
      expect(storage.get(firstWrapper.instance, 'handle')).toMatchObject({
        httpStatusCode: 200,
      });
      expect(storage.get(secondWrapper.instance, 'handle')).toMatchObject({
        httpStatusCode: 201,
      });
    });

    it('should apply the default version to functional routes', () => {
      applicationConfig.enableVersioning({
        type: VersioningType.URI,
        defaultVersion: '2',
      });
      registrar.register(adapter, '', {
        method: RequestMethod.GET,
        path: '/x',
        handler: () => {},
      });
      expect(applyPathsSpy.mock.calls[0][4]).toMatchObject({
        controllerVersion: '2',
      });
    });

    it('should throw when an injected token is unknown', () => {
      expect(() =>
        registrar.register(adapter, '', {
          method: RequestMethod.GET,
          path: '/x',
          handler: () => {},
          inject: ['NOPE'],
        }),
      ).toThrow(InvalidDynamicRouteException);
    });

    it('should throw when an injected provider is not static', () => {
      expect(() =>
        registrar.register(adapter, '', {
          method: RequestMethod.GET,
          path: '/x',
          handler: () => {},
          inject: [RequestScopedService],
        }),
      ).toThrow(InvalidDynamicRouteException);
    });
  });

  describe('registerLive', () => {
    const makeResolved = (path: string): ResolvedRoute => ({
      method: RequestMethod.GET,
      path,
      host: undefined,
      version: undefined,
      methodVersion: undefined,
      controllerVersion: undefined,
      handler: () => {},
      targetCallback: () => {},
      methodName: 'x',
      instanceWrapper: { name: 'X' } as any,
    });
    let registerResolvedSpy: ReturnType<typeof vi.spyOn>;

    beforeEach(() => {
      // Let the real explorer resolve routes, but never touch the adapter.
      applyPathsSpy.mockRestore();
      registerResolvedSpy = vi
        .spyOn(routerExplorer, 'registerResolvedRoute')
        .mockImplementation(() => {});
    });

    it('should resolve, install and record the route', () => {
      const resolvedRoutes: ResolvedRoute[] = [];
      registrar.registerLive(
        adapter,
        '/api',
        {
          method: RequestMethod.GET,
          path: '/late',
          handler: () => 'late',
        },
        resolvedRoutes,
      );

      expect(registerResolvedSpy).toHaveBeenCalledTimes(1);
      expect(registerResolvedSpy.mock.calls[0][1]).toMatchObject({
        method: RequestMethod.GET,
        path: '/api/late',
      });
      expect(resolvedRoutes).toHaveLength(1);
      expect(resolvedRoutes[0].path).toBe('/api/late');
    });

    it('should throw the configured conflict error and install nothing', () => {
      applicationConfig.setRouteConflictPolicy({ duplicate: 'error' });
      const resolvedRoutes = [makeResolved('/late')];

      expect(() =>
        registrar.registerLive(
          adapter,
          '',
          {
            method: RequestMethod.GET,
            path: '/late',
            handler: () => {},
          },
          resolvedRoutes,
        ),
      ).toThrow(RouteConflictException);
      expect(registerResolvedSpy).not.toHaveBeenCalled();
      expect(resolvedRoutes).toHaveLength(1);
    });

    it('should warn (not throw) for warn-level conflicts', () => {
      applicationConfig.setRouteConflictPolicy({ shadow: 'warn' });
      const warnSpy = vi
        .spyOn((registrar as any).logger, 'warn')
        .mockImplementation(() => {});

      registrar.registerLive(
        adapter,
        '',
        {
          method: RequestMethod.GET,
          path: '/users/me',
          handler: () => {},
        },
        [makeResolved('/users/:id')],
      );

      expect(warnSpy).toHaveBeenCalledTimes(1);
      expect(registerResolvedSpy).toHaveBeenCalledTimes(1);
    });

    it('should skip duplicate routes on adapters that reject duplicates', () => {
      applicationConfig.setRouteConflictPolicy({ duplicate: 'warn' });
      vi.spyOn((registrar as any).logger, 'warn').mockImplementation(() => {});
      const fastifyLike = Object.assign(new NoopHttpAdapter({}), {
        isRouteOrderSensitive: () => false,
      });

      registrar.registerLive(
        fastifyLike,
        '',
        {
          method: RequestMethod.GET,
          path: '/late',
          handler: () => {},
        },
        [makeResolved('/late')],
      );

      expect(registerResolvedSpy).not.toHaveBeenCalled();
    });

    it('should reject late registration once a duplicate-rejecting adapter is listening', () => {
      const fastifyLike = Object.assign(new NoopHttpAdapter({}), {
        isRouteOrderSensitive: () => false,
      });
      container.getHttpAdapterHostRef().listening = true;

      expect(() =>
        registrar.registerLive(
          fastifyLike,
          '',
          {
            method: RequestMethod.GET,
            path: '/late',
            handler: () => {},
          },
          [],
        ),
      ).toThrow(LateRouteRegistrationException);
      expect(registerResolvedSpy).not.toHaveBeenCalled();
    });

    it('should allow late registration on order-sensitive adapters while listening', () => {
      container.getHttpAdapterHostRef().listening = true;

      registrar.registerLive(
        adapter,
        '',
        {
          method: RequestMethod.GET,
          path: '/late',
          handler: () => {},
        },
        [],
      );

      expect(registerResolvedSpy).toHaveBeenCalledTimes(1);
    });
  });
});
