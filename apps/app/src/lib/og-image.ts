import { OG_BRAND, type OgCardKind, OgCardMeta } from '@pokatim/contracts';
import { t } from '@pokatim/i18n';

import { fetchPublicForSsr, publicPath, type PublicSsrResult } from './public-ssr';

/*
 * OG-картинка публичной страницы (og-images, ADR-0018) — только SSR (`generateMetadata`, web-сервер). Версию картинки
 * считает API (`GET /v1/og/cards/<kind>/<id>` → `{ version }`), не приложение: версия в URL меняется с содержимым
 * карточки, мессенджеры берут новую картинку. Адрес — только от `WEB_ORIGIN` (env сервера, как `og:url`): Caddy
 * проксирует `/v1/*` того же хоста в API. Нет `WEB_ORIGIN` — ни запросов, ни картинки.
 */

/** Картинка для `publicPageMetadata({ image })`. */
export interface OgImage {
  url: string;
  alt: string;
}

/** `WEB_ORIGIN` без хвостового `/`; не задан — `null`. */
export function ogOrigin(): string | null {
  return process.env.WEB_ORIGIN?.replace(/\/$/, '') || null;
}

/** Версия картинки объекта (кэш процесса 60 с); невалидный id — «не найдено» без запроса. */
export function ogCardForSsr(kind: OgCardKind, id: unknown): Promise<PublicSsrResult<OgCardMeta>> {
  const path = publicPath(`/v1/og/cards/${kind}`, id);
  return path ? fetchPublicForSsr(path, OgCardMeta) : Promise.resolve({ status: 'notFound' });
}

/** Версия картинки объекта, только если задан `WEB_ORIGIN` (иначе — `null` без запроса): параллельно с данными страницы. */
export const ogCardIfOrigin = (
  kind: OgCardKind,
  id: unknown,
): Promise<PublicSsrResult<OgCardMeta> | null> =>
  ogOrigin() ? ogCardForSsr(kind, id) : Promise.resolve(null);

export const brandCardForSsr = () =>
  fetchPublicForSsr(`/v1/og/cards/${OG_BRAND.kind}/${OG_BRAND.id}`, OgCardMeta);

export const ogImageUrl = (origin: string, kind: string, id: string, version: string) =>
  `${origin}/v1/og/images/${kind}/${encodeURIComponent(id)}/${version}.png`;

/** Бренд-картинка (страницы без своей картинки); версия недоступна — `undefined`. */
export async function brandOgImage(): Promise<OgImage | undefined> {
  const origin = ogOrigin();
  if (!origin) return undefined;
  const brand = await brandCardForSsr();
  return brand.status === 'found'
    ? {
        url: ogImageUrl(origin, OG_BRAND.kind, OG_BRAND.id, brand.data.version),
        alt: t('ogCard.alt.brand', { tagline: t('app.tagline') }),
      }
    : undefined;
}

/** Бренд-картинка страницы-бренда с данными: «не найдено» — без картинки; нашлось или API недоступен — бренд. */
export const brandOgImageFor = (page: PublicSsrResult<unknown>) =>
  page.status === 'notFound' ? Promise.resolve(undefined) : brandOgImage();

/**
 * Картинка страницы объекта: страница «не найдено» — без картинки; страница и версия нашлись — своя; иначе
 * (картинки нет — объект отменён, или API недоступен) — бренд (запрос бренда — только в этой ветке).
 */
export async function pageOgImage({
  kind,
  page,
  card,
}: {
  kind: OgCardKind;
  page: PublicSsrResult<{ id: string; title: string }>;
  card: PublicSsrResult<OgCardMeta> | null;
}): Promise<OgImage | undefined> {
  const origin = ogOrigin();
  if (!origin || page.status === 'notFound') return undefined;
  if (page.status === 'found' && card?.status === 'found') {
    return {
      url: ogImageUrl(origin, kind, page.data.id, card.data.version),
      alt: t(`ogCard.alt.${kind}`, { title: page.data.title }),
    };
  }
  return brandOgImage();
}
