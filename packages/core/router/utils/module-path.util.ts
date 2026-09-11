import type { Type } from '@nestjs/common';
import { MODULE_PATH } from '@nestjs/common/internal';
import { NestContainer } from '../../injector/container.js';

/**
 * Returns the path registered for a module through `RouterModule`
 * (application-scoped key first, then the legacy global key).
 */
export function getModulePathMetadata(
  container: NestContainer,
  metatype: Type<unknown>,
): string | undefined {
  const modulesContainer = container.getModules();
  const modulePath = Reflect.getMetadata(
    MODULE_PATH + modulesContainer.applicationId,
    metatype,
  );
  return modulePath ?? Reflect.getMetadata(MODULE_PATH, metatype);
}
