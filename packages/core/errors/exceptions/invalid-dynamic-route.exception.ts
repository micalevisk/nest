import { INVALID_DYNAMIC_ROUTE_MESSAGE } from '../messages.js';
import { RuntimeException } from './runtime.exception.js';

export class InvalidDynamicRouteException extends RuntimeException {
  constructor(reason: string) {
    super(INVALID_DYNAMIC_ROUTE_MESSAGE(reason));
  }
}
