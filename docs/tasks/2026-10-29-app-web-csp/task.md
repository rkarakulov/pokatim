# task: строгий CSP web приложения (SSR с nonce)

## 1. Title

Строгий `Content-Security-Policy` web/PWA приложения `apps/app` — nonce на каждый SSR-ответ.

## 2. Goal

Блокер прода из ADR-0009 (C3, «до прода — строгий CSP web приложения (SSR с nonce/хешами)»): панель живёт на том же
домене, XSS в web приложения мог бы слать same-origin запросы к `/v1/admin/*`. Сейчас у приложения CSP — только
`frame-ancestors 'none'; base-uri 'self'; object-src 'none'` (`apps/app/server/web-server.ts`), скрипты не ограничены.

## 3. Scope

- web-сервер приложения (`apps/app/server`): nonce (16 случайных байт, base64) на каждый запрос, enforce-политика
  `Content-Security-Policy` на всех ответах; origin API (`EXPO_PUBLIC_API_URL`) — в `connect-src`/`img-src`,
  origin стиля карт (OpenFreeMap) — в `connect-src`.
- nonce до рендера: внутренний заголовок запроса `x-pokatim-csp-nonce` (входящий от клиента вырезается), expo-server
  передаёт `Request` в рендер.
- `@expo/router-server` (pnpm patch): `renderToReadableStream({ nonce })` — nonce на bootstrap-скрипте гидрации
  (флаг гидрации + данные `loader`) и служебных скриптах React стриминга. Expo SDK 58 nonce не поддерживает.
- `+html.tsx`: nonce на двух своих inline-скриптах (id темы, регистрация service worker) — из `requestHeaders()`.
- Docker: `patches/` в слой установки зависимостей.
- Сторож-тесты: политика (директивы, нет `unsafe-eval`, скрипты без `unsafe-inline`, origin стиля из
  `deploy-dev.yml`), nonce уникален на запрос, клиент не подставит свой nonce, патч применён (SSR-ответ сборки).
- ADR-0025, правило `.claude/rules/pokatim-web.md`/`pokatim-security.md`, runbook (deploy/local-dev).

## 4. Out of Scope

- `Report-Only`/`report-to` эндпоинт сбора нарушений (нет сервиса приёма — отдельная задача, если понадобится).
- Отказ от `'unsafe-inline'` в стилях (RN-web: `style`-атрибуты SSR и `<style>` в рантайме — см. ADR-0025).
- CSP панели (уже есть), заголовки API.
- Trusted Types.

## 5. Architecture Context

- apps/app: `server/web-server.ts` (Express, Node без бандлера), `src/app/+html.tsx` (только сервер).
- Нет API, contracts, миграций, очередей.
- Сборка: `expo export` бандлит `@expo/router-server` в `dist/server` — патч попадает в сборку на install.

## 5.1 Placement & Reuse Gate

- Политика и nonce — в `server/web-server.ts` (единственное место заголовков web-сервера); чтение nonce в SSR —
  `src/features/web-security/csp-nonce.ts` по образцу `ssr-theme.ts` (`requestHeaders()` с фолбэком вне запроса).
- Имя заголовка — одна константа на сервер и SSR? Сервер (Node, без `@/`) и бандл не делят модули: константа
  дублируется ровно в двух местах + патч; сторож-тест сверяет все три.
- Сторож — по образцу `apps/admin/src/csp.test.ts` (origin стиля из `deploy-dev.yml`).

## 6. Relevant Files

- `apps/app/server/web-server.ts` — заголовки, nonce, политика.
- `apps/app/server/web-server.test.ts` — тесты сервера (supertest-подобные через fetch).
- `apps/app/src/app/+html.tsx` — inline-скрипты документа.
- `apps/app/src/features/web-security/csp-nonce.ts` — nonce запроса в SSR.
- `patches/@expo__router-server@58.0.15.patch`, `pnpm-workspace.yaml` — патч рендера.
- `infra/docker/Dockerfile` — `COPY patches`.
- `apps/app/e2e/web.spec.ts` — заголовок и nonce в браузере; нарушения CSP = console.error → падение смоука.
- `docs/adr/0025-app-web-csp.md`, `.claude/rules/pokatim-web.md`, `.claude/rules/pokatim-security.md`,
  `docs/runbooks/deploy.md`.

## 7. Implementation Notes

- expo-server строит `Request` из `req.rawHeaders` — заголовок nonce кладётся в `rawHeaders` (и `headers`), все
  входящие варианты имени (регистр) вырезаются.
- `script-src 'self' 'nonce-…'` без `'strict-dynamic'`: бандлы `/_expo/static/*.js` (и чанки `import()`) — свой
  origin; `strict-dynamic` отключил бы `'self'` и потребовал nonce на каждом `<script src>` Expo.
- Nonce скрыт браузером из DOM (`nonce` IDL) — `+html` не гидратируется, рассинхрона нет.
- Оболочка билета в кеше service worker хранится с заголовками ответа — nonce в теле и CSP совпадают.

## 8. Risks / Assumptions / Open Questions

- Патч `@expo/router-server` ломается на обновлении Expo → сторож-тест сборки (SSR-ответ содержит nonce на всех
  inline-скриптах) + e2e (нарушение CSP = console.error).
- Библиотеки с `eval`/`new Function` (zod JIT) — проверка e2e; при нарушении — правка конфигурации, не `unsafe-eval`.
- `'unsafe-inline'` в `style-src` — принятый риск (CSS-инъекции без исполнения JS), ADR-0025.

## 8.1 Requirements Consistency

Нет находок. ADR-0009 явно требует nonce/хеши; хеши невозможны (данные `loader` в bootstrap-скрипте меняются).

## 8.2 Deviations from spec

Нет.

## 8.3 Security checklist

- Данные наружу: nonce — только в заголовке ответа и атрибутах; не логируется.
- Злоупотребления: клиент не может навязать nonce (входящий заголовок вырезается); nonce 128 бит на запрос.
- Предсказуемость: `crypto.randomBytes`.

## 9. Acceptance Criteria

1. Каждый ответ web-сервера несёт enforce-CSP: `default-src 'self'`, `script-src 'self' 'nonce-<n>'` (без
   `unsafe-inline`/`unsafe-eval`/`strict-dynamic`), `style-src 'self' 'unsafe-inline'`, `connect-src 'self' <API>
   <карты>`, `img-src 'self' data: blob: <API>`, `font-src 'self'`, `worker-src 'self' blob:`, `manifest-src 'self'`,
   `object-src 'none'`, `base-uri 'self'`, `form-action 'self'`, `frame-ancestors 'none'`.
2. Nonce — свой у каждого ответа; входящий `x-pokatim-csp-nonce` игнорируется.
3. Все `<script>` SSR-документа (bootstrap React, id темы, регистрация SW) несут `nonce` из заголовка; `<script src>`
   бандлов — свой origin.
4. Origin стиля карты из `deploy-dev.yml` ∈ `connect-src` (сторож).
5. `pnpm e2e:web` (без и с `E2E_API=1`) — без нарушений CSP в консоли: лендинг, вход, главная, гонка, маршрут, билет.
6. dev после деплоя: заголовок есть, ключевые страницы без нарушений в консоли.

## 10. Documentation Impact

ADR-0025 (новое решение, закрывает пункт ADR-0009), `.claude/rules/pokatim-web.md` и `pokatim-security.md`,
`docs/runbooks/deploy.md` (чек после деплоя, смена провайдера карт = env + CSP).

## 11. Implementation Context

Уровень task3 inline (контекст собран автором): один модуль (web-сервер) + патч зависимости + документ.

## 12. Status

SPEC → IMPLEMENT.
