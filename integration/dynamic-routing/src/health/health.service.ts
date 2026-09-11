import { Injectable } from '@nestjs/common';

@Injectable()
export class HealthService {
  details() {
    return { db: 'up' };
  }
}
