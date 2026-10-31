# Findings — route-exports-gzip — pass 1 — reviewer: claude
base: origin/develop   commits: origin/develop...HEAD (0dda874d)
verdict: APPROVE

Проверено чтением (int-тесты не запускались: стенд Mongo replica set не поднят — NOT VERIFIED исполнением;
в `apps/api/.turbo/turbo-test.log` есть зелёные прогоны новых describe, но это артефакт автора).

Покрытие измерений: correctness (сжатие до транзакции в processor и backfill, исключение gzip внутри существующего
`try` в `processRoute` / `catch` в `run`); call sites (`exportFilesOf` — 2 вызова, `RoutesRepository.exportFile` —
единственный читатель `route_exports`, других писателей нет; клиенты — браузерная ссылка web и системный браузер
native, распаковывают прозрачно, `@pokatim/contracts` не меняются); безопасность (распаковка своих данных с
`maxOutputLength` 8 МиБ под IP-лимитом 30/мин, лог без текста ошибки, заголовки файла только на 200); placement
(только `apps/api/src/modules/routes`, контроллер тонкий, решение в сервисе — RC-3); миграций/очередей/аудита нет;
`acceptsGzip` соответствует таблице (q по умолчанию 1, невалидный q → 0, явный gzip приоритетнее `*`);
Documentation Sync — `pokatim-db.md`, `pokatim-backend.md`, `pokatim-security.md`, RC-7 прежней задачи отмечены;
UI/i18n/дизайн-система/состояния данных — не затронуты. Блокеров нет.

### [MEDIUM] Откат образа (и окно старта) отдаёт сжатые байты как несжатый файл
- **file:** apps/api/src/modules/routes/routes.repository.ts
- **location:** `writeExport` (~стр. 962–970); deploy — `infra/deploy/deploy.sh:192`
- **problem:** Формат хранения меняется без expand-шага: читатель (API) и писатель (worker) выкатываются одним
  образом одновременно. Любой API без этой ветки (откат образа на предыдущий релиз, либо секунды `compose up`, когда
  worker уже новый, а api ещё старый) читает `route_exports.<format>` проекцией без `encoding` и отдаёт gzip-байты с
  `Content-Type: application/gpx+xml` без `Content-Encoding`.
- **why_it_matters:** Пользователь скачивает «битый» `.gpx/.kml/.tcx` (бинарный gzip под XML-расширением) для всех
  маршрутов, посчитанных новым worker'ом; после отката документы сами не восстановятся (пересчёт только при росте
  `ROUTE_DERIVED_VERSION`). Измерение «миграции (expand/contract)» и совместимость при откате.
- **evidence:** `encoding: 'gzip'` пишется безусловно (`routes.repository.ts`, `writeExport`); старый
  `exportFile` — `projection: { [format]: 1 }` → `new Uint8Array(file.buffer)` как есть; в task.md §8 риск отката
  не упомянут. Прода нет (dev), поэтому не HIGH.
- **recommended_fix:** Как минимум задокументировать в task.md §8 и `pokatim-db.md`: «откат API ниже
  route-exports-gzip несовместим с записанными gzip-документами — откатывать вместе с ростом
  `ROUTE_DERIVED_VERSION`/пересчётом или не откатывать». Строгий вариант (expand/contract) — сначала релиз с
  читателем, потом включение записи gzip (флаг/второй релиз); для текущей стадии достаточно документации.

### [LOW] Лог сбоя распаковки показывает `(Error)`, а не класс сбоя
- **file:** apps/api/src/modules/routes/routes-public.service.ts
- **location:** `exportFile`, блок `catch` (~стр. 171–175)
- **problem:** Ошибки zlib (`Z_DATA_ERROR`, `Z_BUF_ERROR`) — обычный `Error` с `name === 'Error'`, различие только в
  `code`; `ERR_BUFFER_TOO_LARGE` — `RangeError`. Комментарий «класс ошибки без текста (Z_DATA_ERROR,
  ERR_BUFFER_TOO_LARGE)» обещает коды, которых в логе не будет.
- **why_it_matters:** Диагностика повреждённого экспорта vs превышения предела неразличима в логе (для порчи данных
  всегда `(Error)`).
- **evidence:** `const kind = error instanceof Error ? error.name : typeof error;`
- **recommended_fix:** Логировать `(error as NodeJS.ErrnoException).code ?? error.name` — код без текста, тот же
  уровень раскрытия.

### [LOW] Название теста обещает проверку, которой нет
- **file:** apps/api/src/modules/routes/routes-public.int.test.ts
- **location:** `it('повреждённый gzip в БД → 500 JSON без Content-Disposition; с Accept-Encoding: gzip — байты как есть')`
- **problem:** Вторая половина названия («с Accept-Encoding: gzip — байты как есть») не проверяется: в теле только
  запрос без `Accept-Encoding`.
- **why_it_matters:** Тест вводит в заблуждение о покрытии (поведение «повреждённый gzip отдаётся клиенту с gzip как
  есть, 200» не зафиксировано).
- **recommended_fix:** Добавить запрос с `accept-encoding: gzip` и проверку 200 + `Content-Encoding: gzip` +
  `rawPayload` = `broken`, либо убрать хвост из названия.
