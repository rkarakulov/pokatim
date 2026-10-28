# Экран «Настройки» (хаб) и выбор языка

Уровень task2. Ветка `feature/settings-hub` от `origin/develop`.

## 1. Title

Общий экран `/settings` приложения райдера: разделы аккаунта, язык, о приложении, выход, удаление аккаунта.

## 2. Goal

Сейчас экраны настроек (`settings/profile`, `devices`, `notifications`, `verified`, `account/delete`) открываются
разрозненно: иконки «Устройства» и «Профиль» на Главной, ссылки внутри «Профиля»; «Выйти» временно стоит внизу Главной
(Q8, «до экрана профиля»). Нужен один экран, который их собирает, и выбор языка интерфейса.

Прототип: в приватных макетах отдельного экрана «Настройки» нет (есть Главная, гонки, результат, календарь, райды,
панель). Экран собран из паттернов дизайн-системы, которые уже есть в приложении: top bar «Назад» + `displayTitle`,
kicker разделов, строки с hairline сверху (`.lrow`), `TextAction` для «Выйти» и деструктивного «Удалить аккаунт».

## 3. Scope

- `app/settings/index.tsx` — хаб «Настройки» внутри `Stack.Protected` вкладок (оболочка `useSettingsShell`):
  - «Аккаунт»: Профиль, Анкета Verified, Устройства, Уведомления — строки-ссылки на существующие экраны;
  - «Приложение»: «Язык» со значением текущего языка → `/settings/language`;
  - «О приложении»: версия (`expo-constants` → `expoConfig.version`), «Политика конфиденциальности», «Условия
    использования», «Поддержка» — адреса из `EXPO_PUBLIC_PRIVACY_URL`, `EXPO_PUBLIC_TERMS_URL`,
    `EXPO_PUBLIC_SUPPORT_EMAIL` (вшиваются в сборку); не задан — строки нет; открытие — `openExternalUrl`, ошибка — баннер;
  - «Выйти» (`useSignOut`, на время выхода недоступна) и внизу «Удалить аккаунт» (destructive) →
    `/settings/account/delete`.
- `app/settings/language.tsx` — выбор языка из `i18n.locales` (сейчас только «Русский»): радио-строки
  (`accessibilityRole="radio"`, `checked`), выбранный — галочка. Выбор: `i18n.setLocale` + запись на устройство.
- Язык на устройстве: `features/settings/locale-preference(.web).ts` — native `secureStorage` `pokatim.locale`
  (другого KV в проекте нет), web — `localStorage`. При запуске корневой layout применяет сохранённый язык, если он
  есть в `i18n.locales`; чужое или битое значение игнорируется.
- Вход: иконка «Профиль» верхней панели Главной становится «Настройки» (`/settings`); иконка «Устройства» остаётся
  (быстрый вход, tracks-devices). «Выйти» с Главной переезжает в хаб.
- `@pokatim/i18n`: `localeNames` (имя языка на самом языке) и строки `settings.*`.

## 4. Out of Scope

- Пункт «Тема» — тему выбирает команда в панели (ADR-0016); в настройках его нет.
- Второй язык (словарь en проекта), поле языка в профиле/API, серверная локализация писем и push.
- Профиль райдера с историей заездов; правки `settings/profile.tsx` (кроме навигации — не нужны).
- Страницы политики и условий (тексты — юристы), адрес поддержки на dev.

## 5. Architecture Context

- Только `apps/app` и `packages/i18n`. API, contracts, миграции, очереди не меняются.
- В `ProfileView` поля языка нет → язык хранится только на устройстве (см. 8.2).
- Отдельного `settings/_layout` нет (см. `features/devices/settings-shell.tsx`) — экраны регистрируются в корневом
  `Stack.Protected`.

## 5.1 Placement & Reuse Gate

- Переиспользуем: `useSettingsShell`, `DocumentTitle`, `TextAction`, `Banner`, `textStyle`, `useTheme`, токены
  `size/space/stroke`, `Icon` (`chevronRight`, `check` — добавить в реестр иконок), `useSignOut`, `openExternalUrl`,
  `secureStorage` + `readJson`, паттерн `device-flags(.web).ts`, `i18n` из `@pokatim/i18n`.
- Новое: `features/settings/settings-row.tsx` (строка-ссылка/значение/радио) — локально, кандидат в `@rkarakulov/ui`.
- Дубли запрещены: второй хук выхода, свой KV, хардкод цветов/отступов, сравнение с id темы.

## 6. Relevant Files

- `apps/app/src/app/settings/index.tsx` — новый хаб.
- `apps/app/src/app/settings/language.tsx` — новый выбор языка.
- `apps/app/src/features/settings/{settings-row.tsx,locale-preference.ts,locale-preference.web.ts,app-info.ts}`.
- `apps/app/src/app/_layout.tsx` — `Stack.Screen` и восстановление языка.
- `apps/app/src/components/top-bar.tsx`, `apps/app/src/app/(tabs)/index.tsx` — вход и перенос «Выйти».
- `apps/app/src/features/auth/secure-storage.ts` — ключ `pokatim.locale`.
- `apps/app/src/components/icon.tsx` — иконка `check`.
- `packages/i18n/src/{index.ts,ru.ts}`.
- `infra/docker/Dockerfile` — необязательные build-arg ссылок.

## 7. Implementation Notes

- `t()` и константы модулей вычисляются один раз: при одном языке переключение без перерисовки допустимо; второй язык
  потребует подписки (`useLocale`) или перезапуска — записано в follow-ups.
- Web SSR: `<html lang>` — `i18n.locales[0]`; сохранённый язык применяется только на клиенте (при одном языке
  расхождения нет).
- a11y: строки — `link`/`radio` с подписью «название, значение»; заголовки — `header`; touch target ≥ `size.touchMin`.

## 8. Risks / Assumptions / Open Questions

- Нет макета — экран собран из существующих паттернов; визуальная сверка с макетом невозможна.
- Ссылки политики/условий/поддержки на dev не заданы → строк не будет (проверено тестами, не на dev).

## 8.1 Requirements Consistency

- **Недоопределено:** «экран 11 прототипа» — в приватных макетах его нет → собираем по дизайн-системе (раздел 2).
- **Недоопределено:** адреса политики, условий и поддержки нигде не заданы (`SUPPORT_EMAIL` есть только у API) →
  переменные сборки, без значения — строка скрыта.

## 8.2 Deviations from spec

- Язык не сохраняется в профиле: поля в `ProfileView` нет; добавлять API ради одного языка — вне scope (решение
  исполнителя, 2026-10-28, отражено здесь и в отчёте).
- Иконка «Устройства» на Главной остаётся рядом с новой «Настройки» (быстрый вход из tracks-devices).

## 8.3 Security checklist

Security boundary не затронут: новых запросов нет, язык — не секрет (хранится рядом с флагами устройства), внешние
ссылки — только из переменных сборки, открываются системным браузером по нажатию.

## 9. Acceptance Criteria

1. Иконка «Настройки» в верхней панели Главной открывает `/settings`; «Выйти» на Главной больше нет.
2. Хаб: заголовок «Настройки», разделы Профиль, Анкета Verified, Устройства, Уведомления, Язык (со значением), О
   приложении (версия), Выйти, Удалить аккаунт; пункта «Тема» нет. Каждая строка ведёт на свой экран.
3. Ссылки «Политика», «Условия», «Поддержка» видны только при заданных переменных; нажатие открывает адрес
   (`mailto:` для поддержки); ошибка открытия — баннер.
4. «Выйти» отзывает сессию тем же `useSignOut`, гард ведёт на «Вход»; во время выхода кнопка недоступна.
5. «Язык»: список из `i18n.locales` с выбранным текущим; выбор сохраняет язык на устройстве и вызывает `setLocale`;
   при запуске сохранённый поддерживаемый язык применяется, неподдерживаемый/битый — игнорируется.
6. Гость, открывший `/settings` или `/settings/language`, уходит на вход (гард), SSR — скелетон оболочки.
7. Все цвета/отступы — из темы и токенов; проверено в «Классике», «Навигации» (тёмная) и «Типографике».
8. `pnpm check` зелёный.

## 10. Documentation Impact

- `.claude/rules/pokatim-app.md` — строка про хаб настроек и язык устройства.
- `docs/runbooks/deploy.md` + `infra/docker/Dockerfile` — необязательные `EXPO_PUBLIC_PRIVACY_URL`,
  `EXPO_PUBLIC_TERMS_URL`, `EXPO_PUBLIC_SUPPORT_EMAIL`.
- ADR не нужен: хранение на устройстве — по образцу флагов (`device-flags`).

## 11. Implementation Context

- ENTRY POINTS: `app/settings/index.tsx`, `app/settings/language.tsx`, `TopBar`.
- FILES TO MODIFY: раздел 6.
- FILES TO READ: `app/settings/profile.tsx`, `features/devices/settings-shell.tsx`, `features/onboarding/device-flags(.web).ts`,
  `lib/open-external-url(.web).ts`, `features/auth/use-sign-out.ts`.
- TYPES & SCHEMAS: без изменений contracts.
- TESTS: `__tests__/settings-screen.test.tsx` (хаб, «Язык», выход, восстановление языка, гость),
  `features/settings/locale-preference(.web).test.ts`, `lib/open-external-url.web.test.ts` (`mailto:`), правки
  `home.test.tsx`, `top-bar.test.tsx`, `sign-in.test.tsx`, `onboarding-guard.test.tsx`, `location.test.tsx`,
  `devices-step.test.tsx` (выход — из хаба), `packages/i18n/src/index.test.ts`, e2e `web.spec.ts`.
- OUT OF SCOPE: раздел 4.

## 12. Outcome

- **Changes**
  - `apps/app`: хаб `settings/index`, экран `settings/language`, `features/settings/` (строка, «О приложении», язык
    устройства native/web), иконки `settings`/`check`, ключ `pokatim.locale`; вход «Настройки» в `TopBar` вместо
    «Профиль»; «Выйти» убран с Главной; корневой layout восстанавливает язык; `openExternalUrl` (web) открывает
    `mailto:` в текущей вкладке.
  - `packages/i18n`: `localeNames`, строки `settings.*`.
  - `infra/docker/Dockerfile`: необязательные `EXPO_PUBLIC_PRIVACY_URL`, `EXPO_PUBLIC_TERMS_URL`,
    `EXPO_PUBLIC_SUPPORT_EMAIL`.
- **Docs updated:** `.claude/rules/pokatim-app.md`, `docs/runbooks/deploy.md`.
- **Tests:** jest `@pokatim/app` (native + web) и vitest `@pokatim/i18n` — зелёные; `format:check`, `lint`,
  `arch:check`, `typecheck` — см. PR. `@pokatim/api` локально не стартует (Startup Error vitest в среде агента; API в
  задаче не менялся) — проверка в CI. Визуальная проверка тем — на dev после выкатки (отчёт в pr.md).
- **Review:** Codex pass 1 — APPROVE без замечаний; Claude pass 1 — APPROVE, 5 LOW — все исправлены (mailto на web,
  тест недоступности «Выйти», тест восстановления языка корнем, комментарий layout, раздел 11).
- **Open follow-ups**
  - Второй язык: словарь en проекта (`translations` в `createI18n`), подписка экранов на смену языка (`t()` и
    константы модулей считаются один раз), `<html lang>` и SSR по выбору, язык писем и push на сервере.
  - Поле языка в профиле (`ProfileView`/`PATCH /v1/profile`) — когда язык понадобится серверу.
  - Адреса политики, условий и поддержки: задать в `deploy-dev.yml`/EAS env, когда появятся страницы.
  - `SettingsRow` — кандидат в `@rkarakulov/ui` (app-foundation).
