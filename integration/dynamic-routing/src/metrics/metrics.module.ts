import { Module } from '@nestjs/common';
import { MetricsRoutes } from './metrics-routes.js';
import { MetricsService } from './metrics.service.js';

@Module({
  providers: [MetricsService, MetricsRoutes],
})
export class MetricsModule {}
