import { z } from 'zod';

import { fieldError, optionalText } from '../common.ts';
import { RIDE_REASONS, type RideReason } from './onboarding.schema.ts';

const isRideReason = (code: string): code is RideReason =>
  (RIDE_REASONS as readonly string[]).includes(code);

/**
 * Версия текста согласия на показ имени (profile-02): ключи i18n `profile.show.label` и `profile.show.hint`. Сменили
 * формулировку — подняли версию (дата). Пишет сервер в `profile_consent_events`; клиент присылает только флаг.
 */
export const PUBLIC_NAME_CONSENT_VERSION = '2026-10-27';

export const RIDER_PUBLIC_NAME_MIN = 2;
export const RIDER_PUBLIC_NAME_MAX = 80;
/** Одна строка без управляющих (`\p{Cc}`) и форматирующих (`\p{Cf}`: RTL-override, нулевая ширина) символов (RC-8). */
const RIDER_NAME_LINE = /^[^\p{Cc}\p{Cf}]+$/u;
/** Подписи таблицы результатов, которые имя не может повторять (RC-8): своя строка, аноним, удалённый; «ё» = «е». */
const RESERVED_RIDER_NAMES = new Set(['вы', 'участник', 'удаленный участник']);
const reservedKey = (value: string) => value.toLowerCase().replaceAll('ё', 'е');

/**
 * «Как вас показывать в результатах» (profile-rider-name, P2): необязательно, пусто — `null`; 2–80 символов одной
 * строкой. Конструктор — как у подписи организатора райда (D2), плюс запрет `\p{Cf}` и служебных подписей таблицы.
 */
export const RiderPublicName = optionalText(RIDER_PUBLIC_NAME_MAX, RIDER_NAME_LINE)
  .refine((value) => value === null || value.length >= RIDER_PUBLIC_NAME_MIN, {
    error: 'TOO_SHORT',
  })
  .refine((value) => value === null || !RESERVED_RIDER_NAMES.has(reservedKey(value)), {
    error: 'INVALID',
  });

/**
 * `GET /v1/profile` и ответ `PATCH /v1/profile` (под `AuthGuard`, `no-store`) — профиль своего пользователя: ответы
 * опроса для порядка разделов Главной, публичное имя и согласие на его показ в таблицах результатов. Неизвестные коды
 * опроса новых версий отбрасываются, а не ломают разбор старыми сборками (R5 блока 02); запрос `PUT …/survey` остаётся
 * строгим. Имя и согласие — с `.default`: ответ старого сервера без них — `null` / `false`.
 */
export const ProfileView = z.object({
  rideReasons: z.array(z.string()).transform((codes) => codes.filter(isRideReason)),
  publicName: z.string().nullable().default(null),
  showNameInResults: z.boolean().default(false),
});
export type ProfileView = z.output<typeof ProfileView>;

/**
 * `PATCH /v1/profile` — частичное обновление: ключа нет — поле не меняется; `publicName: null` или `""` — имя
 * очищено. Нужен хотя бы один ключ (`REQUIRED` на корне), лишние ключи — ошибка.
 */
export const UpdateProfileRequest = z
  .strictObject({
    publicName: RiderPublicName.optional(),
    showNameInResults: z.boolean({ error: fieldError('INVALID') }).optional(),
  })
  .refine((body) => body.publicName !== undefined || body.showNameInResults !== undefined, {
    error: 'REQUIRED',
  });
export type UpdateProfileRequest = z.infer<typeof UpdateProfileRequest>;
