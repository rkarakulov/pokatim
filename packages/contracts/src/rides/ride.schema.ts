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
import { OpaqueToken } from '../auth/verification.schema.ts';
import { CITY_CODES, CityCode, isCityCode } from '../geo/city.schema.ts';
import { LonLat } from '../races/race-route.schema.ts';
import { PageCursor } from '../races/race.schema.ts';
import { LocalDate, LocalTime, UtcMinute } from '../time.ts';

/*
 * Кофе-райды (блок 05, ADR-0013 Proposed): райд создаёт райдер в приложении; участие — «Я иду» / «Не иду» с
 * необязательным лимитом мест. Фаза — по `CLOCK` сервера, права зрителя — `viewer` сервера (клиент только показывает).
 */

/** Статусы документа; `hidden` — скрыт модератором (05b). Только в конец. */
export const RIDE_STATUSES = ['published', 'cancelled', 'hidden'] as const;
export type RideStatus = (typeof RIDE_STATUSES)[number];

/**
 * Фаза для приложения: `hidden` (статус, видит только организатор) → `cancelled` (статус) → `past` (с момента
 * старта) → `upcoming`. Только в конец.
 */
export const RIDE_PHASES = ['upcoming', 'past', 'cancelled', 'hidden'] as const;
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
/** «Рядом» (05c): радиус, км; без `radiusKm` — 25 (сервер). */
export const RIDE_NEAR_RADIUS_KM = { min: 5, max: 100, default: 25 } as const;
/** Точек на карте ленты (05c), не больше. */
export const RIDE_MAP_MAX_POINTS = 200;
/** Доступ к маршруту райда (05c): `private` — свой непубличный маршрут, видит только организатор. Только в конец. */
export const RIDE_ROUTE_ACCESS = ['public', 'private'] as const;
export type RideRouteAccess = (typeof RIDE_ROUTE_ACCESS)[number];
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

/** Маршрут в запросе (05c): uuid или `null` — без маршрута (снять). */
export const RideRouteId = Uuid.nullable();

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

/**
 * Поля райда (создание). Окно времени старта, квоты, лимит не ниже идущих и доступность маршрута — правила сервера.
 * `routeId` старые сборки не шлют — `null`.
 */
export const RideFields = z.strictObject({
  ...RIDE_FIELD_SHAPE,
  routeId: RideRouteId.default(null),
});
export type RideFields = z.infer<typeof RideFields>;

/** `POST /v1/rides` → 201 `RideView`; организатор — первый участник. */
export const CreateRideRequest = RideFields.superRefine(paceOrder);
export type CreateRideRequest = z.infer<typeof CreateRideRequest>;

/**
 * `POST /v1/rides/:id` — изменённые поля + ожидаемая `version` (устарела — `409 CONFLICT`). Не из `RideFields`:
 * `.partial()` над `routeId` с `.default(null)` подставил бы `null` и снял маршрут у каждой правки старой сборки —
 * поэтому `routeId` только необязателен: нет — не трогать, `null` — снять.
 */
export const UpdateRideRequest = z
  .strictObject(RIDE_FIELD_SHAPE)
  .partial()
  .extend({ version: Version, routeId: RideRouteId.optional() })
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
    /** выбор пикера «Маршрут», не строка ввода; без маршрута — `null` */
    routeId: RideRouteId,
  })
  .superRefine(paceOrder);
export type CreateRideFormValues = z.input<typeof CreateRideForm>;
export type CreateRideFormOutput = z.output<typeof CreateRideForm>;

const round2 = (value: number) => Math.round(value * 100) / 100;

/**
 * `near=<lat>,<lon>` (05c) → `[lon, lat]`, округление до 0,01° (~1 км) и на сервере — защита в глубину к округлению
 * клиента (ADR-0014): точнее координаты пользователя сервер не видит.
 */
const NearPoint = z
  .string()
  .regex(/^-?\d{1,2}(\.\d{1,6})?,-?\d{1,3}(\.\d{1,6})?$/, { error: 'INVALID', abort: true })
  .transform((value) => {
    const [lat, lon] = value.split(',').map(Number) as [number, number];
    return [round2(lon), round2(lat)];
  })
  // диапазоны — кодом под самим полем `near` (не `near.1` кортежа)
  .refine((point) => LonLat.safeParse(point).success, { error: 'INVALID', abort: true })
  .pipe(LonLat);

const RadiusKm = z.coerce
  .number({ error: 'INVALID' })
  .int({ error: 'INVALID' })
  .min(RIDE_NEAR_RADIUS_KM.min, { error: 'INVALID' })
  .max(RIDE_NEAR_RADIUS_KM.max, { error: 'INVALID' });

const nearShape = { near: NearPoint.optional(), radiusKm: RadiusKm.optional() };

/** `radiusKm` без `near` — `INVALID` на `radiusKm`; `near` без `radiusKm` — 25 км (сервер). */
const nearPair = (value: { near?: unknown; radiusKm?: unknown }, ctx: z.core.$RefinementCtx) => {
  if (value.radiusKm !== undefined && value.near === undefined) {
    ctx.addIssue({ code: 'custom', path: ['radiusKm'], message: 'INVALID' });
  }
};

/**
 * `GET /v1/rides?city&cursor&limit&near&radiusKm` (под `AuthGuard`) → `RidePage`: будущие райды по времени старта;
 * `near` (05c) — только райды, чья точка «Рядом» в радиусе (порядок и курсор те же).
 */
export const RideListQuery = z
  .strictObject({
    ...PageQuery.shape,
    limit: z.coerce.number().int().min(1).max(RIDE_LIST_MAX_LIMIT).default(20),
    cursor: PageCursor.optional(),
    city: queryArray(CityCode, RIDE_CITY_FILTER_MAX).optional(),
    ...nearShape,
  })
  .superRefine(nearPair);
export type RideListQuery = z.infer<typeof RideListQuery>;

/**
 * Права зрителя считает сервер; клиент только показывает. `reported` — зритель уже пожаловался, `canReport` — кнопка
 * «Пожаловаться» (05b); старый ответ без них — `false`.
 */
export const RideViewer = z.object({
  role: tolerantEnum(RIDE_VIEWER_ROLES),
  canJoin: z.boolean(),
  canLeave: z.boolean(),
  canManage: z.boolean(),
  reported: z.boolean().default(false),
  canReport: z.boolean().default(false),
});
export type RideViewer = z.infer<typeof RideViewer>;

/**
 * `GET /v1/rides/map?city&near&radiusKm` (05c, под `AuthGuard`) → `RideMap`: точки старта будущих опубликованных
 * райдов с видимым зрителю маршрутом.
 */
export const RideMapQuery = z
  .strictObject({ city: queryArray(CityCode, RIDE_CITY_FILTER_MAX).optional(), ...nearShape })
  .superRefine(nearPair);
export type RideMapQuery = z.infer<typeof RideMapQuery>;

/**
 * Маршрут райда (05c) — только видимый зрителю сейчас (каталог — `public`; свой непубличный — `private`, только
 * организатору). Без линии, владельца и публикации: карту и профиль клиент берёт эндпоинтами маршрутов.
 */
export const RideRoute = z.object({
  id: Uuid,
  title: z.string(),
  distanceM: z.number().int(),
  elevationGainM: z.number().int().nullable(),
  access: tolerantEnum(RIDE_ROUTE_ACCESS),
});
export type RideRoute = z.infer<typeof RideRoute>;

/** Предел тела `PUT /v1/rides/:id/photo` (ride-photo, ADR-0028): 10 МиБ, больше — `413 IMAGE_TOO_LARGE`. */
export const RIDE_PHOTO_MAX_BYTES = 10 * 1024 * 1024;
/** Длинная сторона сохранённого фото райда: сервер вписывает в 1600 px (`fit: inside`, без увеличения). */
export const RIDE_PHOTO_MAX_EDGE_PX = 1600;
/** Короткая сторона фото **после вписывания** — не меньше 400 px; иначе `422 IMAGE_INVALID { reason: too_small }`. */
export const RIDE_PHOTO_MIN_SHORT_PX = 400;

/** Id фото райда (`GET /v1/ride-photos/:id`): случайный токен; новый при каждой замене. */
export const RidePhotoId = OpaqueToken;
export type RidePhotoId = z.infer<typeof RidePhotoId>;

/** Ссылка на фото организатора райда — только id (без размеров, автора и времени). */
export const RidePhotoRef = z.object({ id: RidePhotoId });
export type RidePhotoRef = z.infer<typeof RidePhotoRef>;

/** Причины `422 IMAGE_INVALID` (ride-photo): мелкое после вписывания; не декодируется или больше предела пикселей. */
export const IMAGE_INVALID_REASONS = ['too_small', 'unreadable'] as const;
export const ImageInvalidDetails = z.object({ reason: tolerantEnum(IMAGE_INVALID_REASONS) });
export type ImageInvalidDetails = z.infer<typeof ImageInvalidDetails>;

/**
 * Общие поля ответа: без организатора (кроме введённой им подписи), участников, `version`, `createdAt`. `route` и
 * `start` (старт видимого маршрута, `[lon, lat]`) — 05c; старый API без них — `null`.
 */
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
  route: RideRoute.nullable().default(null),
  start: LonLat.nullable().default(null),
  /** фото организатора (ride-photo); скрытый райд и старый сервер — `null` */
  photo: RidePhotoRef.nullable().default(null),
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

/** Точка райда на карте ленты (05c): старт видимого зрителю маршрута. */
export const RideMapPoint = z.object({
  id: Uuid,
  title: z.string(),
  startsAt: z.iso.datetime(),
  start: LonLat,
  goingCount: z.number(),
  limit: z.number().nullable(),
  full: z.boolean(),
});
export type RideMapPoint = z.infer<typeof RideMapPoint>;

export const RideMap = z.object({
  items: z.array(RideMapPoint).max(RIDE_MAP_MAX_POINTS),
  /** будущие опубликованные в том же фильтре без точки на карте (в `items` их нет) */
  withoutStart: z.number().int().nonnegative().default(0),
});
export type RideMap = z.infer<typeof RideMap>;

/** `details` для `409 RIDE_QUOTA_EXCEEDED`: какая квота и её размер. */
export const RIDE_QUOTA_KINDS = ['organized', 'joined'] as const;
export const RideQuotaDetails = z.object({
  quota: tolerantEnum(RIDE_QUOTA_KINDS),
  limit: z.number().int().nonnegative(),
});
export type RideQuotaDetails = z.infer<typeof RideQuotaDetails>;
