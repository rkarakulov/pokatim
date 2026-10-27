# Findings — routes-06-ugc — pass 1 — reviewer: claude
base: origin/develop   commits: origin/develop..82e6a84 (working tree clean)
verdict: REQUEST CHANGES

Проверено независимо: `vitest run` api `src/modules/routes`, `src/modules/account`, `src/modules/profile`,
`src/db/migrations`, `src/admin-routes.test.ts` на изолированной БД (`127.0.0.1:27117/pokatim_rev06_test`, Redis
`/14`) — 20 файлов, 250 тестов, зелёные; `tsc --noEmit` app, admin, api — без ошибок. Полный `pnpm check`, тесты
app/admin, ручная проверка на iOS/Android/web — NOT VERIFIED (не запускались в этом проходе).

Изоляция приватности (основной риск) — без замечаний: `IN_CATALOG` — единственное условие списка, городов, карточки,
карты, GPX и `me`/жалобы; `findPublished` (порт `inCatalog`, «Гонки на маршруте»), `findReady`, `routesByIds`,
`listVisible`, `route-catalog.ts` и LRU-кэши остались только `platform`; карта маршрута райдера — `displayGeometryOf`
без кэша. Права (`PanelGuard` + `routes.moderate` на классе, 404 для чужого и для команды в «Моих», RC-10 для
`withdrawn`), ПДн (имени нет в панели, журнале, OG и логах; `noindex` для райдера), миграция (expand-only, идемпотентна,
в конце списка), каскад удаления (маршрут + жалобы в одной транзакции; стирание аккаунта через тот же `RouteDeletion`),
порядок транзакций модерации и жалобы (сначала запись `routes`) — соответствуют §5/§11.

### [HIGH] Ошибка перечитывания карточки заявки в панели скрыта, баннер конфликта снимается безусловно
- **file:** apps/admin/src/features/rider-routes/RiderRouteScreen.tsx
- **location:** 185–199 (ветка ошибок только при `!route.data`), 229–232 (`reload`)
- **problem:** `reload` делает `await route.refetch()` и сразу `setStale(false)`. `refetch` не бросает: при 404/5xx
  TanStack Query оставляет прежние `data`, ветка ошибок не срабатывает, а баннер конфликта убирается.
- **why_it_matters:** Сценарий RC-10: автор отозвал заявку, модератор жмёт «Одобрить», получает 404 и баннер,
  жмёт «Обновить», снова 404, но видит старую линию и кнопки «Одобрить/Отклонить». Повторное нажатие даёт тот же
  баннер, и так по кругу. Модератор не узнаёт, что заявки больше нет. При сетевой ошибке обновления ошибки на экране
  тоже нет. Это нарушение AGENTS.md §4.12 (ошибка обновления — баннер с повтором, данные не прячутся), по контракту
  ревью — HIGH.
- **evidence:** тест `RiderRouteScreen.test.tsx:251–265` для случая «404 (автор отозвал заявку)» мокает успешный
  `getRiderRoute` при перечитывании, то есть реалистичный 404 при обновлении не проверяется. То же нашёл Codex
  (findings-codex.md, HIGH №2), подтверждаю.
- **recommended_fix:** смотреть на результат `refetch()`: 404 — экран «Заявка не найдена» без действий (или
  `removeQueries` + рендер ветки ошибки); 403 — `NoAccessScreen`; прочая ошибка — баннер ошибки с «Повторить» поверх
  сохранённых данных, `stale` не снимать. Тест: заполненный кеш, затем 404 и 500 при «Обновить».

### [MEDIUM] «Отклонить жалобы» может закрыть жалобу, которую модератор не видел (`$max lastReportAt`)
- **file:** apps/api/src/modules/routes/routes.repository.ts; apps/api/src/modules/routes/route-reports.service.ts
- **location:** `recordRouteReport` (`$max: { 'publication.lastReportAt': now }`), `clearRouteReports`; `report()` —
  `now` берётся до транзакции
- **problem:** маркер конфликта dismiss — пара `version` + `lastReportAt`. Жалоба `version` не меняет, а
  `lastReportAt` пишется через `$max`. Поэтому новая жалоба с `now` ≤ уже записанного (задержанный запрос, другой
  процесс API с другим временем, та же миллисекунда) маркер не меняет.
- **why_it_matters:** нарушается N7 «Отклонить жалобы после новой жалобы — конфликт»: такая жалоба закрывается
  `closeOpen` как `dismissed`, хотя модератор её не видел. Это вопрос качества модерации, не утечки, поэтому MEDIUM.
  Codex оценил как HIGH; оценку по сути подтверждаю, по серьёзности не согласен.
- **evidence:** A берёт `now=t1` и ждёт; B (`t2>t1`) коммитит; модератор видит `lastReportAt=t2, openReportCount=1`;
  A коммитит (`$max` оставляет t2, count=2); dismiss с `version, lastReportAt=t2` проходит фильтр и закрывает обе.
- **recommended_fix:** самое простое — добавить в тело dismiss увиденный `openReportCount` (он уже есть в карточке) и
  проверять его в фильтре `clearRouteReports` (`'publication.openReportCount': seen`), либо монотонный счётчик жалоб
  `$inc`. Нужен тест с одинаковым/меньшим временем второй жалобы.

### [MEDIUM] Переименование скрытого маршрута не меняет `publication.version`: «Вернуть» публикует название, которого модератор не видел
- **file:** apps/api/src/modules/routes/routes.repository.ts; apps/api/src/modules/routes/routes-moderation.service.ts
- **location:** `renameOwn` (305–317, `$set: { title, updatedAt }` без `$inc publication.version`); `restorePublication`
  (522+), `write` → `case 'restore'` (230)
- **problem:** A1 разрешает автору переименовать маршрут в `hidden`. Защита действий модератора — `publication.version`,
  но rename его не увеличивает. Restore проверяет только версию и возвращает маршрут в каталог с текущим `title`.
- **why_it_matters:** маршрут скрыт, например, по жалобе `offensive_title`. Модератор открыл карточку, автор
  переименовал маршрут в другое недопустимое название, модератор жмёт «Вернуть» по увиденной версии. В публичный
  каталог уходит текст, который никто не проверял. Это обход премодерации (U1) для главного UGC-поля.
- **evidence:** `renameOwn` фильтр `'publication.status': { $nin: ['pending', 'approved'] }`, `hidden` разрешён;
  `moderate()` сверяет только `publication.version`.
- **recommended_fix:** при rename маршрута с `publication.status = 'hidden'` (и вообще с непустой публикацией) делать
  `$inc: { 'publication.version': 1 }` в том же `findOneAndUpdate`. Restore по старой версии тогда получит 409
  → «Заявку уже изменили». Нужен int-тест: rename в `hidden`, затем restore по старой версии даёт 409.

### [MEDIUM] Проигравшие параллельные подачи списывают суточную квоту
- **file:** apps/api/src/modules/routes/my-route-publication.service.ts
- **location:** 49–73 (`rateLimiter.consume` до `submitPublication`; `null` → 409 без компенсации)
- **problem:** RC-8 требует, чтобы суточная квота 10 считала только успешные подачи, а отказ 409 её не тратил. При
  параллельных подачах (двойной тап, два устройства) все запросы проходят проверки и списывают квоту, а успешен
  только один.
- **why_it_matters:** райдер может потерять квоту без заявок; отклонение от RC-8. Влияние ограничено — MEDIUM
  (то же у Codex, подтверждаю).
- **evidence:** код строк 55–73; тест N5 выполняет подачи последовательно.
- **recommended_fix:** вернуть единицу при `submitted === null` (если `RateLimiter` это поддерживает) или явно
  зафиксировать в §8.2 как принятую гонку рядом с RC-7.

### [LOW] После 3 подач и отзыва блок «Публикация» молча исчезает
- **file:** apps/app/src/features/routes/my-route-publication.tsx
- **location:** 88 (`if (!status && !route.canPublish) return null;`)
- **problem:** у `withdrawn` наружу `publication: null`. Если `submissionCount = 3`, то `canPublish: false` и блок не
  рендерится. Текст `routes.publication.noSubmissionsLeft` показывается только у `rejected`.
- **why_it_matters:** автор, который снял маршрут после третьей подачи, не понимает, куда пропала «Опубликовать».
- **recommended_fix:** показывать пояснение и для готового маршрута без активной заявки при `canPublish: false`.
  Сервер может отдавать причину, например `publishBlockedReason`, или считать «подачи исчерпаны» при `ready` и
  `publication === null && !canPublish`.

### [LOW] Правило безопасности всё ещё называет `findPublished` единственной точкой публичной видимости
- **file:** .claude/rules/pokatim-security.md
- **location:** 179 (routes-01: «видимость — одна точка `RoutesRepository.findPublished`»), 183 (GPX — `findPublished`)
- **problem:** после routes-06 публичные карточка, карта и GPX идут через `findInCatalog`/`IN_CATALOG`, а
  `findPublished` остался только для порта гонок. Новый раздел «Маршруты райдера в каталоге» написан верно, но старые
  строки противоречат ему.
- **why_it_matters:** Documentation Sync: следующий слайс может переключить карточку обратно на `findPublished` или
  наоборот расширить его.
- **recommended_fix:** в строках 179 и 183 заменить на `findInCatalog` (`IN_CATALOG`) и уточнить, что `findPublished`
  — только порт `RouteCatalog.inCatalog`.

## Итог pass 1 (claude)
REQUEST CHANGES — 1 HIGH: перечитывание карточки заявки в панели (§4.12, RC-10). MEDIUM: маркер конфликта dismiss,
rename в `hidden` без смены версии, квота при параллельных подачах. CRITICAL нет.
