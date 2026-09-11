import { RequestMethod } from '@nestjs/common';
import { RouterService } from '@nestjs/core';
import { LateRouteRegistrationException } from '@nestjs/core/errors/exceptions/late-route-registration.exception.js';
import { RouteConflictException } from '@nestjs/core/errors/exceptions/route-conflict.exception.js';
import {
  FastifyAdapter,
  NestFastifyApplication,
} from '@nestjs/platform-fastify';
import { Test } from '@nestjs/testing';
import { AppModule } from '../src/app.module.js';

describe('Dynamic routing (fastify)', () => {
  let app: NestFastifyApplication;

  afterEach(async () => {
    await app?.close();
  });

  const createApp = async (options: Record<string, any> = {}) => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleRef.createNestApplication<NestFastifyApplication>(
      new FastifyAdapter(),
      options,
    );
    await app.init();
    return app;
  };

  it('should serve controller-method and functional dynamic routes', async () => {
    await createApp();
    await app.getHttpAdapter().getInstance().ready();

    const forbidden = await app.inject({ method: 'GET', url: '/health' });
    expect(forbidden.statusCode).toBe(403);

    const ok = await app.inject({
      method: 'GET',
      url: '/health?verbose=1',
      headers: { 'x-api-key': 'secret' },
    });
    expect(ok.statusCode).toBe(200);
    expect(ok.json()).toEqual({ status: 'ok', details: { db: 'up' } });

    const metrics = await app.inject({ method: 'GET', url: '/metrics' });
    expect(metrics.json()).toEqual({ requests: 42 });

    const missing = await app.inject({ method: 'GET', url: '/nope' });
    expect(missing.statusCode).toBe(404);
  });

  it('should install routes registered after init but before the server starts', async () => {
    await createApp();
    app.get(RouterService).register({
      method: RequestMethod.GET,
      path: '/late',
      handler: () => 'late',
    });
    await app.getHttpAdapter().getInstance().ready();

    const res = await app.inject({ method: 'GET', url: '/late' });
    expect(res.statusCode).toBe(200);
    expect(res.body).toBe('late');
  });

  it('should throw LateRouteRegistrationException after listen()', async () => {
    await createApp();
    await app.listen(0);

    expect(() =>
      app.get(RouterService).register({
        method: RequestMethod.GET,
        path: '/too-late',
        handler: () => 'x',
      }),
    ).toThrow(LateRouteRegistrationException);
  });

  it('should drop a live duplicate on Fastify when policy is "warn" (adapter rejects duplicates)', async () => {
    await createApp({
      routeConflictPolicy: { duplicate: 'warn' },
      logger: false,
    });
    expect(() =>
      app.get(RouterService).register({
        method: RequestMethod.GET,
        path: '/metrics',
        handler: () => ({ requests: 0 }),
      }),
    ).not.toThrow();
    await app.getHttpAdapter().getInstance().ready();

    const res = await app.inject({ method: 'GET', url: '/metrics' });
    expect(res.json()).toEqual({ requests: 42 });
  });

  it('should throw RouteConflictException for a live duplicate when policy is "error"', async () => {
    await createApp({
      routeConflictPolicy: { duplicate: 'error' },
      logger: false,
    });
    expect(() =>
      app.get(RouterService).register({
        method: RequestMethod.GET,
        path: '/metrics',
        handler: () => ({ requests: 0 }),
      }),
    ).toThrow(RouteConflictException);
  });
});
