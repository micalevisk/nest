import { Module, Post, RequestMethod, VersioningType } from '@nestjs/common';
import { MODULE_PATH } from '@nestjs/common/constants.js';
import { Controller } from '../../../common/decorators/core/controller.decorator.js';
import { Get } from '../../../common/decorators/http/request-mapping.decorator.js';
import { ApplicationConfig } from '../../application-config.js';
import { NestContainer } from '../../injector/index.js';
import { Injector } from '../../injector/injector.js';
import { InstanceWrapper } from '../../injector/instance-wrapper.js';
import { GraphInspector } from '../../inspector/graph-inspector.js';
import { SerializedGraph } from '../../inspector/serialized-graph.js';
import { RouterService } from '../../router/router-service.js';
import { RoutesResolver } from '../../router/routes-resolver.js';
import { NoopHttpAdapter } from '../utils/noop-adapter.js';

describe('RoutesResolver', () => {
  @Controller('global')
  class TestRoute {
    @Get('test')
    public getTest() {}

    @Post('another-test')
    public anotherTest() {}
  }

  @Controller({ host: 'api.example.com' })
  class TestHostRoute {
    @Get()
    public getTest() {}
  }

  @Controller({ version: '1' })
  class TestVersionRoute {
    @Get()
    public getTest() {}
  }

  @Module({
    controllers: [TestRoute],
  })
  class TestModule {}

  @Module({
    controllers: [TestRoute],
  })
  class TestModule2 {}

  let router: any;
  let routesResolver: RoutesResolver;
  let untypedRoutesResolver: any;
  let container: NestContainer;
  let modules: Map<string, any>;
  let applicationRef: any;
  let applicationConfig: ApplicationConfig;
  let injector: Injector;
  let graphInspector: GraphInspector;

  beforeEach(() => {
    modules = new Map();
    applicationRef = {
      use: () => ({}),
      setNotFoundHandler: vi.fn(),
      setErrorHandler: vi.fn(),
    } as any;
    container = {
      getModules: () => modules,
      getModuleByKey: (key: string) => modules.get(key),
      getHttpAdapterRef: () => applicationRef,
      getHttpAdapterHostRef: () => undefined,
      getInternalCoreModuleRef: () => undefined,
      serializedGraph: new SerializedGraph(),
    } as any;
    router = {
      get() {},
      post() {},
    };
  });

  beforeEach(() => {
    applicationConfig = new ApplicationConfig();
    injector = new Injector();
    graphInspector = new GraphInspector(container);
    routesResolver = new RoutesResolver(
      container,
      applicationConfig,
      injector,
      graphInspector,
    );
    untypedRoutesResolver = routesResolver as any;
  });

  describe('registerRouters', () => {
    it('should register controllers to router instance', () => {
      const routes = new Map();
      const routeWrapper = new InstanceWrapper({
        instance: new TestRoute(),
        metatype: TestRoute,
      });
      routes.set('TestRoute', routeWrapper);

      const appInstance = new NoopHttpAdapter(router);
      const exploreSpy = vi.spyOn(
        untypedRoutesResolver.routerExplorer,
        'explore',
      );
      const moduleName = '';
      modules.set(moduleName, {});

      vi.spyOn(
        untypedRoutesResolver.routerExplorer,
        'extractRouterPath',
      ).mockImplementation(() => ['']);
      routesResolver.registerRouters(routes, moduleName, '', '', appInstance);

      const routePathMetadata = {
        ctrlPath: '',
        modulePath: '',
        globalPrefix: '',
        controllerVersion: undefined,
        versioningOptions: undefined,
        methodVersion: undefined,
        methodPath: '/another-test',
      };
      expect(exploreSpy).toHaveBeenCalled();
      expect(exploreSpy).toHaveBeenCalledWith(
        routeWrapper,
        moduleName,
        appInstance,
        undefined,
        routePathMetadata,
        {},
      );
    });

    it('should register with host when specified', () => {
      const routes = new Map();
      const routeWrapper = new InstanceWrapper({
        instance: new TestHostRoute(),
        metatype: TestHostRoute,
      });
      routes.set('TestHostRoute', routeWrapper);

      const appInstance = new NoopHttpAdapter(router);
      const exploreSpy = vi.spyOn(
        untypedRoutesResolver.routerExplorer,
        'explore',
      );
      const moduleName = '';
      modules.set(moduleName, {});

      vi.spyOn(
        untypedRoutesResolver.routerExplorer,
        'extractRouterPath',
      ).mockImplementation(() => ['']);
      routesResolver.registerRouters(routes, moduleName, '', '', appInstance);

      const routePathMetadata = {
        ctrlPath: '',
        modulePath: '',
        globalPrefix: '',
        controllerVersion: undefined,
        versioningOptions: undefined,
        methodVersion: undefined,
        methodPath: '/',
      };

      expect(exploreSpy).toHaveBeenCalled();
      expect(exploreSpy).toHaveBeenCalledWith(
        routeWrapper,
        moduleName,
        appInstance,
        'api.example.com',
        routePathMetadata,
        {},
      );
    });

    it('should register with version when specified', () => {
      const applicationConfig = new ApplicationConfig();
      applicationConfig.enableVersioning({
        type: VersioningType.URI,
      });
      routesResolver = new RoutesResolver(
        container,
        applicationConfig,
        new Injector(),
        new GraphInspector(container),
      );
      untypedRoutesResolver = routesResolver as any;

      const routes = new Map();
      const routeWrapper = new InstanceWrapper({
        instance: new TestVersionRoute(),
        metatype: TestVersionRoute,
      });
      routes.set('TestVersionRoute', routeWrapper);

      const appInstance = new NoopHttpAdapter(router);
      const exploreSpy = vi.spyOn(
        untypedRoutesResolver.routerExplorer,
        'explore',
      );
      const moduleName = '';
      modules.set(moduleName, {});

      vi.spyOn(
        untypedRoutesResolver.routerExplorer,
        'extractRouterPath',
      ).mockImplementation(() => ['']);
      routesResolver.registerRouters(routes, moduleName, '', '', appInstance);

      const routePathMetadata = {
        ctrlPath: '',
        modulePath: '',
        globalPrefix: '',
        controllerVersion: '1',
        versioningOptions: {
          type: VersioningType.URI,
        },
        methodVersion: undefined,
        methodPath: '/',
      };

      expect(exploreSpy).toHaveBeenCalled();
      expect(exploreSpy).toHaveBeenCalledWith(
        routeWrapper,
        moduleName,
        appInstance,
        undefined,
        routePathMetadata,
        {},
      );
    });
  });

  describe('resolve', () => {
    it('should call "registerRouters" for each module', () => {
      const routes = new Map();
      routes.set(
        'TestRoute',
        new InstanceWrapper({
          instance: new TestRoute(),
          metatype: TestRoute,
        }),
      );
      modules.set('TestModule', { routes, metatype: class {} });
      modules.set('TestModule2', { routes, metatype: class {} });

      const registerRoutersStub = vi
        .spyOn(routesResolver, 'registerRouters')
        .mockImplementation(() => undefined);

      routesResolver.resolve({ use: vi.fn() } as any, 'basePath');
      expect(registerRoutersStub).toHaveBeenCalledTimes(2);
    });

    describe('registerRouters', () => {
      it('should register each module with the base path and append the module path if present ', () => {
        const routes = new Map();
        routes.set('TestRoute', {
          instance: new TestRoute(),
          metatype: TestRoute,
        });

        Reflect.defineMetadata(MODULE_PATH, '/test', TestModule);
        modules.set('TestModule', { routes, metatype: TestModule });
        modules.set('TestModule2', { routes, metatype: TestModule2 });

        const spy = vi
          .spyOn(routesResolver, 'registerRouters')
          .mockImplementation(() => undefined);

        routesResolver.resolve(applicationRef, 'api/v1');

        expect(spy.mock.calls[0][2]).toBe('api/v1');
        expect(spy.mock.calls[0][3]).toBe('/test');
        expect(spy.mock.calls[1][2]).toBe('api/v1');
      });

      it('should register each module with the module path if present', () => {
        const routes = new Map();
        routes.set('TestRoute', {
          instance: new TestRoute(),
          metatype: TestRoute,
        });

        Reflect.defineMetadata(MODULE_PATH, '/test', TestModule);
        modules.set('TestModule', { routes, metatype: TestModule });
        modules.set('TestModule2', { routes, metatype: TestModule2 });

        const spy = vi
          .spyOn(routesResolver, 'registerRouters')
          .mockImplementation(() => undefined);

        routesResolver.resolve(applicationRef, '');

        expect(spy.mock.calls[0][2]).toBe('');
        expect(spy.mock.calls[0][3]).toBe('/test');
        // without module path
        expect(spy.mock.calls[1][2]).toBe('');
        expect(spy.mock.calls[1][3]).toBeUndefined();
      });
    });
  });

  describe('registerNotFoundHandler', () => {
    it('should register not found handler', () => {
      routesResolver.registerNotFoundHandler();

      expect(applicationRef.setNotFoundHandler).toHaveBeenCalled();
    });
  });

  describe('registerExceptionHandler', () => {
    it('should register exception handler', () => {
      routesResolver.registerExceptionHandler();

      expect(applicationRef.setErrorHandler).toHaveBeenCalled();
    });
  });

  describe('dynamic routes', () => {
    it('should resolve queued RouterService definitions during resolve()', () => {
      const routerService = new RouterService();
      routerService.register({
        method: RequestMethod.GET,
        path: '/dynamic',
        handler: () => 'dynamic',
      });
      const resolver = new RoutesResolver(
        container,
        applicationConfig,
        injector,
        graphInspector,
        routerService,
      );
      const resolved: string[] = [];

      resolver.resolve(applicationRef, '/api', {
        deferRegistration: true,
        onRouteResolved: route => resolved.push(route.path),
      });

      expect(resolved).toContain('/api/dynamic');
    });

    it('should install definitions registered after resolve() immediately', () => {
      const routerService = new RouterService();
      const resolver = new RoutesResolver(
        container,
        applicationConfig,
        injector,
        graphInspector,
        routerService,
      );
      resolver.resolve(applicationRef, '');
      const registerSpy = vi
        .spyOn((resolver as any).routerExplorer, 'registerResolvedRoute')
        .mockImplementation(() => {});

      routerService.register({
        method: RequestMethod.GET,
        path: '/late',
        handler: () => 'late',
      });

      expect(registerSpy).toHaveBeenCalledTimes(1);
      expect(registerSpy.mock.calls[0][1]).toMatchObject({ path: '/late' });
    });
  });
});
