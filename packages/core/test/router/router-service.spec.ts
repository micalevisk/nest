import { RequestMethod } from '@nestjs/common';
import { InvalidDynamicRouteException } from '../../errors/exceptions/invalid-dynamic-route.exception.js';
import { DynamicRouteDefinition } from '../../router/interfaces/dynamic-route.interface.js';
import { RouterService } from '../../router/router-service.js';

describe('RouterService', () => {
  class HealthController {
    check() {}
  }
  const controllerRoute: DynamicRouteDefinition = {
    method: RequestMethod.GET,
    path: '/health',
    handler: HealthController,
    handlerMethod: 'check',
  };
  const functionalRoute: DynamicRouteDefinition = {
    method: RequestMethod.GET,
    path: '/metrics',
    handler: () => 'metrics',
  };

  let service: RouterService;
  beforeEach(() => {
    service = new RouterService();
  });

  describe('register', () => {
    it('should queue definitions until a registrar is bound', () => {
      service.register(controllerRoute);
      service.register(functionalRoute);

      const registrar = vi.fn();
      service.bindRegistrar(registrar);

      expect(registrar).toHaveBeenCalledTimes(2);
      expect(registrar.mock.calls[0][0]).toMatchObject(controllerRoute);
      expect(registrar.mock.calls[1][0]).toMatchObject(functionalRoute);
    });

    it('should forward definitions to the bound registrar immediately', () => {
      const registrar = vi.fn();
      service.bindRegistrar(registrar);

      service.register(functionalRoute);

      expect(registrar).toHaveBeenCalledTimes(1);
      expect(registrar.mock.calls[0][0]).toMatchObject(functionalRoute);
    });

    it('should not replay already-drained definitions when rebinding', () => {
      service.register(functionalRoute);
      service.bindRegistrar(vi.fn());

      const second = vi.fn();
      service.bindRegistrar(second);

      expect(second).not.toHaveBeenCalled();
    });

    it('should expose registered definitions as frozen snapshots', () => {
      service.register(controllerRoute);

      const [route] = service.getRoutes();
      expect(route).toMatchObject(controllerRoute);
      expect(Object.isFrozen(route)).toBe(true);
      expect(service.getRoutes()).toHaveLength(1);
    });

    it.each([
      ['missing method', { path: '/x', handler: () => {} }],
      ['unknown method', { method: 999, path: '/x', handler: () => {} }],
      [
        'empty path',
        { method: RequestMethod.GET, path: '', handler: () => {} },
      ],
      [
        'empty path array',
        { method: RequestMethod.GET, path: [], handler: () => {} },
      ],
      [
        'non-function handler',
        { method: RequestMethod.GET, path: '/x', handler: 'nope' },
      ],
      [
        'handlerMethod without class',
        {
          method: RequestMethod.GET,
          path: '/x',
          handler: () => {},
          handlerMethod: 42,
        },
      ],
      [
        'non-array inject',
        {
          method: RequestMethod.GET,
          path: '/x',
          handler: () => {},
          inject: 'Svc',
        },
      ],
      [
        'non-object metadata',
        {
          method: RequestMethod.GET,
          path: '/x',
          handler: () => {},
          metadata: 'x',
        },
      ],
      [
        'array metadata',
        {
          method: RequestMethod.GET,
          path: '/x',
          handler: () => {},
          metadata: ['nope'],
        },
      ],
      [
        'class handler without handlerMethod',
        {
          method: RequestMethod.GET,
          path: '/x',
          handler: HealthController,
        },
      ],
    ])('should throw InvalidDynamicRouteException for %s', (_, definition) => {
      expect(() => service.register(definition as any)).toThrow(
        InvalidDynamicRouteException,
      );
    });

    it('should call a bound registrar before recording the snapshot, and rethrow (and not record it) when the registrar throws', () => {
      const error = new Error('conflict');
      const registrar = vi.fn().mockImplementation(() => {
        throw error;
      });
      service.bindRegistrar(registrar);

      expect(() => service.register(functionalRoute)).toThrow(error);
      expect(registrar).toHaveBeenCalledTimes(1);
      expect(service.getRoutes()).toHaveLength(0);
    });
  });
});
