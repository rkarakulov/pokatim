# Строгий CSP web приложения: nonce на SSR-ответ (ADR-0025)

Закрывает пункт ADR-0009 «до прода — строгий CSP web приложения (SSR с nonce/хешами)».

## Что сделано

- `apps/app/server/web-server.ts`: nonce (128 бит) на каждый ответ, enforce-`Content-Security-Policy` на всех ответах:
  `default-src 'self'; script-src 'self' 'nonce-…'; style-src 'self' 'unsafe-inline'; connect-src 'self' <API> <карты>;
  img-src 'self' data: blob: <API>; font-src 'self'; worker-src 'self' blob:; manifest-src 'self'; object-src 'none';
  base-uri 'self'; form-action 'self'; frame-ancestors 'none'`.
- Nonce в рендер — внутренним заголовком запроса `x-pokatim-csp-nonce` (входящий от клиента вырезается, в любом
  регистре; expo-server строит `Request` из `rawHeaders`).
- `patches/@expo__router-server@58.0.15.patch` (pnpm `patchedDependencies`): `renderToReadableStream({ nonce })` —
  nonce на bootstrap-скрипте React (гидрация, данные `loader`). Expo SDK 58 nonce не поддерживает.
- `+html.tsx`: nonce на inline-скриптах темы и регистрации service worker (`cspNonce()` из `requestHeaders()`).
- zod в web — `jitless` (первый импорт `theme/design-system.ts`): иначе проверка `new Function` — нарушение `script-src`.
- Docker: `COPY patches/` в слой установки зависимостей.

## Конфиги и env

- Новых env нет. CSP берёт origin API из `EXPO_PUBLIC_API_URL` окружения web-сервера — он обязан совпадать с
  build-arg сборки (прод/dev — тот же origin). Origin карт — константа `MAP_ORIGINS` (смена провайдера = env сборки +
  `MAP_ORIGINS`, сторож — `deploy-dev.yml`).
- `pnpm-workspace.yaml`: `patchedDependencies`; `pnpm-lock.yaml` — хеш патча.

## Проверки

- `server/web-server.test.ts`: директивы политики, nonce свой у ответа и совпадает с видимым рендеру, входящий
  заголовок не проходит, origin стиля карт стенда ∈ `connect-src`, патч и `csp-nonce.ts` читают то же имя.
- e2e: «строгий CSP: nonce свой у ответа, все inline-скрипты SSR — с ним, бандлы — свой origin» и «ключевые страницы
  без нарушений» (`securitypolicyviolation` на `/`, `/welcome`, `/sign-in`, `/status`, гонке, маршруте, билете).
- `pnpm e2e:web` без API локально: CSP-тесты и PWA зелёные; 6 тестов гардов («Нет соединения» против «Не удалось
  загрузить») падают и на develop без изменений CSP — проверено на сервере из `origin/develop`, не связано.
- С API (`E2E_API=1`) — CI.
- Ревью: Claude independent-reviewer — APPROVE (2 MEDIUM, 3 LOW — исправлены), Codex — APPROVE (1 MEDIUM —
  исправлен). `findings.md`, `findings-codex.md`.

## После деплоя

dev: `curl -sI https://pokatim-dev.limedolphin.com/welcome` — CSP с nonce; консоль без нарушений на лендинге, входе,
главной, гонке, маршруте с картой, билете (runbook `deploy.md`, «Проверка»).

🤖 Generated with [Claude Code](https://claude.com/claude-code)
