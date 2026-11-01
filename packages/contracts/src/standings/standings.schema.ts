import { z } from 'zod';

import { tolerantEnum, Uuid } from '../common.ts';
import { RiderRowLink } from '../profile/rider-avatar.schema.ts';
import { BIKE_CLASSES, BikeClass, PageCursor } from '../races/race.schema.ts';
import { RESULT_GROUP_KEYS } from '../results/results.schema.ts';

/*
 * Рейтинг сезона (race-results-08): таблицы «класс × группа» по опубликованным протоколам. Очки, N из M, места и
 * ничьи считает только сервер (`standings.policy.ts`); клиент шлёт выбор таблицы и курсор. Ответы приложения —
 * `tolerantEnum` (R6), панели — строгие (SPA деплоится с API). Справочники — только в конец.
 */

export const STANDINGS_PAGE_SIZE = 50;
export const STANDINGS_PAGE_MAX = 100;
/** Итог райдера в гонке таблицы: место / DQ (0, не выбрасывается) / нет строки (0, выбрасывается). */
export const STANDING_OUTCOMES = ['placed', 'dq', 'none'] as const;
export type StandingOutcome = (typeof STANDING_OUTCOMES)[number];
/** Свежесть снимка для панели (RC-14): `pending` — есть протоколы, а снимка нет или его отпечаток другой. */
export const STANDINGS_SYNC_STATES = ['current', 'pending'] as const;
export type StandingsSyncState = (typeof STANDINGS_SYNC_STATES)[number];

export const SeasonStandingsTableRef = z.object({
  bikeClass: tolerantEnum(BIKE_CLASSES),
  groupKey: tolerantEnum(RESULT_GROUP_KEYS),
  riders: z.number().int(),
  /** M — гонки таблицы с опубликованным протоколом */
  racesTotal: z.number().int(),
  /** N = M − ⌊M/3⌋ */
  racesCounted: z.number().int(),
});
export type SeasonStandingsTableRef = z.infer<typeof SeasonStandingsTableRef>;

/** `GET /v1/seasons/:id/standings`; таблицы — порядок `BIKE_CLASSES`, затем `RESULT_GROUP_KEYS`. */
export const SeasonStandingsSummary = z.object({
  seasonId: Uuid,
  /** время последнего пересчёта; снимка ещё нет — `null` */
  computedAt: z.iso.datetime().nullable(),
  tables: z.array(SeasonStandingsTableRef),
});
export type SeasonStandingsSummary = z.infer<typeof SeasonStandingsSummary>;

/** `GET /v1/seasons/:id/standings/table` и панель: выбор таблицы и страница. Лишние ключи — 400. */
/**
 * Строгий query таблицы. `_` — метка обхода HTTP-кэша: `whatwg-fetch` (React Native) при `cache: 'no-cache'` дописывает
 * `_=<время>` в URL; сервер её принимает и отбрасывает (перезапрос после расхождения снимков, 08c RC-11).
 */
export const SeasonStandingsTableQuery = z
  .strictObject({
    bikeClass: BikeClass,
    group: z.enum(RESULT_GROUP_KEYS),
    limit: z.coerce.number().int().min(1).max(STANDINGS_PAGE_MAX).default(STANDINGS_PAGE_SIZE),
    cursor: PageCursor.optional(),
    _: z
      .string()
      .regex(/^\d{1,20}$/)
      .optional(),
  })
  .transform((query) => {
    const { bikeClass, group, limit, cursor } = query;
    return cursor === undefined ? { bikeClass, group, limit } : { bikeClass, group, limit, cursor };
  });
export type SeasonStandingsTableQuery = z.infer<typeof SeasonStandingsTableQuery>;

export const SeasonStandingsRace = z.object({
  id: Uuid,
  title: z.string(),
  windowEndsAt: z.iso.datetime(),
});
export type SeasonStandingsRace = z.infer<typeof SeasonStandingsRace>;

/** Ячейка гонки строки: место «=N» (`tied`), DQ или нет строки; `counted` — в зачёте N лучших. */
export const SeasonStandingCell = z.object({
  raceId: Uuid,
  place: z.number().int().nullable(),
  tied: z.boolean(),
  outcome: tolerantEnum(STANDING_OUTCOMES),
  points: z.number().int(),
  counted: z.boolean(),
});
export type SeasonStandingCell = z.infer<typeof SeasonStandingCell>;

/** Строка таблицы сезона без `userId`; имя — только с согласием райдера (P1), иначе `null` («Участник»). */
export const SeasonStandingRow = z.object({
  /** позиция в таблице (0…) — своя строка «Вы» по `order` из `/me` (RC-11) */
  order: z.number().int(),
  place: z.number().int(),
  tied: z.boolean(),
  riderName: z.string().nullable(),
  /** ссылка на профиль и фото — по правилам имени (P1) */
  ...RiderRowLink,
  points: z.number().int(),
  /** по порядку `races` */
  cells: z.array(SeasonStandingCell),
});
export type SeasonStandingRow = z.infer<typeof SeasonStandingRow>;

/** `GET /v1/seasons/:id/standings/table`; таблицы нет в снимке — пустая страница (RC-12). */
export const SeasonStandingsTable = z.object({
  bikeClass: tolerantEnum(BIKE_CLASSES),
  groupKey: tolerantEnum(RESULT_GROUP_KEYS),
  computedAt: z.iso.datetime().nullable(),
  racesTotal: z.number().int(),
  racesCounted: z.number().int(),
  riders: z.number().int(),
  /** гонки таблицы по `(windowEndsAt, id)` */
  races: z.array(SeasonStandingsRace),
  items: z.array(SeasonStandingRow),
  nextCursor: z.string().nullable(),
});
export type SeasonStandingsTable = z.infer<typeof SeasonStandingsTable>;

/** Своя строка в одной таблице сезона. */
export const MySeasonStanding = z.object({
  bikeClass: tolerantEnum(BIKE_CLASSES),
  groupKey: tolerantEnum(RESULT_GROUP_KEYS),
  order: z.number().int(),
  place: z.number().int(),
  tied: z.boolean(),
  points: z.number().int(),
  riders: z.number().int(),
  racesTotal: z.number().int(),
  racesCounted: z.number().int(),
  /** гонки этой таблицы по порядку ячеек */
  raceIds: z.array(Uuid),
  cells: z.array(SeasonStandingCell),
});
export type MySeasonStanding = z.infer<typeof MySeasonStanding>;

/** `GET /v1/seasons/:id/standings/me` (`no-store`); `races` — все гонки, встречающиеся в `items`. */
export const MySeasonStandings = z.object({
  seasonId: Uuid,
  computedAt: z.iso.datetime().nullable(),
  races: z.array(SeasonStandingsRace),
  items: z.array(MySeasonStanding),
});
export type MySeasonStandings = z.infer<typeof MySeasonStandings>;

/*
 * Панель — строгие справочники (`pokatim-contracts.md`: SPA деплоится с API, неизвестное значение — ошибка, не
 * `unknown`); публичные схемы выше — tolerant.
 */
const PanelTableKey = { bikeClass: z.enum(BIKE_CLASSES), groupKey: z.enum(RESULT_GROUP_KEYS) };

export const PanelSeasonStandingsTableRef = SeasonStandingsTableRef.extend(PanelTableKey);
export type PanelSeasonStandingsTableRef = z.infer<typeof PanelSeasonStandingsTableRef>;

/** Панель: сводка с версией формулы и свежестью снимка. */
export const PanelSeasonStandingsSummary = SeasonStandingsSummary.extend({
  tables: z.array(PanelSeasonStandingsTableRef),
  formulaVersion: z.number().int().nullable(),
  sync: z.enum(STANDINGS_SYNC_STATES),
});
export type PanelSeasonStandingsSummary = z.infer<typeof PanelSeasonStandingsSummary>;

export const PanelSeasonStandingCell = SeasonStandingCell.extend({
  outcome: z.enum(STANDING_OUTCOMES),
});
export type PanelSeasonStandingCell = z.infer<typeof PanelSeasonStandingCell>;

/** Строка панели: `userId` — только сотруднику, видящему все гонки (RC-8), организатору — `null`. */
export const PanelSeasonStandingRow = SeasonStandingRow.extend({
  userId: Uuid.nullable(),
  cells: z.array(PanelSeasonStandingCell),
});
export type PanelSeasonStandingRow = z.infer<typeof PanelSeasonStandingRow>;

export const PanelSeasonStandingsTable = SeasonStandingsTable.extend({
  ...PanelTableKey,
  items: z.array(PanelSeasonStandingRow),
});
export type PanelSeasonStandingsTable = z.infer<typeof PanelSeasonStandingsTable>;
