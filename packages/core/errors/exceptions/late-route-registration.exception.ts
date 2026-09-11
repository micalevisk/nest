import { RequestMethod } from '@nestjs/common';
import { LATE_ROUTE_REGISTRATION_MESSAGE } from '../messages.js';
import { RuntimeException } from './runtime.exception.js';

export class LateRouteRegistrationException extends RuntimeException {
  constructor(method: RequestMethod, path: string, adapterName: string) {
    super(
      LATE_ROUTE_REGISTRATION_MESSAGE(RequestMethod[method], path, adapterName),
    );
  }
}
