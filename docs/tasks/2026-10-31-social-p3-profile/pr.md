## «Свои», этап 0 — P3: профиль — «В свои», экран «Свои», «Свои · N», подсказка имени

Четвёртый PR эпика (`docs/tasks/2026-10-31-social-stage-0/task.md`, строка P3), спек — `docs/tasks/2026-10-31-social-p3-profile/task.md`. Продукт — `social.md` K1, K3, K6, K11; ADR-0027 п. 3.

- **API (`social`, `AuthGuard`, `no-store`):** `GET /v1/riders/:publicId/social` (`self`, `connected`, `together`, `going` — ближайший райд райдера, только если зритель у него в «своих»), `PUT /v1/riders/:publicId/social/connection {connected}` («В свои» с лимитом 30/24 ч / тихое «Убрать»; себе — `409 self`, непубличный — `404`), `GET /v1/social/connections` (только публичные, `count` = строки). Публичный `GET riders/:publicId` не меняется. DELETE не вводился (нет в CORS).
- **`rides`:** `RIDES_FOR_SOCIAL.nextRideCard`; сборка карточки — общая `rideCardOf` (её же использует лента).
- **LOW из ревью P0:** конфликт пары `rider_connections` повторяет `withTransaction` (WriteConflict, не E11000) — мёртвый повтор по `isDuplicateKey` в `addManual` убран; тесты воротами в обоих путях, отрицательное доказательство — одна попытка без повтора краснеет.
- **Приложение:** блок «Свои» на `/riders/[id]` («Вместе ехали N раз · последний — дата», «Идёт: <райд>» с «Я иду», «В свои» / «В своих»; гость — вход с возвратом), строка «Свои · N» в `/profile` → экран `/social` (убранная строка остаётся с «В свои» до ухода), подсказка K3 «Добавьте имя — свои увидят вас» в `/profile` (вместо прежней) и на Главной в слоте будущей секции «Свои» с «Не сейчас» на 14 дней (`pokatim.nameHint`).
- **Документы:** `profile.md`, `home.md`, `social.md`, ADR-0027 п. 3, правила `pokatim-backend/contracts/app.md`.
- Миграций нет. Контракты — только добавления (`rider-social.schema.ts`).

### Совместимость с параллельными PR
- P2: ключи `social.nameHint.{title,action,later}` общие — кто сливается вторым, убирает дубль; `RIDES_FOR_SOCIAL` и `SocialModule.controllers` — конфликты добавлений, оставить оба. P2 уже в develop: ключи P2 оставлены, «Я иду» из строки «Идёт» передаёт `source: 'profile'`.

### Проверки
- `TURBO_CONCURRENCY=4 pnpm check` (изолированные Mongo `pokatim_social_p3_test` и Redis db 10) — см. комментарий PR.
- Независимое ревью (Claude independent-reviewer): pass 1 APPROVE (MEDIUM — сброс «убранных» на экране «Свои» при новом ответе — исправлен с тестом и отрицательным доказательством), pass 2 APPROVE.
- NOT VERIFIED: e2e-смоук `/social` в браузере, ручная проверка на симуляторе.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
