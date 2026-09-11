import { Module } from '@nestjs/common';
import { ApiKeyGuard } from './api-key.guard.js';
import { HealthRoutes } from './health-routes.js';
import { HealthController } from './health.controller.js';
import { HealthService } from './health.service.js';

@Module({
  controllers: [HealthController],
  providers: [HealthService, ApiKeyGuard, HealthRoutes],
})
export class HealthModule {}
