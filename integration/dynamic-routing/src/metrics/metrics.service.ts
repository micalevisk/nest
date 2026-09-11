import { Injectable } from '@nestjs/common';

@Injectable()
export class MetricsService {
  collect() {
    return { requests: 42 };
  }
}
