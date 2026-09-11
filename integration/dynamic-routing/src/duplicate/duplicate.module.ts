import { Injectable, Module, RequestMethod } from '@nestjs/common';
import { RouterService } from '@nestjs/core';

@Injectable()
export class DuplicateHealthRoutes {
  constructor(router: RouterService) {
    router.register({
      method: RequestMethod.GET,
      path: '/health',
      handler: () => ({ status: 'duplicate' }),
    });
  }
}

@Module({ providers: [DuplicateHealthRoutes] })
export class DuplicateModule {}
