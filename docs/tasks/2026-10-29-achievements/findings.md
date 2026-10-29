# PR A — pass 1, claude

# Findings — 2026-10-29-achievements (PR A) — pass 1 — reviewer: claude
base: origin/develop   commits: 35ba69a..67e1e25 (working tree clean)
verdict: APPROVE

Проверено самостоятельно: unit `achievements.policy.test.ts` (19/19), int `achievements`, `rider-rides`,
`rider-route-rides`, `route-ride-routes` (5 файлов, 44/44) на своей БД `pokatim_reviewachv_test` (rs0:27117) и Redis
`:6379/7`; тесты контрактов и api-client — зелёные. `pnpm check` целиком не запускал (NOT VERIFIED, есть в Outcome
coder). `account-erasure.int.test.ts` и `migrations.int.test.ts` прочитаны, но не запускались.

Покрытые измерения: корректность сверки (A2–A4, план, порядок «выдачи → маркер»; при чтении `listOf` и `syncedAt`
параллельно дубль вставки защищает и от устаревшего `listOf`), гонки GET/GET и GET/seen, A3, утечки в публичном
эндпоинте (явный список полей, `findPublic` → один 404, без записи, только `race_*`, `factDate` без времени),
9 правил и границы, стирание (шаг после `route-rides`, повтор — нули), миграция 0035 (expand-only, идемпотентна,
номер совпадает с `origin/develop`), индексы (`rides_participant_idx` для `pastFactsOf`, префикс `userId` у
выдач), границы модулей (на `achievements` ссылаются только `app.module.ts`, `account` и миграция/тесты), лимиты,
контракты (старые клиенты не затронуты, `tolerantEnum` в ответах, строгий запрос), документы (раздел 10 — ADR-0020,
`profile.md`, `account.md`, 4 правила). Аудит, BullMQ, i18n, дизайн-система, платформы — к PR A не применимы.
CRITICAL/HIGH нет.

### [LOW] Устаревший параллельный GET может снять отзыв (а не только переписать объект)
- **file:** apps/api/src/modules/achievements/achievements.repository.ts
- **location:** 87–98 `restoreOrRefresh` (и 78–84 `revoke`)
- **problem:** `restore`/`refresh` пишут `{ userId, code }` с `$set: { revokedAt: null, … }` без условия на текущее
  состояние. Сценарий: GET A прочитал факты (подиум есть, объект сменился → план `refresh`); затем DQ; GET B
  прочитал факты без подиума и отозвал выдачу; GET A применяет `refresh` и снимает отзыв. Ответ A содержит выдачу;
  если `seenAt` был `null`, приложение покажет вспышку уже пропавшего достижения и отправит `seen` — после возврата
  факта оно больше не вспыхнет. Симметрично устаревший `revoke` прячет вернувшееся до следующего GET.
- **why_it_matters:** ADR-0020 и 7.2 принимают eventual consistency только для `object`/`factAt` и утверждают «`seen`
  не затрагивается»; снятие отзыва косвенно затрагивает `seen`. Окно узкое (два GET одного райдера вокруг смены
  факта), исправляется следующей сверкой — отсюда LOW.
- **evidence:** `updateOne({ userId, code }, { $set: { object, factAt, revokedAt: null, updatedAt } })`; план различает
  `restore` и `refresh` (`achievements.policy.ts:167-169`), репозиторий — нет (`achievements.service.ts:136-139`).
- **recommended_fix:** сузить фильтры по ожидаемому состоянию из плана: `refresh` — `{ userId, code, revokedAt: null }`
  (не снимает чужой отзыв), `restore` — `{ userId, code, revokedAt: { $ne: null } }`; либо явно записать в ADR-0020,
  что устаревший GET может временно снять отзыв.

### [LOW] Порт `RIDER_ROUTE_RIDES`: предел 2000 без сортировки — при усечении теряются произвольные заезды
- **file:** apps/api/src/modules/route-rides/route-rides.repository.ts
- **location:** 142–157 `passedOf`
- **problem:** `find({ userId, status: 'passed' }).limit(limit)` без `sort`. В `rides` для той же ситуации
  сознательно сделан порядок ↑ («при усечении теряются новые, а не первые»), здесь — естественный порядок.
- **why_it_matters:** у райдера > 2000 пройденных заездов `route_first`/`routes_5` могут указывать не на самый
  ранний заезд/5-й маршрут, и объект может «прыгать» между сверками (лишние `refresh`). Практически недостижимо в v1.
- **evidence:** порт сам пишет «Порядок не задан»; ср. `RidesRepository.pastFactsOf` — `.sort({ startsAt: 1, _id: 1 })`.
- **recommended_fix:** `.sort({ 'activity.startedAt': 1, _id: 1 })` (сортировка в памяти по строкам одного
  пользователя ограничена пределом), либо зафиксировать в комментарии порта, что при усечении объект не детерминирован.

Вердикт: **APPROVE** — CRITICAL/HIGH нет.

## PR A — pass 1, codex

Вердикт: APPROVE, находок нет (`tools/ai_review/codex_review.sh --base origin/develop`).

## PR A — исправления LOW (автор, 2026-10-29)

- LOW-1 — `restoreOrRefresh` получает `revoked`: `restore` — фильтр `revokedAt: { $ne: null }`, `refresh` —
  `revokedAt: null`; устаревший параллельный план не снимает свежий отзыв. Тест — «устаревший план параллельной
  сверки» в `achievements.int.test.ts`.
- LOW-2 — `RouteRidesRepository.passedOf` сортирует `activity.startedAt ↑, _id ↑` до предела.
- Прогон: `vitest run src/modules/achievements src/modules/route-rides` — 6 файлов, 72 теста, passed.
