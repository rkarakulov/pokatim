# Findings — user-theme (PR A) — pass 1 — reviewer: claude
base: origin/develop   commits: 944d9e5e..5fffb31e (4 коммита, рабочее дерево чистое)
verdict: APPROVE

## Проверено

- **Корректность / API.** `PUT /v1/profile/theme`: `AuthGuard` на классе, `userId` из `@CurrentUser`, тело —
  `ZodValidationPipe(UpdateProfileThemeRequest)` (`strictObject`, строгий `AppThemeId`), лимит `profile-theme:<uid>`
  60/ч до записи, `429` + `retryAfterSec`, `no-store`, ответ — `profileViewOf`. Запись — pipeline-upsert
  `KEEP_PROFILE_FIELDS` + `$literal` (`profile.repository.ts:250`), инъекции нет. Гонка первых upsert —
  `isDuplicateKey(_, '_id_')` + один повтор (`profile.service.ts:91-99`), есть int-тесты (параллельные PUT и
  подменённый duplicate key).
- **Регрессии / call sites.** Все пути, отдающие `ProfileView` (GET, PATCH, PUT/удаление аватара, PUT theme), берут
  общий `VIEW_PROJECTION` с `themeId` — PATCH/аватар не «сбрасывают» тему в ответе (важно для `setQueryData(['profile'])`
  в PR B). Другие upsert'ы профиля поле не трогают (тест «PATCH тему не стирает»). `APP_APPEARANCE` /
  `AppearanceCoreModule` нигде не осталось; `arch:check` чистый.
- **Совместимость старых сборок.** `GET /v1/appearance` по-прежнему `{ themeId, decor }`, `themeId` — константа
  `classic` (RC-1 (a)); `AppAppearance` не меняла форму; int-тест с legacy `themeId: 'chrono'` в документе.
  `ProfileView` — `z.object` (старые сборки отбрасывают лишнее поле), новое поле — `tolerantEnum(...).default(classic)`.
  Панель — строгая схема, деплоится с API (A11, принято).
- **Стирание аккаунта.** `themeId` уходит с документом `profiles`; позднее воскрешение документа PUT'ом — тот же
  принятый путь, что у PATCH/аватара (`account.erasure-resume`), сессии отзываются в транзакции удаления.
- **Кэш карточек.** `themeId` в `storyCardHash`/`rideInviteHash`; worker перечитывает тему по `job.userId`
  (`story-card.processor.ts:88,108`), несовпадение → `skipped` + `release(pending)` → клиент перезапрашивает.
  Рендер устойчив к незнакомому id (`appThemes[id] ?? DEFAULT_THEME`). `renderVersion` не поднимался — разметка та же.
- **Аудит.** `appearance.decor_changed` — в транзакции; `appearance.theme_changed` больше не пишется, история
  читается через `theme.<id>.name` (`AuditScreen.tsx`).
- **Placement / reuse.** `RIDER_THEMES` в `ProfileCoreModule`, экспорт через `profile/index.ts`, новых рёбер нет;
  `previewOf` перенесён в `@pokatim/design-tokens`, i18n-ключи общие `theme.*`.
- **Миграции.** Нет (необязательные поля, чтение `??`), соответствует A1/A6.
- **Прогоны (сам):** `vitest run src/modules/{profile,appearance,sharing}` (изолированные Mongo :27117 / Redis :6479 db 13)
  — 255/258, 3 падения — таймауты `verified-profile-locks.int.test.ts` под нагрузкой; повторный изолированный прогон
  `profile.int.test.ts` + `verified-profile-locks.int.test.ts` — 55/55 зелёные (флейк окружения, не diff).
  `turbo typecheck` (api, admin, app, contracts, api-client, design-tokens, i18n) — зелёный; `eslint` и `prettier
  --check` по изменённым файлам — чисто; `pnpm arch:check` — без нарушений. Полный `pnpm check` — NOT VERIFIED
  (не запускался целиком).

## Findings

### [LOW] Устаревший JSDoc `updateAppearance` в api-client панели
- **file:** packages/api-client/src/admin.ts
- **location:** 352 (`updateAppearance`)
- **problem:** комментарий «Смена темы приложения: устаревшая `version` — 409» — метод теперь меняет только декор.
- **why_it_matters:** вводит в заблуждение следующего автора (тема — личная, `themeId` в теле — 400).
- **evidence:** `/** Смена темы приложения: устаревшая \`version\` — 409 \`CONFLICT\`. */` рядом с телом `{ decor, version }`.
- **recommended_fix:** «Смена сезонного декора: устаревшая `version` — 409 `CONFLICT`».

### [LOW] Подсказка панели ссылается на экран, которого нет до PR B
- **file:** packages/i18n/src/ru.ts
- **location:** `admin.appearance.hint`
- **problem:** «Тему каждый райдер выбирает сам в «Настройках»» — между мержем PR A и PR B экрана «Тема» в
  приложении нет (все в «Классике», A14).
- **why_it_matters:** только временная неточность текста на dev; не блокирует.
- **recommended_fix:** ничего, если PR B мержится следом; иначе — отметить в Outcome PR A.

Блокирующих (CRITICAL/HIGH) находок нет.
