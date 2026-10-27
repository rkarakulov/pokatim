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

/** `GET /v1/appearance` — ответ приложения: только тема; незнакомая — `'unknown'` (клиент → «Классика»). */
export const AppAppearance = z.object({ themeId: tolerantEnum(APP_THEME_IDS) });
export type AppAppearance = z.infer<typeof AppAppearance>;

/** `GET|PUT /v1/admin/appearance` — ответ панели (строгий enum: панель деплоится с API). */
export const PanelAppearance = z.object({
  themeId: AppThemeId,
  version: Version,
  /** `null` — настройку ещё не меняли (действует «Классика»). */
  updatedAt: z.iso.datetime().nullable(),
});
export type PanelAppearance = z.infer<typeof PanelAppearance>;

/** `PUT /v1/admin/appearance` — намерение: тема из списка и ожидаемая версия. Лишние ключи — 400. */
export const UpdateAppearanceRequest = z.strictObject({ themeId: AppThemeId, version: Version });
export type UpdateAppearanceRequest = z.infer<typeof UpdateAppearanceRequest>;
