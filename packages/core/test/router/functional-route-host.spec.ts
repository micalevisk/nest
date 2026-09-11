import {
  RESPONSE_PASSTHROUGH_METADATA,
  ROUTE_ARGS_METADATA,
  RouteParamtypes,
} from '@nestjs/common/internal';
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
});
