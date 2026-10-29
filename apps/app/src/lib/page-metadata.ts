import { OG_CARD_SIZE } from '@pokatim/contracts';
import { t } from '@pokatim/i18n';
import type { Metadata } from 'expo-router/server';

interface PublicPageMetadata {
  title: string;
  description: string;
  /**
   * Путь для `og:url` — только без секретов: путь с токеном (ссылки из писем) не передаём, превью и кеши
   * мессенджеров его бы сохранили.
   */
  path?: string;
  /** OG-картинка (og-images): абсолютный URL от `WEB_ORIGIN` и alt — `lib/og-image.ts`. */
  image?: { url: string; alt: string };
}

/**
 * `generateMetadata` публичного экрана (SSR web): `<title>`, description и OG без персональных данных.
 * `og:url` — только из `WEB_ORIGIN` (env сервера), не из Host запроса: подменённый заголовок отравил бы кеш и превью.
 * `image` — `og:image` 1200×630 и `twitter:card` (og-images); нет — вывод прежний.
 */
export function publicPageMetadata({
  title,
  description,
  path,
  image,
}: PublicPageMetadata): Metadata {
  const origin = process.env.WEB_ORIGIN?.replace(/\/$/, '');
  return {
    title: `${title} — ${t('app.name')}`,
    description,
    openGraph: {
      title,
      description,
      type: 'website',
      siteName: t('app.name'),
      ...(origin && path ? { url: `${origin}${path}` } : {}),
      ...(image
        ? {
            images: [
              {
                url: image.url,
                width: OG_CARD_SIZE.width,
                height: OG_CARD_SIZE.height,
                alt: image.alt,
                type: 'image/png',
              },
            ],
          }
        : {}),
    },
    ...(image ? { twitter: { card: 'summary_large_image' as const } } : {}),
  };
}
