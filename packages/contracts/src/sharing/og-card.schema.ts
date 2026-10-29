import { z } from 'zod';

import { fieldError, Uuid } from '../common.ts';

/**
 * OG-картинки публичных страниц (og-images, ADR-0018): своя картинка гонки, кофе-райда, маршрута каталога и старта
 * календаря; остальные публичные страницы — бренд-картинка (`OG_BRAND`). Виды — только в конец.
 */
export const OG_CARD_KINDS = ['race', 'ride', 'route', 'calendar'] as const;
export const OgCardKind = z.enum(OG_CARD_KINDS, { error: fieldError('INVALID') });
export type OgCardKind = z.infer<typeof OgCardKind>;

/** Бренд-картинка: литералы пути `/v1/og/{cards,images}/brand/site`. */
export const OG_BRAND = { kind: 'brand', id: 'site' } as const;

/** Версия картинки — первые 16 hex sha256 входов карточки (новая версия — новый URL картинки). */
export const OgCardVersion = z.string().regex(/^[0-9a-f]{16}$/);

/** `GET /v1/og/cards/:kind/:id` и `/v1/og/cards/brand/site` — текущая версия картинки. */
export const OgCardMeta = z.object({ version: OgCardVersion });
export type OgCardMeta = z.infer<typeof OgCardMeta>;

/** Параметры пути `cards`/`images`: вид и id объекта; лишние ключи и не Uuid — 400. */
export const OgCardParams = z.strictObject({ kind: OgCardKind, id: Uuid });
export type OgCardParams = z.infer<typeof OgCardParams>;

/** Имя файла картинки: `<версия>.png`. */
export const OgImageFile = z.string().regex(/^[0-9a-f]{16}\.png$/);

/** Размер PNG, px (геометрия — `ogCard` в `@pokatim/design-tokens`). */
export const OG_CARD_SIZE = { width: 1200, height: 630 } as const;
