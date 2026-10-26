import { z } from 'zod';

import { fieldError, MULTI_LINE, PageQuery, SINGLE_LINE, Uuid, Version } from '../common.ts';
import { UtcMinute } from '../time.ts';

/*
 * Гонка по GPS-коридору (ADR-0010): окно дат, плановая дата протокола, сезон по концу окна. Справочники только
 * дополняются в конец — приложение разбирает их `tolerantEnum` (R6), панель — строго (SPA деплоится с API).
 */

export const BIKE_CLASSES = ['road', 'tt', 'gravel', 'mtb'] as const;
export const BikeClass = z.enum(BIKE_CLASSES, { error: fieldError('INVALID') });
export type BikeClass = z.infer<typeof BikeClass>;

/** Покрытие — мультивыбор (Q10): «Смешанное» = оба значения. */
export const SURFACES = ['asphalt', 'gravel'] as const;
export const Surface = z.enum(SURFACES, { error: fieldError('INVALID') });
export type Surface = z.infer<typeof Surface>;

/** Хранимый статус. Фаза (`RacePhase`) — вычисляет сервер по окну и `CLOCK`. */
export const RACE_STATUSES = ['draft', 'published', 'cancelled'] as const;
export const RaceStatus = z.enum(RACE_STATUSES);
export type RaceStatus = z.infer<typeof RaceStatus>;

/** Фаза гонки (R5); фазы результатов (`provisional`, `final`) добавит admin-04 в конец. */
export const RACE_PHASES = ['draft', 'upcoming', 'open', 'closed', 'cancelled'] as const;
export const RacePhase = z.enum(RACE_PHASES);
export type RacePhase = z.infer<typeof RacePhase>;

/** Шаблонные причины отмены (D-20, без свободного текста). */
export const RACE_CANCEL_REASONS = [
  'weather',
  'route_unavailable',
  'platform_issue',
  'season_change',
  'organizational',
] as const;
export const RaceCancelReason = z.enum(RACE_CANCEL_REASONS, { error: fieldError('REQUIRED') });
export type RaceCancelReason = z.infer<typeof RaceCancelReason>;

/** Поля формы гонки — `editable.fields` и `details.changedFields` журнала. */
export const RACE_FIELDS = [
  'title',
  'bikeClass',
  'surfaces',
  'distanceKm',
  'description',
  'windowStartsAt',
  'windowEndsAt',
  'protocolPlannedAt',
  // race-results-01: эталонный коридор (маршрут + допуск)
  'corridor',
] as const;
export const RaceField = z.enum(RACE_FIELDS);
export type RaceField = z.infer<typeof RaceField>;

/** Почему действие или поле недоступно (`editable.reasons`); блокировки D-19 добавят слайсы результатов в конец. */
export const RACE_EDIT_BLOCK_REASONS = [
  'window_open',
  'window_closed',
  'cancelled',
  'outside_season',
] as const;
export const RaceEditBlockReason = z.enum(RACE_EDIT_BLOCK_REASONS);
export type RaceEditBlockReason = z.infer<typeof RaceEditBlockReason>;

/** Правило сервера «протокол — не раньше конца окна + 48 ч» — для подсказки UI (источник истины — сервер). */
export const RACE_PROTOCOL_MIN_DELAY_HOURS = 48;
export const RACE_TITLE_MIN_LENGTH = 3;
export const RACE_TITLE_MAX_LENGTH = 120;
export const RACE_DESCRIPTION_MAX_LENGTH = 2000;
export const RACE_DISTANCE_MIN_KM = 1;
export const RACE_DISTANCE_MAX_KM = 1000;

/** Название гонки (и старта календаря): 3–120 символов, без управляющих. */
export const RaceTitle = z
  .string({ error: fieldError('REQUIRED') })
  .trim()
  .min(1, { error: 'REQUIRED', abort: true })
  .min(RACE_TITLE_MIN_LENGTH, { error: 'TOO_SHORT', abort: true })
  .max(RACE_TITLE_MAX_LENGTH, { error: 'TOO_LONG' })
  .regex(SINGLE_LINE, { error: 'INVALID' });

/** Дистанция, км: 1–1000, шаг 0,1. */
export const DistanceKm = z
  .number({ error: fieldError('REQUIRED') })
  .min(RACE_DISTANCE_MIN_KM, { error: 'INVALID' })
  .max(RACE_DISTANCE_MAX_KM, { error: 'INVALID' })
  .multipleOf(0.1, { error: 'INVALID' });

/** Допуск коридора «±N м от маршрута» (эпик A2): 20–200 м шагом 5, по умолчанию 50. */
export const CORRIDOR_WIDTH_MIN_M = 20;
export const CORRIDOR_WIDTH_MAX_M = 200;
export const CORRIDOR_WIDTH_STEP_M = 5;
export const CORRIDOR_WIDTH_DEFAULT_M = 50;

/**
 * Эталонный коридор гонки: готовый маршрут (`routeId`) и допуск. Длину (дистанцию гонки) считает сервер из маршрута;
 * готовность маршрута — правило сервера (`ROUTE_NOT_READY` на `corridor.routeId`).
 */
export const CorridorInput = z.strictObject({
  routeId: Uuid,
  widthM: z
    .number({ error: fieldError('REQUIRED') })
    .int({ error: 'INVALID' })
    .min(CORRIDOR_WIDTH_MIN_M, { error: 'INVALID' })
    .max(CORRIDOR_WIDTH_MAX_M, { error: 'INVALID' })
    .multipleOf(CORRIDOR_WIDTH_STEP_M, { error: 'INVALID' }),
});
export type CorridorInput = z.infer<typeof CorridorInput>;

/** Описание: пустое после обрезки — `null` (поле очищено). */
export const RaceDescription = z
  .string({ error: fieldError('INVALID') })
  .trim()
  .max(RACE_DESCRIPTION_MAX_LENGTH, { error: 'TOO_LONG' })
  .regex(MULTI_LINE, { error: 'INVALID' })
  .transform((value) => (value === '' ? null : value))
  .nullable();

/**
 * `POST /v1/admin/races` (`races.manage`) → 201 `PanelRace` (черновик). Моменты — UTC с точностью до минуты (панель
 * переводит настенное время Минска `minskWallTimeToUtc`). Порядок окна, 48 ч, длина окна — правила сервера.
 * Владелец, статус, сезон — только сервер. `corridor: null` — без коридора (анонс). `distanceKm` обязательна только без
 * коридора (правило сервера, `REQUIRED`); с коридором дистанцию вычисляет сервер из длины маршрута.
 */
export const RaceInput = z.strictObject({
  title: RaceTitle,
  bikeClass: BikeClass,
  surfaces: z
    .array(Surface, { error: fieldError('REQUIRED') })
    .min(1, { error: 'REQUIRED' })
    .max(SURFACES.length, { error: 'INVALID' })
    .refine((list) => new Set(list).size === list.length, { error: 'INVALID' }),
  distanceKm: DistanceKm.optional(),
  description: RaceDescription,
  windowStartsAt: UtcMinute,
  windowEndsAt: UtcMinute,
  protocolPlannedAt: UtcMinute,
  corridor: CorridorInput.nullable().optional(),
});
export type RaceInput = z.infer<typeof RaceInput>;

/** `POST /v1/admin/races/:id` — изменённые поля + ожидаемая `version`. */
export const UpdateRaceRequest = RaceInput.partial().extend({ version: Version });
export type UpdateRaceRequest = z.infer<typeof UpdateRaceRequest>;

/** `POST /v1/admin/races/:id/publish` → `PanelRace`; повтор — 409 `RACE_INVALID_STATE`. */
export const PublishRaceRequest = z.strictObject({ version: Version });
export type PublishRaceRequest = z.infer<typeof PublishRaceRequest>;

/** `POST /v1/admin/races/:id/discard` → 204: удаляется только черновик. */
export const DiscardRaceRequest = PublishRaceRequest;
export type DiscardRaceRequest = z.infer<typeof DiscardRaceRequest>;

/** `POST /v1/admin/races/:id/cancel` → `PanelRace`: только шаблонная причина, необратимо. */
export const CancelRaceRequest = z.strictObject({ version: Version, reason: RaceCancelReason });
export type CancelRaceRequest = z.infer<typeof CancelRaceRequest>;

/** Что можно менять сейчас (R10) — считает сервер; UI только отображает. */
export const RaceEditable = z.object({
  fields: z.array(RaceField),
  canPublish: z.boolean(),
  canCancel: z.boolean(),
  canDiscard: z.boolean(),
  reasons: z.array(RaceEditBlockReason),
});
export type RaceEditable = z.infer<typeof RaceEditable>;

/** Гонка в панели. `season.preview` — черновик: сезон по текущим датам, ещё не закреплён (R9). */
export const PanelRace = z.object({
  id: Uuid,
  status: RaceStatus,
  phase: RacePhase,
  title: z.string(),
  bikeClass: BikeClass,
  surfaces: z.array(Surface),
  distanceKm: z.number(),
  description: z.string().nullable(),
  windowStartsAt: z.iso.datetime(),
  windowEndsAt: z.iso.datetime(),
  protocolPlannedAt: z.iso.datetime(),
  season: z.object({ id: Uuid, name: z.string(), preview: z.boolean() }).nullable(),
  owner: z.object({ userId: Uuid, displayName: z.string() }),
  cancelReason: RaceCancelReason.nullable(),
  /** Коридор: маршрут (название — для показа), допуск, длина маршрута, м (снимок; дистанция гонки — из неё). */
  corridor: z
    .object({
      route: z.object({ id: Uuid, title: z.string() }),
      widthM: z.number().int(),
      distanceM: z.number().int(),
    })
    .nullable(),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
  publishedAt: z.iso.datetime().nullable(),
  cancelledAt: z.iso.datetime().nullable(),
  version: Version,
  editable: RaceEditable,
});
export type PanelRace = z.infer<typeof PanelRace>;

/** Непрозрачный курсор страницы (base64url); мусор — 400. */
export const PageCursor = z.string().max(200, { error: 'INVALID' });

/**
 * `GET /v1/admin/races` (`races.read`): новые окна сверху, курсор. Организатор без `races.manage_any` всегда видит
 * только свои — фильтр ставит сервер; `mine=true` — свои для всех ролей.
 */
export const PanelRaceQuery = z.strictObject({
  ...PageQuery.shape,
  cursor: PageCursor.optional(),
  status: RaceStatus.optional(),
  seasonId: Uuid.optional(),
  bikeClass: BikeClass.optional(),
  mine: z.stringbool().optional(),
});
export type PanelRaceQuery = z.infer<typeof PanelRaceQuery>;

export const PanelRacePage = z.object({
  items: z.array(PanelRace),
  nextCursor: z.string().nullable(),
});
export type PanelRacePage = z.infer<typeof PanelRacePage>;
