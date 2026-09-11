import { RequestMethod } from '@nestjs/common';
import { LATE_ROUTE_REGISTRATION_MESSAGE } from '../messages.js';
import { RuntimeException } from './runtime.exception.js';

/**
 * Thrown when `RouterService#register()` is called after the HTTP adapter
 * has started listening on an adapter whose route table freezes once the
 * server starts (e.g. Fastify); registering after a manual
 * `instance.ready()` on such an adapter is rejected by the adapter itself
 * instead of throwing this exception.
 */
export class LateRouteRegistrationException extends RuntimeException {
  constructor(method: RequestMethod, path: string, adapterName: string) {
    super(
      LATE_ROUTE_REGISTRATION_MESSAGE(RequestMethod[method], path, adapterName),
    );
  }
}
