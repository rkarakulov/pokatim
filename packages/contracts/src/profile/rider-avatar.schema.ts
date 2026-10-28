import { z } from 'zod';

import { fieldError } from '../common.ts';

/** Предел тела `PUT /v1/profile/avatar` (rider-profile): 10 МиБ, больше — `413 AVATAR_TOO_LARGE`. */
export const AVATAR_MAX_BYTES = 10 * 1024 * 1024;
/** Сторона сохранённого аватара: квадрат 512×512 JPEG без метаданных. */
export const AVATAR_SIZE_PX = 512;
/** Предел пикселей входа (после декодирования заголовка); больше — `422 AVATAR_INVALID`. */
export const AVATAR_MAX_INPUT_PIXELS = 40_000_000;
/** Минимальная сторона обрезки в пикселях исходника; меньше — `422 AVATAR_INVALID`. */
export const AVATAR_MIN_CROP_PX = 64;

/** Непрозрачный случайный токен: 32 байта base64url без дополнения (43 символа). */
const OpaqueToken = z
  .string({ error: fieldError('INVALID') })
  .regex(/^[A-Za-z0-9_-]{43}$/, { error: 'INVALID' });

/** Id аватара (`GET /v1/avatars/:id`): случайный токен, не `userId`; новый при каждой замене фото. */
export const AvatarId = OpaqueToken;
export type AvatarId = z.infer<typeof AvatarId>;
/** Id публичного профиля райдера (`GET /v1/riders/:publicId`): случайный токен, не `userId`; не меняется. */
export const RiderPublicId = OpaqueToken;
export type RiderPublicId = z.infer<typeof RiderPublicId>;

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
