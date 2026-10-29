---
paths:
  - "apps/app/**"
---

# Приложение — apps/app (Expo + Expo Router)

Процесс: скил `app-dev-kit:mobile-expo`. Рамки продукта — `AGENTS.md` §1.

## Правила

- Маршруты — файловые в `src/app/` (не-роутовый код — вне `src/app/`); deep links — через Router,
  схема `pokatim://`.
- Данные — только через `@pokatim/api-client` (TanStack Query, `src/lib/api.ts`). Локальное состояние — минимум.
- Строки UI — только из `@pokatim/i18n`.
- Оформление — только семантика: `useTheme()` (роли `text.*`, `surface.*`, `border.*`…), `textStyle(name)`,
  `space` / `inset` / `size` / `stroke` из `@pokatim/design-tokens`. Примитивы (`color.*`) и hex — нельзя.
- Дизайн-система — единственный источник оформления (`AGENTS.md` §4): сначала компоненты `@rkarakulov/ui`
  (Button, TextAction, TextField, Banner, Skeleton…). Чего не хватает — расширяй систему: токен/роль в
  `@pokatim/design-tokens` (бренд) или задачей в app-foundation (общий токен/компонент `@rkarakulov/ui` с
  тестом и примером на витрине `UiKit`, экран `/ui-kit` в dev).
- Дизайн-система настраивается в `src/theme/design-system.ts` (`configureDesignSystem`) — первым импортом
  корня приложения и `jest.setup.ts`; сторож — тест первого импорта.
- Состояния данных — строго по `AGENTS.md` §4, через `AsyncContent` и `SkeletonGroup` + `Skeleton` /
  `SkeletonText` из `@rkarakulov/ui`.
- `onlineManager` на native подключён к `@react-native-community/netinfo` (`src/lib/online-manager.ts`): без этого
  в RN нет `fetchStatus: 'paused'`, и `AsyncContent` покажет «Нет соединения» только после всех ретраев. На web
  (`online-manager.web.ts`) — встроенный `navigator.onLine` TanStack Query.

## Все платформы (iOS, Android, web/PWA)

- Фича = все платформы (`AGENTS.md` §4.13). Развилка по платформе — только файлами рядом: `x.ts` + `x.web.ts`
  (или `x.native.ts`), импорт без расширения (`@/lib/x`). `Platform.OS` в экранах и компонентах — нет.
- SSR-безопасность: на уровне модуля и в рендере — без `window`, `document`, `localStorage`, `navigator`;
  браузерное — в эффектах или в `.web`-файлах. Текст, зависящий от времени и часового пояса, на сервере не
  рендерить (рассинхрон гидрации) — показывать после монтирования. Локаль SSR — базовая.
- Публичный экран (по ссылке, без входа; образец — `src/app/status.tsx`): данные — API через TanStack Query;
  `loader` — только посев SSR (`initialData: useLoaderSeed()`), ошибка/нет API — `null`, не 500; OG и `<title>` —
  `generateMetadata` (`expo-router/server`), заголовок после клиентской навигации — `DocumentTitle`
  (`src/components/document-title`).
- `expo-router/head` — только в `.web`-файлах: на iOS (dev client, сборки) `<Head>` регистрирует NSUserActivity и
  без `origin` у плагина expo-router роняет экран. Сторож — мок модуля `ExpoHead` в `jest.setup.ts`.
- Абсолютные URL (`og:url`, ссылки в мета) — только из `WEB_ORIGIN` (env сервера), не из `Host`/`request.url`:
  подменённый заголовок отравил бы кеш и превью.
- Серверные адреса и секреты web-сервера — без префикса `EXPO_PUBLIC_` (`API_INTERNAL_URL`, `WEB_ORIGIN`).
  `EXPO_PUBLIC_*` — публичные значения: попадают в клиентский бандл, секретов там нет.
- Service worker (`scripts/service-worker.ts`) кеширует только статику сборки с хешем в имени (версия кеша — от
  содержимого): HTML, данные loader-ов (`/_expo/loaders`), API, manifest и `public/` — мимо, офлайн-данных нет.
  Исключение pokatim — HTML-оболочка экрана билета (`pokatim-app.md` «Билеты»).
- Проверка в браузере: `pnpm build:web` + `pnpm --filter @pokatim/app start:web`, смоук — `pnpm e2e:web`
  (`e2e/web.spec.ts`: новый маршрут — шаг смоука; `test`/`expect` — из `e2e/fixtures.ts`, ошибки страницы не
  глушить); серверы, env и ожидаемые отказы смоука проекта — только `e2e/project.ts` (`playwright.config.ts`
  шаблонный); web-варианты модулей — тесты `*.web.test.ts(x)` (jest, web).
- Доступность: `accessibilityLabel`/`accessibilityRole` на интерактивных элементах, reduce motion, крупный шрифт.
- Секреты в бандл не кладём: в приложении только публичные ключи.
- Нативные модули — только через config plugins Expo; `ios/`/`android/` не коммитим (CNG).
