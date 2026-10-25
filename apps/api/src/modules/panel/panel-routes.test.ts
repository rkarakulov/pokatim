import 'reflect-metadata';

import { readdirSync } from 'node:fs';

import {
  GUARDS_METADATA,
  METHOD_METADATA,
  MODULE_METADATA,
  PATH_METADATA,
} from '@nestjs/common/constants';
import { describe, expect, it } from 'vitest';

import { PanelGuard } from './panel.guard';
import { PanelModule } from './panel.module';
import { PANEL_PUBLIC } from './public.decorator';

type Constructor = abstract new (...args: never[]) => unknown;

const controllers = (Reflect.getMetadata(MODULE_METADATA.CONTROLLERS, PanelModule) ??
  []) as Constructor[];

/** Маршруты контроллеров: обработчики с методом HTTP. */
function routes() {
  return controllers.flatMap((controller) => {
    const prototype = controller.prototype as Record<string, unknown>;
    return Object.getOwnPropertyNames(prototype)
      .filter((name) => name !== 'constructor')
      .map((name) => ({ controller, name, handler: prototype[name] as object }))
      .filter(({ handler }) => Reflect.getMetadata(METHOD_METADATA, handler) !== undefined);
  });
}

const guardsOf = (target: object) =>
  (Reflect.getMetadata(GUARDS_METADATA, target) ?? []) as unknown[];

/**
 * Каждый маршрут панели — под `PanelGuard` (§8.3 п. 1): гард ставит `no-store` и проверяет сессию; без сессии —
 * только явный `@Public()` (вход и выход). Новый контроллер или маршрут без гарда — красный тест.
 */
describe('маршруты /v1/admin/* под PanelGuard', () => {
  it('все контроллеры модуля — с путём admin/*; каждый файл *.controller.ts зарегистрирован в PanelModule', () => {
    expect(controllers.length).toBeGreaterThan(0);
    for (const controller of controllers) {
      expect(String(Reflect.getMetadata(PATH_METADATA, controller))).toMatch(/^admin(\/|$)/);
    }
    const files = readdirSync(__dirname).filter((file) => file.endsWith('.controller.ts'));
    expect(files.length).toBe(controllers.length);
  });

  it('каждый маршрут — под PanelGuard (на контроллере или обработчике)', () => {
    for (const { controller, handler, name } of routes()) {
      const guards = [...guardsOf(controller), ...guardsOf(handler)];
      expect(guards, `${controller.name}.${name}`).toContain(PanelGuard);
    }
  });

  it('без сессии — только вход и выход (явный @Public)', () => {
    const open = routes()
      .filter(
        ({ controller, handler }) =>
          Reflect.getMetadata(PANEL_PUBLIC, handler) === true ||
          Reflect.getMetadata(PANEL_PUBLIC, controller) === true,
      )
      .map(({ controller, name }) => `${controller.name}.${name}`)
      .sort();
    expect(open).toEqual(['PanelSessionController.signIn', 'PanelSessionController.signOut']);
  });
});
