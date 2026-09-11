import {
  BadRequestException,
  INestApplication,
  RequestMethod,
  VersioningType,
} from '@nestjs/common';
import { RouterService } from '@nestjs/core';
import { RouteConflictException } from '@nestjs/core/errors/exceptions/route-conflict.exception.js';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module.js';
import { DuplicateModule } from '../src/duplicate/duplicate.module.js';
import { HealthModule } from '../src/health/health.module.js';

describe('Dynamic routing (express)', () => {
  let app: INestApplication;

  afterEach(async () => {
    await app?.close();
  });

  const createApp = async (
    imports: any[] = [AppModule],
    configure?: (app: INestApplication) => void,
    options: Record<string, any> = {},
  ) => {
    const moduleRef = await Test.createTestingModule({ imports }).compile();
    app = moduleRef.createNestApplication(options);
    configure?.(app);
    await app.init();
    return app.getHttpServer();
  };

  it('should serve a controller method registered in onModuleInit (guards + params apply)', async () => {
    const server = await createApp();
    await request(server).get('/health').expect(403);
    await request(server)
      .get('/health')
      .set('x-api-key', 'secret')
      .expect(200)
      .expect({ status: 'ok' });
    await request(server)
      .get('/health?verbose=1')
      .set('x-api-key', 'secret')
      .expect(200)
      .expect({ status: 'ok', details: { db: 'up' } });
  });

  it('should run module middleware applied path-based against a dynamic route', async () => {
    const server = await createApp();
    await request(server)
      .get('/health')
      .set('x-api-key', 'secret')
      .expect(200)
      .expect('x-dynamic-mw', '1');
  });

  it('should serve a functional handler registered before bootstrap with injected deps', async () => {
    const server = await createApp();
    await request(server).get('/metrics').expect(200).expect({ requests: 42 });
    await request(server).post('/metrics').expect(404);
  });

  it('should expose registered definitions through RouterService#getRoutes()', async () => {
    await createApp();
    const routes = app.get(RouterService).getRoutes();
    expect(routes.map(r => r.path)).toEqual(['/metrics', '/health']);
    expect(routes[0]).toMatchObject({
      metadata: { 'x-integration-tag': 'metrics' },
    });
  });

  it('should apply the global prefix and URI versioning', async () => {
    const server = await createApp([AppModule], app => {
      app.setGlobalPrefix('api');
      app.enableVersioning({ type: VersioningType.URI, defaultVersion: '1' });
      app.get(RouterService).register({
        method: RequestMethod.GET,
        path: '/versioned',
        version: '2',
        handler: () => 'v2',
      });
    });
    await request(server)
      .get('/api/v1/health')
      .set('x-api-key', 'secret')
      .expect(200);
    await request(server).get('/api/v2/versioned').expect(200, 'v2');
    await request(server).get('/api/v1/versioned').expect(404);
  });

  it('should install routes registered after init (after the not-found handler)', async () => {
    const server = await createApp();
    await request(server).get('/late').expect(404);

    app.get(RouterService).register({
      method: RequestMethod.GET,
      path: '/late',
      handler: (_req, res) => {
        res.setHeader('x-late', '1');
        return 'late';
      },
    });

    await request(server)
      .get('/late')
      .expect(200, 'late')
      .expect('x-late', '1');
    await request(server).get('/still-missing').expect(404);
  });

  it('should still route a late functional handler through the exception layer', async () => {
    const server = await createApp();

    app.get(RouterService).register({
      method: RequestMethod.GET,
      path: '/late-error',
      handler: () => {
        throw new BadRequestException('late boom');
      },
    });

    await request(server)
      .get('/late-error')
      .expect(400)
      .expect(res => {
        expect(res.body).toMatchObject({ message: 'late boom' });
      });
  });

  it('should install routes registered after listen()', async () => {
    await createApp();
    await app.listen(0);
    app.get(RouterService).register({
      method: RequestMethod.POST,
      path: '/after-listen',
      handler: () => ({ ok: true }),
    });
    await request(app.getHttpServer())
      .post('/after-listen')
      .expect(201)
      .expect({ ok: true });
  });

  it('should reject duplicate dynamic routes when routeConflictPolicy.duplicate is "error"', async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [HealthModule, DuplicateModule],
    }).compile();
    app = moduleRef.createNestApplication({
      routeConflictPolicy: { duplicate: 'error' },
      logger: false,
    });
    await expect(app.init()).rejects.toBeInstanceOf(RouteConflictException);
  });

  it('should reject a live duplicate registration when the policy is "error"', async () => {
    await createApp([AppModule], undefined, {
      routeConflictPolicy: { duplicate: 'error' },
      logger: false,
    });
    expect(() =>
      app.get(RouterService).register({
        method: RequestMethod.GET,
        path: '/metrics',
        handler: () => 'dup',
      }),
    ).toThrow(RouteConflictException);
  });

  it('should route ALL-method dynamic routes with host filtering', async () => {
    const server = await createApp([AppModule], app => {
      app.get(RouterService).register({
        method: RequestMethod.ALL,
        path: '/tenant',
        host: ':tenant.example.com',
        handler: req => ({ tenant: req.hosts.tenant }),
      });
    });
    await request(server)
      .get('/tenant')
      .set('Host', 'acme.example.com')
      .expect(200)
      .expect({ tenant: 'acme' });
    await request(server).get('/tenant').expect(404);
  });
});
