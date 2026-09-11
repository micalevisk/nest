import { Injectable, RequestMethod } from '@nestjs/common';
import { RouterService } from '@nestjs/core';
import { MetricsService } from './metrics.service.js';

@Injectable()
export class MetricsRoutes {
  constructor(router: RouterService) {
    router.register({
      method: RequestMethod.GET,
      path: '/metrics',
      handler: (_req, _res, metrics: MetricsService) => metrics.collect(),
      inject: [MetricsService],
      metadata: { 'x-integration-tag': 'metrics' },
    });
  }
}
