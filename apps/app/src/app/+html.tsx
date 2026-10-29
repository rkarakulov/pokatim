import { appThemes } from '@pokatim/design-tokens';
import { i18n } from '@pokatim/i18n';
import { ScrollViewStyleReset, useServerDocumentContext } from 'expo-router/html';
import type { ReactNode } from 'react';

import { ssrThemeId } from '@/features/appearance/ssr-theme';
import { cspNonce } from '@/features/web-security/csp-nonce';
import { documentCss, themeColors } from '@/theme/document-theme';

// service worker (кеш статики, scripts/service-worker.ts) — только в production: в dev он кешировал бы бандлы Metro
const registerServiceWorker = `
if ('serviceWorker' in navigator) {
  addEventListener('load', () => navigator.serviceWorker.register('/sw.js'));
}`;

/**
 * Корневой HTML web-версии: только сервер (SSR), в браузере не гидратируется — без `window`/`document`.
 * `useServerDocumentContext` — все четыре поля: мета маршрута (`generateMetadata`), стили, бандлы гидрации.
 * Тема — личная тема райдера из cookie запроса (`ssrThemeId`, user-theme; нет или мусор — «Классика»): фон документа до
 * гидрации (без белой вспышки в тёмной схеме),
 * автозаполнение, `theme-color` и id для гидрации без мигания (`window.__POKATIM_THEME__` — только id из закрытого
 * списка, `JSON.stringify`).
 * Inline-скрипты — с nonce CSP запроса (`cspNonce`, ADR-0025): без него браузер их не исполнит.
 */
export default function RootHtml({ children }: { children: ReactNode }) {
  const { htmlAttributes, headNodes, bodyAttributes, bodyNodes } = useServerDocumentContext();
  const theme = appThemes[ssrThemeId()];
  const nonce = cspNonce();

  return (
    // базовый язык словаря; язык пользователя на сервере (Accept-Language) — вместе с сессией в web
    <html lang={i18n.locales[0]} {...htmlAttributes}>
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
        {themeColors(theme).map(({ media, color }) => (
          <meta key={media ?? 'all'} name="theme-color" media={media} content={color} />
        ))}
        <link rel="manifest" href="/manifest.webmanifest" />
        <link rel="apple-touch-icon" href="/icons/apple-touch-icon.png" />
        <meta name="apple-mobile-web-app-capable" content="yes" />
        <meta name="mobile-web-app-capable" content="yes" />
        <style dangerouslySetInnerHTML={{ __html: documentCss(theme) }} />
        <ScrollViewStyleReset />
        <script
          nonce={nonce}
          dangerouslySetInnerHTML={{
            __html: `window.__POKATIM_THEME__=${JSON.stringify(theme.id)}`,
          }}
        />
        {headNodes}
      </head>
      <body {...bodyAttributes}>
        {children}
        {bodyNodes}
        {process.env.NODE_ENV === 'production' ? (
          <script nonce={nonce} dangerouslySetInnerHTML={{ __html: registerServiceWorker }} />
        ) : null}
      </body>
    </html>
  );
}
