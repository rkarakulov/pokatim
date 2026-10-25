import { z } from 'zod';

import { fieldError, SINGLE_LINE, Uuid, Version } from '../common.ts';
import { LocalDate } from '../time.ts';

/**
 * Фаза сезона — вычисляет сервер по датам Минска и `CLOCK` (статуса публикации у сезона нет, Q5). Только в конец.
 */
export const SEASON_PHASES = ['upcoming', 'current', 'finished'] as const;
export const SeasonPhase = z.enum(SEASON_PHASES);
export type SeasonPhase = z.infer<typeof SeasonPhase>;

export const SEASON_NAME_MIN_LENGTH = 2;
export const SEASON_NAME_MAX_LENGTH = 60;

/** Название сезона обязательно (Q16): 2–60 символов, без управляющих. */
export const SeasonName = z
  .string({ error: fieldError('REQUIRED') })
  .trim()
  .min(1, { error: 'REQUIRED', abort: true })
  .min(SEASON_NAME_MIN_LENGTH, { error: 'TOO_SHORT', abort: true })
  .max(SEASON_NAME_MAX_LENGTH, { error: 'TOO_LONG' })
  .regex(SINGLE_LINE, { error: 'INVALID' });

/**
 * `POST /v1/admin/seasons` (`seasons.manage`) → 201 `PanelSeason`. Даты — календарные Минска, конец включительно.
 * Пересечение, порядок дат, «в прошлом» — правила сервера (`SEASON_OVERLAP`, `DATE_ORDER`, `SEASON_IN_PAST`).
 */
export const SeasonInput = z.strictObject({
  name: SeasonName,
  startsOn: LocalDate,
  endsOn: LocalDate,
});
export type SeasonInput = z.infer<typeof SeasonInput>;

/** `POST /v1/admin/seasons/:id` — изменённые поля + ожидаемая `version` (устаревшая — 409 `CONFLICT`). */
export const UpdateSeasonRequest = SeasonInput.partial().extend({ version: Version });
export type UpdateSeasonRequest = z.infer<typeof UpdateSeasonRequest>;

/** Сезон в панели; `raceCount` — опубликованные и отменённые гонки сезона. */
export const PanelSeason = z.object({
  id: Uuid,
  name: z.string(),
  startsOn: LocalDate,
  endsOn: LocalDate,
  phase: SeasonPhase,
  raceCount: z.number().int().nonnegative(),
  version: Version,
});
export type PanelSeason = z.infer<typeof PanelSeason>;

/** `GET /v1/admin/seasons` (`races.read`) — все сезоны (их десятки), новые сверху. */
export const PanelSeasonList = z.object({ items: z.array(PanelSeason) });
export type PanelSeasonList = z.infer<typeof PanelSeasonList>;
