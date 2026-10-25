import { z } from 'zod';

import { PageQuery, queryArray, tolerantEnum, Uuid } from '../common.ts';
import { LocalDate, YearMonth } from '../time.ts';
import {
  BIKE_CLASSES,
  BikeClass,
  PageCursor,
  RACE_CANCEL_REASONS,
  RACE_PHASES,
  SURFACES,
} from './race.schema.ts';
import { SEASON_PHASES } from './season.schema.ts';

/*
 * Read-модель приложения (публичное чтение без входа, Q14): только опубликованные и отменённые гонки. Enum-ы ответов —
 * `tolerantEnum` (R6): новое значение у старой сборки — `'unknown'`, экран показывает нейтральный вариант.
 */

export const RACE_LIST_SCOPES = ['current', 'past'] as const;
export const RACE_LIST_MAX_LIMIT = 50;

/**
 * `GET /v1/races?scope&bikeClass&month&cursor&limit` → `RacePage`. `current` — опубликованные с незакрытым окном (по
 * началу окна), `past` — закрытые и отменённые (по концу окна, новые сверху). Внутри фильтра — ИЛИ, между — И; месяц
 * — окно пересекает месяц по Минску. Лишние ключи — 400.
 */
export const RaceListQuery = z.strictObject({
  ...PageQuery.shape,
  limit: z.coerce.number().int().min(1).max(RACE_LIST_MAX_LIMIT).default(20),
  cursor: PageCursor.optional(),
  scope: z.enum(RACE_LIST_SCOPES).default('current'),
  bikeClass: queryArray(BikeClass, BIKE_CLASSES.length).optional(),
  month: queryArray(YearMonth, 12).optional(),
});
export type RaceListQuery = z.infer<typeof RaceListQuery>;

/** Сезон в приложении (`GET /v1/seasons/current`, заголовки «Сезон 2026»). */
export const SeasonCard = z.object({
  id: Uuid,
  name: z.string(),
  startsOn: LocalDate,
  endsOn: LocalDate,
  phase: tolerantEnum(SEASON_PHASES),
});
export type SeasonCard = z.infer<typeof SeasonCard>;

/** Карточка гонки в списке приложения; без владельца и служебных полей. */
export const RaceCard = z.object({
  id: Uuid,
  title: z.string(),
  bikeClass: tolerantEnum(BIKE_CLASSES),
  surfaces: z.array(tolerantEnum(SURFACES)),
  distanceKm: z.number(),
  windowStartsAt: z.iso.datetime(),
  windowEndsAt: z.iso.datetime(),
  protocolPlannedAt: z.iso.datetime(),
  phase: tolerantEnum(RACE_PHASES),
  cancelReason: tolerantEnum(RACE_CANCEL_REASONS).nullable(),
  season: z.object({ id: Uuid, name: z.string() }).nullable(),
});
export type RaceCard = z.infer<typeof RaceCard>;

/** `GET /v1/races/:id` — опубликованная или отменённая; черновик и неизвестная — 404. */
export const RaceDetail = RaceCard.extend({ description: z.string().nullable() });
export type RaceDetail = z.infer<typeof RaceDetail>;

export const RacePage = z.object({ items: z.array(RaceCard), nextCursor: z.string().nullable() });
export type RacePage = z.infer<typeof RacePage>;

/** `GET /v1/seasons/current` — сезон, в который попадает «сейчас», или `null`. */
export const CurrentSeasonResponse = z.object({ season: SeasonCard.nullable() });
export type CurrentSeasonResponse = z.infer<typeof CurrentSeasonResponse>;
