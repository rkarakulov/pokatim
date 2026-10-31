import { z } from 'zod';

import { OpaqueToken } from '../auth/verification.schema.ts';
import { fieldError } from '../common.ts';

/** Предел тела `PUT /v1/profile/avatar` (rider-profile): 10 МиБ, больше — `413 AVATAR_TOO_LARGE`. */
export const AVATAR_MAX_BYTES = 10 * 1024 * 1024;
/** Сторона сохранённого аватара: квадрат 512×512 JPEG без метаданных. */
export const AVATAR_SIZE_PX = 512;
/**
 * Предел пикселей входа JPEG и WebP (по заголовку); больше — `422 AVATAR_INVALID`. 100 Мп: сервер декодирует их с
 * уменьшением при загрузке (shrink-on-load, ADR-0019) — кадры 48–50 Мп телефонов и квадрат системной обрезки (~37 Мп)
 * клиент шлёт как есть, без уменьшения.
 */
export const AVATAR_MAX_INPUT_PIXELS = 100_000_000;
/** Предел пикселей PNG: у PNG нет shrink-on-load — память декода растёт с размером (ADR-0019). */
export const AVATAR_MAX_PNG_PIXELS = 25_000_000;
/** Минимальная сторона обрезки в пикселях исходника; меньше — `422 AVATAR_INVALID`. */
export const AVATAR_MIN_CROP_PX = 64;

/** Id аватара (`GET /v1/avatars/:id`): случайный токен, не `userId`; новый при каждой замене фото. */
export const AvatarId = OpaqueToken;
export type AvatarId = z.infer<typeof AvatarId>;
/** Id публичного профиля райдера (`GET /v1/riders/:publicId`): случайный токен, не `userId`; не меняется. */
export const RiderPublicId = OpaqueToken;
export type RiderPublicId = z.infer<typeof RiderPublicId>;

/**
 * Поля строки публичной таблицы (rider-links-in-tables): ссылка на профиль `/riders/<publicId>` и фото — только при
 * имени и согласии на показ (P1, R3), иначе `null` (вместе с `riderName`). Старый сервер полей не знает — `null`.
 */
export const RiderRowLink = {
  riderPublicId: RiderPublicId.nullable().default(null),
  riderAvatar: z.object({ id: AvatarId }).nullable().default(null),
};

const fraction = z.coerce
  .number({ error: fieldError('INVALID') })
  .min(0, { error: 'INVALID' })
  .max(1, { error: 'INVALID' });

/**
 * Query `PUT /v1/profile/avatar` — намерение обрезки: квадрат в ориентированном (по EXIF) изображении, доли его
 * ширины (`x`), высоты (`y`) и меньшей стороны (`size`). Все три или ни одного (без query — центральный квадрат);
 * рамки изображения и минимальную сторону проверяет сервер.
 */
export const AvatarCropQuery = z.union([
  z.strictObject({}),
  z.strictObject({
    x: fraction,
    y: fraction,
    size: fraction.refine((value) => value > 0, { error: 'INVALID' }),
  }),
]);
export type AvatarCropQuery = z.infer<typeof AvatarCropQuery>;
