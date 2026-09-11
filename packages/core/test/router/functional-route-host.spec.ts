import {
  RESPONSE_PASSTHROUGH_METADATA,
  ROUTE_ARGS_METADATA,
  RouteParamtypes,
} from '@nestjs/common/internal';
import { CONTROLLER_ID_KEY } from '../../injector/constants.js';
import {
  FUNCTIONAL_ROUTE_HANDLER_METHOD,
  FunctionalRouteHost,
} from '../../router/functional-route-host.js';

describe('FunctionalRouteHost', () => {
  it('should invoke the handler with (req, res, ...deps)', () => {
    const handler = vi.fn().mockReturnValue('ok');
    const dep = { name: 'dep' };
    const host = new FunctionalRouteHost(handler, [dep]);

    const req = {};
    const res = {};
    expect(host.handle(req, res)).toBe('ok');
    expect(handler).toHaveBeenCalledWith(req, res, dep);
  });

  it('should declare request/response parameters with passthrough', () => {
    const args = Reflect.getMetadata(
      ROUTE_ARGS_METADATA,
      FunctionalRouteHost,
      FUNCTIONAL_ROUTE_HANDLER_METHOD,
    );
    expect(args[`${RouteParamtypes.REQUEST}:0`]).toMatchObject({ index: 0 });
    expect(args[`${RouteParamtypes.RESPONSE}:1`]).toMatchObject({ index: 1 });
    expect(
      Reflect.getMetadata(
        RESPONSE_PASSTHROUGH_METADATA,
        FunctionalRouteHost,
        FUNCTIONAL_ROUTE_HANDLER_METHOD,
      ),
    ).toBe(true);
  });

  it('should define route metadata on the per-instance handle function', () => {
    const sym = Symbol('tag');
    const a = new FunctionalRouteHost(() => {}, [], {
      role: 'admin',
      [sym]: 1,
    });
    const b = new FunctionalRouteHost(() => {}, []);

    expect(Reflect.getMetadata('role', a.handle)).toBe('admin');
    expect(Reflect.getMetadata(sym, a.handle)).toBe(1);
    expect(Reflect.getMetadata('role', b.handle)).toBeUndefined();
    expect(a.handle).not.toBe(b.handle);
  });

  describe('createRouteClass', () => {
    it('should give each route its own subclass with a distinct CONTROLLER_ID_KEY', () => {
      const ClassA = FunctionalRouteHost.createRouteClass('RouteA');
      const ClassB = FunctionalRouteHost.createRouteClass('RouteB');

      expect(ClassA).not.toBe(ClassB);
      expect((ClassA as any)[CONTROLLER_ID_KEY]).toEqual(expect.any(String));
      expect((ClassB as any)[CONTROLLER_ID_KEY]).toEqual(expect.any(String));
      expect((ClassA as any)[CONTROLLER_ID_KEY]).not.toBe(
        (ClassB as any)[CONTROLLER_ID_KEY],
      );
    });

    it('should produce classes that extend FunctionalRouteHost', () => {
      const ClassA = FunctionalRouteHost.createRouteClass('RouteA');
      const instance = new ClassA(() => 'ok', []);

      expect(instance).toBeInstanceOf(FunctionalRouteHost);
      expect(Object.getPrototypeOf(ClassA)).toBe(FunctionalRouteHost);
    });

    it('should still expose the parent class ROUTE_ARGS_METADATA through the prototype chain', () => {
      const ClassA = FunctionalRouteHost.createRouteClass('RouteA');
      const ClassB = FunctionalRouteHost.createRouteClass('RouteB');

      for (const RouteClass of [ClassA, ClassB]) {
        const args = Reflect.getMetadata(
          ROUTE_ARGS_METADATA,
          RouteClass,
          FUNCTIONAL_ROUTE_HANDLER_METHOD,
        );
        expect(args[`${RouteParamtypes.REQUEST}:0`]).toMatchObject({
          index: 0,
        });
        expect(args[`${RouteParamtypes.RESPONSE}:1`]).toMatchObject({
          index: 1,
        });
      }
    });
  });
});
