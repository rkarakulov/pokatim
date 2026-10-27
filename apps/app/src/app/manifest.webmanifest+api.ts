import { appThemes } from '@pokatim/design-tokens';
import { t } from '@pokatim/i18n';

import { ssrThemeId } from '@/features/appearance/ssr-theme';
import { manifestColor } from '@/theme/document-theme';

const ICONS = '/icons';

/**
 * Web App Manifest (PWA: «На экран Домой»): имя — из словаря, цвета — из активной темы процесса (`+middleware.ts`).
 * API-маршрут, а не файл в public/: цвета и имя не дублируются вручную.
 */
export function GET(): Response {
  const name = t('app.name');
  const color = manifestColor(appThemes[ssrThemeId()]);
  const manifest = {
    name,
    short_name: name,
    start_url: '/',
    scope: '/',
    display: 'standalone',
    theme_color: color,
    background_color: color,
    icons: [
      { src: `${ICONS}/icon-192.png`, sizes: '192x192', type: 'image/png' },
      { src: `${ICONS}/icon-512.png`, sizes: '512x512', type: 'image/png' },
      {
        src: `${ICONS}/icon-maskable-512.png`,
        sizes: '512x512',
        type: 'image/png',
        purpose: 'maskable',
      },
    ],
  };
  return new Response(JSON.stringify(manifest), {
    headers: { 'Content-Type': 'application/manifest+json', 'Cache-Control': 'no-cache' },
  });
}
