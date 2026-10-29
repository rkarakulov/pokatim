import { z } from 'zod';

import { fieldError, tolerantEnum, Version } from '../common.ts';

/**
 * Темы приложения (app-themes): единственный источник id для API и панели; реестр `appThemes` в
 * `@pokatim/design-tokens` объявляет тот же состав и порядок. Только в конец; порядок = порядок карточек в панели.
 */
export const APP_THEME_IDS = [
  'classic',
  'atlas',
  'chrono',
  'planner',
  'journal',
  'navigation',
  'typography',
] as const;
export const AppThemeId = z.enum(APP_THEME_IDS, { error: fieldError('INVALID') });
export type AppThemeId = z.infer<typeof AppThemeId>;

/** Тема по умолчанию: нет настройки, незнакомый id, нет сети. */
export const DEFAULT_APP_THEME_ID = 'classic' satisfies AppThemeId;

/**
 * Сезонный декор (halloween-decor): слой поверх активной темы, не тема. Только в конец; `none` — без декора.
 */
export const APP_DECOR_IDS = ['none', 'halloween'] as const;
export const AppDecorId = z.enum(APP_DECOR_IDS, { error: fieldError('INVALID') });
export type AppDecorId = z.infer<typeof AppDecorId>;

/** Декор по умолчанию: нет настройки, незнакомый id, нет сети. */
export const DEFAULT_APP_DECOR_ID = 'none' satisfies AppDecorId;

/**
 * `GET /v1/appearance` — ответ приложения: тема и декор; незнакомые — `'unknown'` (клиент → «Классика», без декора).
 * `decor` нет у ответа API до halloween-decor — поле необязательное.
 *
 * `themeId` устарел (user-theme, ADR-0021): тема — личная (`ProfileView.themeId`), сервер всегда отдаёт `'classic'`
 * для сборок до user-theme, у которых поле обязательное. Удаление — только новой версией эндпоинта.
 */
export const AppAppearance = z.object({
  themeId: tolerantEnum(APP_THEME_IDS),
  decor: tolerantEnum(APP_DECOR_IDS).optional(),
});
export type AppAppearance = z.infer<typeof AppAppearance>;

/** `GET|PUT /v1/admin/appearance` — ответ панели: только декор (строгий enum: панель деплоится с API). */
export const PanelAppearance = z.object({
  decor: AppDecorId,
  version: Version,
  /** `null` — настройку ещё не меняли (действует «без декора»). */
  updatedAt: z.iso.datetime().nullable(),
});
export type PanelAppearance = z.infer<typeof PanelAppearance>;

/**
 * `PUT /v1/admin/appearance` — намерение: декор и ожидаемая версия. Лишние ключи (в т. ч. `themeId` — тема личная,
 * user-theme) — 400.
 */
export const UpdateAppearanceRequest = z.strictObject({ decor: AppDecorId, version: Version });
export type UpdateAppearanceRequest = z.infer<typeof UpdateAppearanceRequest>;
