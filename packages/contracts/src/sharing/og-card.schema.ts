import { z } from 'zod';

import { fieldError, Uuid } from '../common.ts';
import { RiderPublicId } from '../profile/rider-avatar.schema.ts';

/**
 * OG-картинки публичных страниц (og-images, ADR-0018): своя картинка гонки, кофе-райда, маршрута каталога, старта
 * календаря, сезона и профиля райдера; остальные публичные страницы — бренд-картинка (`OG_BRAND`). Виды — только в
 * конец.
 */
export const OG_CARD_KINDS = ['race', 'ride', 'route', 'calendar', 'season', 'rider'] as const;
export const OgCardKind = z.enum(OG_CARD_KINDS, { error: fieldError('INVALID') });
export type OgCardKind = z.infer<typeof OgCardKind>;

/** Схема id объекта по виду (одна таблица для API и SSR): райдер — `publicId` профиля, остальные — Uuid. */
export const OG_CARD_ID = {
  race: Uuid,
  ride: Uuid,
  route: Uuid,
  calendar: Uuid,
  season: Uuid,
  rider: RiderPublicId,
} as const satisfies Record<OgCardKind, z.ZodType<string>>;

/** Бренд-картинка: литералы пути `/v1/og/{cards,images}/brand/site`. */
export const OG_BRAND = { kind: 'brand', id: 'site' } as const;

/** Версия картинки — первые 16 hex sha256 входов карточки (новая версия — новый URL картинки). */
export const OgCardVersion = z.string().regex(/^[0-9a-f]{16}$/);

/** `GET /v1/og/cards/:kind/:id` и `/v1/og/cards/brand/site` — текущая версия картинки. */
export const OgCardMeta = z.object({ version: OgCardVersion });
export type OgCardMeta = z.infer<typeof OgCardMeta>;

/** id не своего вида (`OG_CARD_ID`) — ошибка поля `id` с кодом `INVALID`. */
const idOfKind = ({ kind, id }: { kind: OgCardKind; id: string }, ctx: z.RefinementCtx) => {
  if (!OG_CARD_ID[kind].safeParse(id).success) {
    ctx.addIssue({ code: 'custom', path: ['id'], message: 'INVALID' });
  }
};

/** Параметры пути `cards`: вид и id объекта по виду (`OG_CARD_ID`); лишние ключи и id не своего вида — 400. */
export const OgCardParams = z
  .strictObject({ kind: OgCardKind, id: z.string({ error: fieldError('INVALID') }) })
  .superRefine(idOfKind);
export type OgCardParams = z.infer<typeof OgCardParams>;

/** Имя файла картинки: `<версия>.png`. */
export const OgImageFile = z.string().regex(/^[0-9a-f]{16}\.png$/);

/** Параметры пути `images`: вид, id по виду и имя файла версии; лишние ключи — 400. */
export const OgImageParams = z
  .strictObject({
    kind: OgCardKind,
    id: z.string({ error: fieldError('INVALID') }),
    file: OgImageFile,
  })
  .superRefine(idOfKind);
export type OgImageParams = z.infer<typeof OgImageParams>;

/** Размер PNG, px (геометрия — `ogCard` в `@pokatim/design-tokens`). */
export const OG_CARD_SIZE = { width: 1200, height: 630 } as const;
