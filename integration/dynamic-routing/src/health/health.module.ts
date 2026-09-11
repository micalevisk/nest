import {
  MiddlewareConsumer,
  Module,
  NestModule,
  RequestMethod,
} from '@nestjs/common';
import { ApiKeyGuard } from './api-key.guard.js';
import { HealthRoutes } from './health-routes.js';
import { HealthController } from './health.controller.js';
import { HealthService } from './health.service.js';

@Module({
  controllers: [HealthController],
  providers: [HealthService, ApiKeyGuard, HealthRoutes],
})
export class HealthModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    // Path-based, not `forRoutes(HealthController)`: the controller isn't
    // decorated with `@Get('health')`, so the middleware would never match
    // a route registered dynamically through `RouterService`.
    consumer
      .apply((req: any, res: any, next: () => void) => {
        res.setHeader('x-dynamic-mw', '1');
        next();
      })
      .forRoutes({ path: 'health', method: RequestMethod.ALL });
  }
}
