import { Injectable, OnModuleInit, RequestMethod } from '@nestjs/common';
import { RouterService } from '@nestjs/core';
import { HealthController } from './health.controller.js';

@Injectable()
export class HealthRoutes implements OnModuleInit {
  constructor(private readonly router: RouterService) {}

  onModuleInit() {
    this.router.register({
      method: RequestMethod.GET,
      path: '/health',
      handler: HealthController,
      handlerMethod: 'check',
    });
  }
}
