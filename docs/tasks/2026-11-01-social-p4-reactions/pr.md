## «Свои», этап 0 — P4: реакции — «Спасибо за компанию» и «Респект»

PR эпика `docs/tasks/2026-10-31-social-stage-0/task.md` (строка P4), спек — `docs/tasks/2026-11-01-social-p4-reactions/task.md`. Продукт — `social.md` K5, K8, K14; ADR-0027 п. 1, 3. Решения автора 2026-11-01 (Q1–Q4): «Поблагодарить всех» — всем явившимся, включая непубличных; карточка строки результата и «Респект» — любому вошедшему («Оспорить» — только участникам); респект — любой видимой строке таблицы до и после публикации протокола; имена поставивших — получателю в карточке своей строки.

- **Порты производителей:** `RESULTS_FOR_SOCIAL.respectTarget(entryId)` (видимость строки — общие предикаты `publicTableMode` / `isPublicProtocolRow` в `results.policy.ts`, на них же переведён `publicResults`) и `ROUTES_FOR_SOCIAL.respectTarget(routeId)` (`IN_CATALOG` + `origin: rider`). `results`/`routes` о `social` не знают.
- **API (`social`, `AuthGuard`, `no-store`):** `POST /v1/rides/:id/thanks {publicId?}` (без `publicId` — всем явившимся; ответ — `RideParticipants`), `GET|PUT /v1/races/:raceId/results/:entryId/respect`, `GET|PUT /v1/routes/:id/respect` (`PUT {respected}` идемпотентно; без цели — нейтральный `GET` и `404` на `PUT`; себе — `409 self`). Лимиты `social-thanks`, `social-respect`. Новые реакции — через `SocialReactionsService.insert` (P0), писатель `social_reactions` один. Публичные кэшируемые ответы не меняются.
- **Контракты:** `reactions.schema.ts`; в «Ехали N» — `RideAttendedRow` (`self`, `thanked`), `RideAttendance.allThanked` — всё с `.default(false)`.
- **Приложение:** «Спасибо за компанию» / «Вы сказали спасибо» и «Поблагодарить всех» / «Вы поблагодарили всех» на карточке прошедшего райда; строки таблицы результатов нажимаются любому вошедшему → карточка строки с «Респект · N» и «В свои» над «Оспорить» (своя строка — «респект N» и имена); «Респект автору» на экране заезда после «Маршрут пройден» (не на своём маршруте и не у маршрута команды).
- **P7:** уведомления о реакциях не отправляются; `notification-intake.ts`, `notification-texts.ts`, `notifications.policy.ts` не тронуты. Точка привязки — транзакция `SocialReactionsService.insert` (записка в §12 task.md).
- Миграций, очередей, outbox-событий нет.

### Проверки
- `pnpm format:check && lint && arch:check && typecheck` — зелёные; `turbo run test --continue` (изоляция Mongo `pokatim_social_p4_test`, Redis db 8): api 257 файлов / 2896, app 282 suites, admin 526, contracts 532, api-client 193, i18n, route-view, design-tokens — зелёные; `packages/tracks` — бенчмарк `analyzeSections ≤ 8000 мс` упал под нагрузкой от других сессий, отдельно 29/29 файлов, 402/402 (ветка tracks не трогает).
- Независимое ревью (Claude independent-reviewer): APPROVE, CRITICAL/HIGH — 0, LOW — 3 (`findings.md`); LOW «Райд не найден» при 404 «спасибо» исправлен, два LOW — follow-up.
- NOT VERIFIED: ручная проверка на симуляторе и в браузере.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
