import { z } from 'zod';

import {
  APP_THEME_IDS,
  AppThemeId,
  DEFAULT_APP_THEME_ID,
} from '../appearance/appearance.schema.ts';
import { fieldError, optionalText, tolerantEnum } from '../common.ts';
import { RIDE_REASONS, type RideReason } from './onboarding.schema.ts';
import { AvatarId, RiderPublicId } from './rider-avatar.schema.ts';

const isRideReason = (code: string): code is RideReason =>
  (RIDE_REASONS as readonly string[]).includes(code);

/**
 * Версия текста согласия на показ имени (profile-02): ключи i18n `profile.show.label` и `profile.show.hint`. Сменили
 * формулировку — подняли версию (дата). Пишет сервер в `profile_consent_events`; клиент присылает только флаг.
 */
export const PUBLIC_NAME_CONSENT_VERSION = '2026-10-31';

/**
 * Версия текста согласия «Показывать мои заезды в таблицах маршрутов» (route-rides-04); ключи i18n — в приложении.
 * Пишет сервер в `profile_consent_events` (`kind: 'route_rides'`); клиент присылает только флаг.
 */
export const ROUTE_RIDES_CONSENT_VERSION = '2026-10-31';

export const RIDER_PUBLIC_NAME_MIN = 2;
export const RIDER_PUBLIC_NAME_MAX = 80;
/** Одна строка без управляющих (`\p{Cc}`) и форматирующих (`\p{Cf}`: RTL-override, нулевая ширина) символов (RC-8). */
const RIDER_NAME_LINE = /^[^\p{Cc}\p{Cf}]+$/u;
/** Подписи таблицы результатов, которые имя не может повторять (RC-8): своя строка, аноним, удалённый; «ё» = «е». */
const RESERVED_RIDER_NAMES = new Set(['вы', 'участник', 'удаленный участник']);
/** Заглушка строки без имени «Райдер #N» (name-consent-prompt, N8): и «Райдер», «Райдер №12», «Райдер 7». */
const RESERVED_RIDER_NUMBER = /^райдер\s*(?:[#№]\s*)?\d*$/u;
const reservedKey = (value: string) => value.trim().toLowerCase().replaceAll('ё', 'е');
/**
 * Строка повторяет служебную подпись таблицы результатов (RC-8, N8). Экспорт — для разовой выборки имён и клубов,
 * сохранённых до запрета (`panel reserved-names`).
 */
export const isReservedRiderLine = (value: string) => {
  const key = reservedKey(value);
  return RESERVED_RIDER_NAMES.has(key) || RESERVED_RIDER_NUMBER.test(key);
};

/**
 * Публичная строка райдера (имя, клуб): необязательно, пусто — `null`; `min`–`max` символов одной строкой без `\p{Cc}`
 * и `\p{Cf}`, не повторяет служебные подписи таблицы результатов.
 */
const riderLine = (min: number, max: number) =>
  optionalText(max, RIDER_NAME_LINE)
    .refine((value) => value === null || value.length >= min, { error: 'TOO_SHORT' })
    .refine((value) => value === null || !isReservedRiderLine(value), {
      error: 'INVALID',
    });

/**
 * «Как вас показывать в результатах» (profile-rider-name, P2): необязательно, пусто — `null`; 2–80 символов одной
 * строкой. Конструктор — как у подписи организатора райда (D2), плюс запрет `\p{Cf}` и служебных подписей таблицы.
 */
export const RiderPublicName = riderLine(RIDER_PUBLIC_NAME_MIN, RIDER_PUBLIC_NAME_MAX);

export const RIDER_CLUB_MIN = 2;
export const RIDER_CLUB_MAX = 60;
/** Клуб райдера (rider-profile): свободный текст одной строкой, 2–60 символов, правила — как у имени. */
export const RiderClub = riderLine(RIDER_CLUB_MIN, RIDER_CLUB_MAX);

/**
 * `GET /v1/profile` и ответ `PATCH /v1/profile` (под `AuthGuard`, `no-store`) — профиль своего пользователя: ответы
 * опроса для порядка разделов Главной, публичное имя и согласие на его показ в таблицах результатов. Неизвестные коды
 * опроса новых версий отбрасываются, а не ломают разбор старыми сборками (R5 блока 02); запрос `PUT …/survey` остаётся
 * строгим. Имя и согласие — с `.default`: ответ старого сервера без них — `null` / `false`. Клуб, аватар и
 * `publicId` (rider-profile) — тоже с `.default(null)`; `publicId` не `null` только при имени и согласии. Личная тема
 * (user-theme): нет поля у старого сервера — «Классика», будущая тема в старой сборке — `'unknown'` (клиент → «Классика»).
 */
export const ProfileView = z.object({
  rideReasons: z.array(z.string()).transform((codes) => codes.filter(isRideReason)),
  publicName: z.string().nullable().default(null),
  showNameInResults: z.boolean().default(false),
  club: z.string().nullable().default(null),
  avatar: z.object({ id: AvatarId }).nullable().default(null),
  publicId: RiderPublicId.nullable().default(null),
  themeId: tolerantEnum(APP_THEME_IDS).default(DEFAULT_APP_THEME_ID),
  /**
   * profile-moderation-followups: загрузка фото запрещена до этого момента (повторные сбросы фото модератором);
   * `null` — запрета нет или он истёк. Во всех ответах `ProfileView` (приложение кладёт их в кэш целиком).
   */
  avatarUploadBlockedUntil: z.iso.datetime().nullable().default(null),
  /** route-rides-04: показ своих заездов в таблицах маршрутов каталога; старый сервер — `false`. */
  showRouteRides: z.boolean().default(false),
});
export type ProfileView = z.output<typeof ProfileView>;

/** `PUT /v1/profile/theme` (user-theme) — личная тема райдера из закрытого списка; лишние ключи — ошибка. */
export const UpdateProfileThemeRequest = z.strictObject({ themeId: AppThemeId });
export type UpdateProfileThemeRequest = z.infer<typeof UpdateProfileThemeRequest>;

/**
 * `PATCH /v1/profile` — частичное обновление: ключа нет — поле не меняется; `publicName: null` или `""` — имя
 * очищено; так же `club` (rider-profile); `showRouteRides` — согласие на показ заездов (route-rides-04). Нужен хотя бы один ключ (`REQUIRED` на корне), лишние ключи — ошибка.
 */
export const UpdateProfileRequest = z
  .strictObject({
    publicName: RiderPublicName.optional(),
    showNameInResults: z.boolean({ error: fieldError('INVALID') }).optional(),
    club: RiderClub.optional(),
    showRouteRides: z.boolean({ error: fieldError('INVALID') }).optional(),
  })
  .refine(
    (body) =>
      body.publicName !== undefined ||
      body.showNameInResults !== undefined ||
      body.club !== undefined ||
      body.showRouteRides !== undefined,
    { error: 'REQUIRED' },
  );
export type UpdateProfileRequest = z.infer<typeof UpdateProfileRequest>;
