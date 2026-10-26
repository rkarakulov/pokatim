import 'reflect-metadata';

import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';

import {
  GUARDS_METADATA,
  METHOD_METADATA,
  MODULE_METADATA,
  PATH_METADATA,
} from '@nestjs/common/constants';
import { describe, expect, it } from 'vitest';

import { AppModule } from './app.module';
import { PanelGuard } from './modules/panel';
import { PANEL_PUBLIC } from './modules/panel/public.decorator';

type Constructor = abstract new (...args: never[]) => unknown;

/** Модули, достижимые из `AppModule` (классы и динамические `{ module }`), без повторов. */
function modules(root: unknown, seen = new Set<unknown>()): Set<unknown> {
  const target =
    root && typeof root === 'object' && 'module' in root
      ? (root as { module: unknown }).module
      : root;
  if (!target || seen.has(target)) return seen;
  seen.add(target);
  const imports = (Reflect.getMetadata(MODULE_METADATA.IMPORTS, target as object) ??
    []) as unknown[];
  const dynamicImports =
    root && typeof root === 'object' && 'imports' in root
      ? ((root as { imports?: unknown[] }).imports ?? [])
      : [];
  for (const child of [...imports, ...dynamicImports]) modules(child, seen);
  return seen;
}

const controllers = [
  ...new Set(
    [...modules(AppModule)].flatMap(
      (module) =>
        (Reflect.getMetadata(MODULE_METADATA.CONTROLLERS, module as object) ?? []) as Constructor[],
    ),
  ),
];

const pathOf = (controller: Constructor) => String(Reflect.getMetadata(PATH_METADATA, controller));
const adminControllers = controllers.filter((controller) =>
  /^admin(\/|$)/.test(pathOf(controller)),
);

/** Маршруты контроллеров: обработчики с методом HTTP. */
function routes() {
  return adminControllers.flatMap((controller) => {
    const prototype = controller.prototype as Record<string, unknown>;
    return Object.getOwnPropertyNames(prototype)
      .filter((name) => name !== 'constructor')
      .map((name) => ({ controller, name, handler: prototype[name] as object }))
      .filter(({ handler }) => Reflect.getMetadata(METHOD_METADATA, handler) !== undefined);
  });
}

const guardsOf = (target: object) =>
  (Reflect.getMetadata(GUARDS_METADATA, target) ?? []) as unknown[];

/** Исходники контроллеров всех модулей. */
function controllerFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return controllerFiles(path);
    return entry.name.endsWith('.controller.ts') ? [path] : [];
  });
}

/**
 * Каждый маршрут `/v1/admin/*` любого модуля приложения — под `PanelGuard` (admin-01 §8.3 п. 1, admin-02 AC1): гард
 * ставит `no-store` и проверяет сессию и права; без сессии — только явный `@Public()` (вход и выход панели). Новый
 * контроллер `admin/*` без гарда или не зарегистрированный в модуле — красный тест.
 */
describe('маршруты /v1/admin/* всех модулей под PanelGuard', () => {
  it('каждый файл с @Controller(admin…) зарегистрирован в модуле AppModule', () => {
    const SRC = __dirname;
    const declared = controllerFiles(join(SRC, 'modules'))
      // строкой в любых кавычках или объектом `{ path: 'admin…' }`
      .filter((file) =>
        /@Controller\(\s*(\{[^)]*path:\s*)?['"`]admin(\/|['"`])/.test(readFileSync(file, 'utf8')),
      )
      .map((file) => relative(SRC, file))
      .sort();
    expect(declared.length).toBeGreaterThan(0);
    expect(adminControllers.length).toBe(declared.length);
  });

  it('контроллеры панели — в нескольких модулях (panel, races, calendar, routes, results)', () => {
    const names = adminControllers.map((controller) => controller.name);
    expect(names).toEqual(
      expect.arrayContaining([
        'PanelSessionController',
        'PanelMembersController',
        'PanelAuditController',
        'SeasonsAdminController',
        'RacesAdminController',
        'CalendarAdminController',
        'RoutesAdminController',
        'ResultsAdminController',
      ]),
    );
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
