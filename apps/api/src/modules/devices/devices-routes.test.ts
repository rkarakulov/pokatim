import 'reflect-metadata';

import {
  GUARDS_METADATA,
  METHOD_METADATA,
  MODULE_METADATA,
  PATH_METADATA,
} from '@nestjs/common/constants';
import { describe, expect, it } from 'vitest';

import { AuthGuard } from '../identity';
import { DevicesModule } from './devices.module';

type Constructor = abstract new (...args: never[]) => unknown;

const controllers = (Reflect.getMetadata(MODULE_METADATA.CONTROLLERS, DevicesModule) ??
  []) as Constructor[];
const guardsOf = (target: object) =>
  (Reflect.getMetadata(GUARDS_METADATA, target) ?? []) as unknown[];

function routes() {
  return controllers.flatMap((controller) => {
    const prototype = controller.prototype as Record<string, unknown>;
    return Object.getOwnPropertyNames(prototype)
      .filter((name) => name !== 'constructor')
      .map((name) => ({ controller, name, handler: prototype[name] as object }))
      .filter(({ handler }) => Reflect.getMetadata(METHOD_METADATA, handler) !== undefined);
  });
}

/**
 * §8.3 п. 1: все маршруты `devices` — под `AuthGuard`, кроме возврата из агрегатора (`GET /v1/devices/callback`,
 * ничего не меняет) и вебхука (`POST /v1/devices/webhook`, подпись Svix). Новый маршрут без гарда — красный тест.
 */
describe('маршруты /v1/devices/* под AuthGuard', () => {
  it('без входа — только callback и webhook', () => {
    const open = routes()
      .filter(
        ({ controller, handler }) =>
          ![...guardsOf(controller), ...guardsOf(handler)].includes(AuthGuard),
      )
      .map(
        ({ controller, name }) =>
          `${String(Reflect.getMetadata(PATH_METADATA, controller))}.${name}`,
      )
      .sort();
    expect(open).toEqual(['devices/callback.callback', 'devices/webhook.receive']);
  });

  it('остальные — экран, connect, complete, sync, disconnect', () => {
    const guarded = routes()
      .filter(({ controller, handler }) =>
        [...guardsOf(controller), ...guardsOf(handler)].includes(AuthGuard),
      )
      .map(({ name }) => name)
      .sort();
    expect(guarded).toEqual(['complete', 'connect', 'disconnect', 'list', 'sync']);
  });
});
