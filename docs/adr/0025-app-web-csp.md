# 0025. Строгий CSP web приложения: nonce на SSR-ответ

- Статус: Accepted
- Дата: 2026-10-29
- Задача: `docs/tasks/2026-10-29-app-web-csp`
- Закрывает: ADR-0009, «Последствия» — «до прода — строгий CSP web приложения (SSR с nonce/хешами)»

## Контекст

Панель «Протокол» живёт на том же домене (`/admin/`, ADR-0009 C3): XSS в web приложения мог бы слать same-origin
запросы к `/v1/admin/*`. У web-сервера приложения (`apps/app/server`) CSP ограничивал только `frame-ancestors`,
`base-uri`, `object-src` — скрипты были без ограничений: гидрация Expo и данные `loader` — inline-скрипты.

Хеши не подходят: bootstrap-скрипт гидрации содержит данные `loader` и меняется от запроса к запросу. Expo SDK 58
nonce не поддерживает: `@expo/router-server` вызывает `renderToReadableStream` без `nonce`.

## Решение

1. **Nonce на ответ.** web-сервер (`server/web-server.ts`) на каждый запрос генерирует 128 бит (`randomBytes`,
   base64) и ставит enforce-`Content-Security-Policy` на все ответы:
   `default-src 'self'; script-src 'self' 'nonce-…'; style-src 'self' 'unsafe-inline'; connect-src 'self' <API>
   <карты>; img-src 'self' data: blob: <API>; font-src 'self'; worker-src 'self' blob:; manifest-src 'self';
   object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'`.
2. **Доставка nonce в рендер** — внутренний заголовок запроса `x-pokatim-csp-nonce`: сервер вырезает входящий (любой
   регистр) и кладёт свой в `rawHeaders` (из них expo-server строит `Request` рендера).
   - React — патч `@expo/router-server` (`patches/`, `patchedDependencies` в `pnpm-workspace.yaml`):
     `renderToReadableStream({ nonce })` — nonce на bootstrap-скрипте (флаг гидрации, данные `loader`) и служебных
     скриптах стриминга. Только React-скрипты, а не «все `<script>` в HTML»: внедрённый в разметку скрипт nonce не
     получит.
   - `+html.tsx` — свои inline-скрипты (id темы, регистрация service worker) с `nonce={cspNonce()}`
     (`requestHeaders()`, как тема SSR, ADR-0021).
3. **Без `'strict-dynamic'`.** Бандлы `/_expo/static/*.js` и чанки `import()` — свой origin (`'self'`);
   `strict-dynamic` отключил бы `'self'` и потребовал nonce на каждом `<script src>` Expo.
4. **Стили — `'unsafe-inline'` (принятый риск).** RN-web пишет `style`-атрибуты в SSR и создаёт `<style>` в рантайме,
   expo-font — `<style>` шрифтов; nonce в `style-src` отключил бы `'unsafe-inline'`. CSS-инъекция не исполняет JS;
   инъекция разметки закрыта экранированием React (`dangerouslySetInnerHTML` — только константы `+html.tsx`).
5. **Внешние origin-ы.** API — origin `EXPO_PUBLIC_API_URL` из env процесса (прод — тот же origin, без дубля);
   карты — `MAP_ORIGINS` (`https://tiles.openfreemap.org`). Смена провайдера карт = env сборки + `MAP_ORIGINS`
   (сторож — origin стиля из `deploy-dev.yml`, как у панели, ADR-0014). Web Push (ADR-0022) идёт через push-сервис
   браузера — CSP страницы не касается.
6. **Без `unsafe-eval`.** zod 4 проверяет JIT через `new Function` (в try/catch — но нарушение фиксируется): в web —
   `z.config({ jitless: true })` до создания первой схемы — zod проверяет JIT уже в конструкторе `z.object`
   (`zod-jitless.web.ts`, первый импорт `theme/design-system.ts`, сторож — `design-system-setup.test.ts`).
7. **Сторожа:** `server/web-server.test.ts` — директивы политики, nonce свой у ответа, входящий не проходит, патч и
   `csp-nonce.ts` читают то же имя заголовка; e2e — nonce всех inline-скриптов SSR, нарушения `securitypolicyviolation`
   на ключевых страницах (часть нарушений `console.error` не пишет) и `console.error` фикстуры.

## Альтернативы

- **Дописывать nonce всем `<script` в готовом HTML** (без патча) — nonce получил бы и внедрённый скрипт: CSP
  потерял бы смысл против XSS.
- **`'unsafe-inline'` в `script-src`** — не защищает от XSS.
- **Хеши** — не работают с данными `loader`.
- **Report-Only** — нет сервиса приёма отчётов; нарушения ловят e2e и проверка стенда.

## Последствия

- Обновление Expo (`@expo/router-server`) — перенос патча; pnpm падает на установке, если версия не совпала, а
  сторож и e2e — если nonce пропал.
- Оболочка билета в кеше service worker хранится с заголовками ответа: nonce тела и CSP совпадают, повторяется только
  в этой копии.
- Dev-сервер `expo start` CSP не ставит (не наш сервер); `build:web:dev` + `server/main.ts` — ставит.
- Новый внешний источник (картинки, API, карты) — сначала в `contentSecurityPolicy`, иначе браузер его заблокирует.
