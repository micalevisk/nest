import { Module } from '@nestjs/common';
import { HealthModule } from './health/health.module.js';
import { MetricsModule } from './metrics/metrics.module.js';

@Module({
  imports: [HealthModule, MetricsModule],
})
export class AppModule {}
