import { Controller, Query, UseGuards } from '@nestjs/common';
import { ApiKeyGuard } from './api-key.guard.js';
import { HealthService } from './health.service.js';

@Controller()
export class HealthController {
  constructor(private readonly healthService: HealthService) {}

  @UseGuards(ApiKeyGuard)
  check(@Query('verbose') verbose?: string) {
    return verbose
      ? { status: 'ok', details: this.healthService.details() }
      : { status: 'ok' };
  }
}
