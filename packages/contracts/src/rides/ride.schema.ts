import { z } from 'zod';

import {
  fieldError,
  MULTI_LINE,
  optionalText,
  PageQuery,
  SINGLE_LINE,
  tolerantEnum,
  Uuid,
  queryArray,
  Version,
} from '../common.ts';
import { CITY_CODES, CityCode, isCityCode } from '../geo/city.schema.ts';
import { PageCursor } from '../races/race.schema.ts';
import { LocalDate, LocalTime, UtcMinute } from '../time.ts';

/*
 * Кофе-райды (блок 05, ADR-0013 Proposed): райд создаёт райдер в приложении; участие — «Я иду» / «Не иду» с
 * необязательным лимитом мест. Фаза — по `CLOCK` сервера, права зрителя — `viewer` сервера (клиент только показывает).
 */

/** Статусы документа (`hidden` добавит модерация 05b — в конец). */
export const RIDE_STATUSES = ['published', 'cancelled'] as const;
export type RideStatus = (typeof RIDE_STATUSES)[number];

/** Фаза для приложения: `cancelled` (статус) → `past` (с момента старта) → `upcoming`. Только в конец. */
export const RIDE_PHASES = ['upcoming', 'past', 'cancelled'] as const;
export type RidePhase = (typeof RIDE_PHASES)[number];

/** Причины отмены организатором (Q6) — без свободного текста. Только в конец. */
export const RIDE_CANCEL_REASONS = [
  'weather',
  'organizer_unavailable',
  'low_turnout',
  'road_conditions',
  'other',
] as const;
export const RideCancelReason = z.enum(RIDE_CANCEL_REASONS, { error: fieldError('REQUIRED') });
export type RideCancelReason = z.infer<typeof RideCancelReason>;

/** Роль зрителя в райде. Только в конец. */
export const RIDE_VIEWER_ROLES = ['organizer', 'participant', 'none'] as const;
export type RideViewerRole = (typeof RIDE_VIEWER_ROLES)[number];

/** Ограничения полей (Q8 [ASSUMPTION]); подпись организатора — 2–80 (D2, решение оркестратора: «Ян»). */
export const RIDE_TITLE_MIN = 3;
export const RIDE_TITLE_MAX = 80;
export const RIDE_ORGANIZER_NAME_MIN = 2;
export const RIDE_ORGANIZER_NAME_MAX = RIDE_TITLE_MAX;
export const RIDE_PLACE_MIN = 3;
export const RIDE_PLACE_MAX = 120;
export const RIDE_DESCRIPTION_MAX = 1000;
export const RIDE_DISTANCE_KM = { min: 5, max: 300 } as const;
export const RIDE_PACE_KMH = { min: 10, max: 45 } as const;
/** Лимит мест вместе с организатором; без лимита — технический потолок `RIDE_MAX_PARTICIPANTS` (Q16). */
export const RIDE_LIMIT = { min: 2, max: 100 } as const;
export const RIDE_MAX_PARTICIPANTS = 100;
export const RIDE_LIST_MAX_LIMIT = 50;
export const RIDE_CITY_FILTER_MAX = 12;
/** Окно времени старта (правило сервера): не раньше чем через 30 мин и не дальше 60 дней. */
export const RIDE_START_MIN_LEAD_MIN = 30;
export const RIDE_START_MAX_AHEAD_DAYS = 60;

const text = (min: number, max: number) =>
  z
    .string({ error: fieldError('REQUIRED') })
    .trim()
    .min(1, { error: 'REQUIRED', abort: true })
    .min(min, { error: 'TOO_SHORT', abort: true })
    .max(max, { error: 'TOO_LONG' })
    .regex(SINGLE_LINE, { error: 'INVALID' });

const integer = ({ min, max }: { min: number; max: number }) =>
  z
    .number({ error: fieldError('INVALID') })
    .int({ error: 'INVALID' })
    .min(min, { error: 'INVALID' })
    .max(max, { error: 'INVALID' });

export const RideTitle = text(RIDE_TITLE_MIN, RIDE_TITLE_MAX);
export const RidePlace = text(RIDE_PLACE_MIN, RIDE_PLACE_MAX);
/** «Как вас подписать» (D2): необязательно, пусто — `null`; 2–80 символов одной строкой. */
export const RideOrganizerName = optionalText(RIDE_ORGANIZER_NAME_MAX, SINGLE_LINE).refine(
  (value) => value === null || value.length >= RIDE_ORGANIZER_NAME_MIN,
  { error: 'TOO_SHORT' },
);
/** Описание как есть (без разметки), пусто — `null`. */
export const RideDescription = optionalText(RIDE_DESCRIPTION_MAX, MULTI_LINE);
export const RideDistanceKm = integer(RIDE_DISTANCE_KM);
export const RidePaceKmh = integer(RIDE_PACE_KMH);
export const RideLimit = integer(RIDE_LIMIT);

const RIDE_FIELD_SHAPE = {
  title: RideTitle,
  organizerName: RideOrganizerName,
  startsAt: UtcMinute,
  cityCode: CityCode,
  place: RidePlace,
  distanceKm: RideDistanceKm,
  paceMinKmh: RidePaceKmh,
  paceMaxKmh: RidePaceKmh,
  limit: RideLimit.nullable(),
  description: RideDescription,
};

/** Темп «от» не больше «до» — код под полем «до». Частичная правка без обоих значений — проверяет сервер. */
const paceOrder = (
  value: { paceMinKmh?: number; paceMaxKmh?: number },
  ctx: z.core.$RefinementCtx,
) => {
  if (
    value.paceMinKmh !== undefined &&
    value.paceMaxKmh !== undefined &&
    value.paceMinKmh > value.paceMaxKmh
  ) {
    ctx.addIssue({ code: 'custom', path: ['paceMaxKmh'], message: 'RIDE_PACE_ORDER' });
  }
};

/** Поля райда (создание). Окно времени старта, квоты и лимит не ниже идущих — правила сервера. */
export const RideFields = z.strictObject(RIDE_FIELD_SHAPE);
export type RideFields = z.infer<typeof RideFields>;

/** `POST /v1/rides` → 201 `RideView`; организатор — первый участник. */
export const CreateRideRequest = RideFields.superRefine(paceOrder);
export type CreateRideRequest = z.infer<typeof CreateRideRequest>;

/** `POST /v1/rides/:id` — изменённые поля + ожидаемая `version` (устарела — `409 CONFLICT`). */
export const UpdateRideRequest = z
  .strictObject(RIDE_FIELD_SHAPE)
  .partial()
  .extend({ version: Version })
  .superRefine(paceOrder);
export type UpdateRideRequest = z.infer<typeof UpdateRideRequest>;

/** `POST /v1/rides/:id/cancel` — причина обязательна. */
export const CancelRideRequest = z.strictObject({ reason: RideCancelReason });
export type CancelRideRequest = z.infer<typeof CancelRideRequest>;

/**
 * Строка поля формы → число схемы. Пустая — `undefined`: `fieldError` схемы даёт `REQUIRED` (тип — `number`, чтобы
 * выход формы совпадал с запросом; `undefined` до схемы не доходит без ошибки).
 */
const numberText = (schema: z.ZodNumber) =>
  z
    .string()
    .trim()
    .transform((value) => (value === '' ? undefined : Number(value.replace(',', '.'))) as number)
    .pipe(schema);

/**
 * Значения формы «Новый райд» / «Изменить райд»: дата и время Минска вместо `startsAt` (в запрос —
 * `minskWallTimeToUtc`), числа — строки полей ввода, лимит — пусто или число.
 */
export const CreateRideForm = z
  .object({
    title: RideTitle,
    organizerName: RideOrganizerName,
    date: LocalDate,
    time: LocalTime,
    cityCode: CityCode,
    place: RidePlace,
    distanceKm: numberText(RideDistanceKm),
    paceMinKmh: numberText(RidePaceKmh),
    paceMaxKmh: numberText(RidePaceKmh),
    limit: z
      .string()
      .trim()
      .transform((value) => (value === '' ? null : Number(value.replace(',', '.'))))
      .pipe(RideLimit.nullable()),
    description: RideDescription,
  })
  .superRefine(paceOrder);
export type CreateRideFormValues = z.input<typeof CreateRideForm>;
export type CreateRideFormOutput = z.output<typeof CreateRideForm>;

/** `GET /v1/rides?city&cursor&limit` (под `AuthGuard`) → `RidePage`: будущие райды по времени старта. */
export const RideListQuery = z.strictObject({
  ...PageQuery.shape,
  limit: z.coerce.number().int().min(1).max(RIDE_LIST_MAX_LIMIT).default(20),
  cursor: PageCursor.optional(),
  city: queryArray(CityCode, RIDE_CITY_FILTER_MAX).optional(),
});
export type RideListQuery = z.infer<typeof RideListQuery>;

/** Права зрителя считает сервер; клиент только показывает. */
export const RideViewer = z.object({
  role: tolerantEnum(RIDE_VIEWER_ROLES),
  canJoin: z.boolean(),
  canLeave: z.boolean(),
  canManage: z.boolean(),
});
export type RideViewer = z.infer<typeof RideViewer>;

/** Общие поля ответа: без организатора (кроме введённой им подписи), участников, `version`, `createdAt`. */
const RideSummary = z.object({
  id: Uuid,
  title: z.string(),
  organizerName: z.string().nullable(),
  startsAt: z.iso.datetime(),
  city: tolerantEnum(CITY_CODES),
  place: z.string(),
  distanceKm: z.number(),
  paceMinKmh: z.number(),
  paceMaxKmh: z.number(),
  limit: z.number().nullable(),
  goingCount: z.number(),
  full: z.boolean(),
  phase: tolerantEnum(RIDE_PHASES),
  cancelReason: tolerantEnum(RIDE_CANCEL_REASONS).nullable(),
  rescheduledAt: z.iso.datetime().nullable(),
});

/** Райд в ленте — с ролью зрителя. */
export const RideCard = RideSummary.extend({ viewer: RideViewer });
export type RideCard = z.infer<typeof RideCard>;

/** `GET /v1/rides/:id` (публично) — опубликованный, отменённый и прошедший райд; неизвестный — 404. */
export const RideDetail = RideSummary.extend({ description: z.string().nullable() });
export type RideDetail = z.infer<typeof RideDetail>;

/** Карточка для организатора — с `version` для формы правки. */
export const RideDetailForOrganizer = RideDetail.extend({ version: Version });
export type RideDetailForOrganizer = z.infer<typeof RideDetailForOrganizer>;

/** `GET /v1/rides/:id/me` и ответы мутаций: райд + состояние зрителя. */
export const RideView = z.object({
  ride: z.union([RideDetailForOrganizer, RideDetail]),
  viewer: RideViewer,
});
export type RideView = z.infer<typeof RideView>;

export const RidePage = z.object({
  items: z.array(RideCard),
  nextCursor: z.string().nullable(),
});
export type RidePage = z.infer<typeof RidePage>;

/** `GET /v1/rides/cities` — города с видимыми зрителю будущими райдами; незнакомые коды отбрасываются. */
export const RideCities = z.object({
  cities: z.array(z.string()).transform((codes) => codes.filter(isCityCode)),
});
export type RideCities = z.output<typeof RideCities>;

/** `details` для `409 RIDE_QUOTA_EXCEEDED`: какая квота и её размер. */
export const RIDE_QUOTA_KINDS = ['organized', 'joined'] as const;
export const RideQuotaDetails = z.object({
  quota: tolerantEnum(RIDE_QUOTA_KINDS),
  limit: z.number().int().nonnegative(),
});
export type RideQuotaDetails = z.infer<typeof RideQuotaDetails>;
