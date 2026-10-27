# upload-limits-kml-panel — лимит одновременных загрузок на пользователя, таймаут тела; KML в панели

Уровень: task2. Ветка `fix/upload-limits-kml-panel` от `origin/develop` (после routes-02, PR #55). Follow-up'ы
routes-02: §8.2 «Follow-up (ревью pass 1, Claude LOW 5)» и RC-10 в
`docs/tasks/2026-10-27-routes-02-my-routes/task.md`. Решение пользователя 2026-10-27: сделать оба.

## 1. Goal

1. Один аккаунт медленной отправкой не должен занимать все слоты приёма файлов процесса API: сейчас
   `TrackUploadsService.admit` и `MyRoutesService.admit` держат счётчик `inFlight` на процесс (4) без предела на
   пользователя, а `readLimited` (`apps/api/src/raw-body.ts`) ждёт тело без таймаута.
2. Панель («Маршруты» и поле коридора гонки) загружает маршрут только `.gpx`, хотя API панели уже принимает KML
   (общий `RoutesService.accept`, `detectRouteFormat`).

## 2. Scope

- **api, слоты приёма:** общий класс в `apps/api/src/` (например `upload-slots.ts`) — предел на процесс + не больше 1
  одновременного приёма на `userId`; `acquire(userId)` → `release` (идемпотентный) или отказ; оба сервиса
  (`tracks`, `routes` «мои») используют его вместо своего `inFlight`; отказ — как сейчас `429 RATE_LIMITED`,
  `retryAfterSec: 5`. Политики: `maxConcurrentUploads` / `riderMaxConcurrentUploads` остаются пределом процесса,
  добавляется предел на пользователя (1). Загрузка панели (`RoutesService.admit`) — сотрудники, доверенные; слоты
  не нужны (не менять).
- **api, таймаут тела:** `readLimited` получает таймауты: тишина между порциями тела дольше `idleMs` (`[ASSUMPTION]`
  30 с) или всё тело дольше `totalMs` (`[ASSUMPTION]` 180 с; 5 МиБ на 0,5 Мбит/с ≈ 80 с) — отказ, поток
  уничтожается/сливается без хранения, ответ с `Connection: close` (контроллеры это уже делают для ошибок чтения).
  Код ответа — без нового кода контракта: `408` + `VALIDATION_FAILED` `{ fields: [{ path: 'body', code: 'INVALID' }] }`
  (`[ASSUMPTION]`, при сомнении — обоснуй иное в §8.2). Таймауты — параметр (тесты — fake timers), по умолчанию —
  из политик. Применяется ко всем трём загрузкам (заезды, «мои маршруты», панель).
- **admin:** `accept` из `ROUTE_FILE_EXTENSIONS` (`@pokatim/contracts`: `.gpx,.kml`) в `RoutesScreen` и
  `CorridorField`; тексты `admin.routes.upload`, `admin.races.corridor.upload`, `admin.races.corridor.hint`,
  `admin.routes.failure.unreadable`, `admin.routes.error.ROUTE_FORMAT_UNSUPPORTED` — без «только GPX» (например
  «Загрузить маршрут», «Маршрут GPX или KML…», «Не удалось прочитать файл», «Выберите файл GPX или KML»). Проверь, как
  панель отправляет файл (тип содержимого — сырое тело) — KML должен уходить так же.
- **docs:** `.claude/rules/pokatim-security.md`/`pokatim-backend.md` (лимиты приёма), `docs/product/routes.md` и
  `docs/product/admin-panel.md` (панель принимает KML), `docs/product/tracks-and-devices.md` при необходимости;
  отметить закрытые follow-up'ы в task.md routes-02 нельзя (история) — достаточно ссылки здесь.

## 3. Out of Scope

Распределённые (Redis) слоты между процессами; новые коды ошибок контракта; изменения приложения райдера (тексты 429
там уже есть — проверь, что `408` показывается как обычная ошибка загрузки, без падения).

## 4. Acceptance Criteria

1. Пока у пользователя A идёт приём (слот занят), вторая загрузка A — `429` до чтения тела; загрузка B — принимается;
   после завершения/ошибки/обрыва первой — слот A освобождается (в т. ч. при 413, 415, таймауте).
2. Предел процесса сохраняется (5-й одновременный разных пользователей — `429`).
3. Тело, не присылающее данных дольше `idleMs`, или длиннее `totalMs` — отказ `408`, слот освобождён, данные не
   сохранены.
4. Панель: «Маршруты» и коридор гонки принимают `.kml`; тексты без «только GPX».
5. Тесты: unit слотов и `readLimited` (fake timers, `PassThrough`); int на реальной БД — второй одновременный приём
   того же райдера `429`, другого — `202` (для заездов и «моих маршрутов»); admin — `accept` и загрузка `.kml`.
6. `pnpm check` зелёный.

## 5. Implementation Context

- `apps/api/src/raw-body.ts`, `apps/api/src/modules/tracks/{track-uploads.service,track-uploads.controller,tracks.policy}.ts`,
  `apps/api/src/modules/routes/{my-routes.service,routes-mine.controller,routes-admin.controller,routes.policy}.ts`.
- Тесты: `apps/api/src/modules/routes/routes-mine.int.test.ts`, тесты загрузок `tracks` (`*.int.test.ts`), хелперы
  `apps/api/test/{routes,identity,harness}.ts`.
- Admin: `apps/admin/src/features/routes/{RoutesScreen,route-upload}.tsx`, `apps/admin/src/features/races/CorridorField.tsx`,
  `apps/admin/src/ui/FileButton.tsx`, тесты рядом; i18n — `packages/i18n/src/ru.ts`.

## 8.3 Security checklist

1. **AuthN/AuthZ:** не меняется — заезды и «мои маршруты» под `AuthGuard`, слот берётся по `userId` из
   сессии сервера; панель — `PanelGuard` + `races.manage`; доступ к объектам — прежние фильтры владельца.
2. **Входные данные:** формат — по содержимому (`detectRouteFormat` / `detectTrackFormat`), не по `accept` панели
   (`.gpx,.kml` — только удобство выбора); размер — `readLimited` с обрывом на лимите; новое — таймауты тела
   (тишина 30 с, всё тело 180 с) → `408`, ничего не сохраняется.
3. **Данные наружу:** новых полей нет; `408` — конверт `ApiError` без деталей, кроме `fields: body`.
4. **Злоупотребления:** новое — 1 одновременный приём на пользователя + 4 на процесс (`UploadSlots`, до чтения тела),
   таймауты против медленной отправки; лимиты частоты Redis (пользователь, IP) — без изменений. Слоты — память
   процесса (Redis-слоты — out of scope, §3).
5. **Секреты и логи:** логи не меняются; в слотах — только `userId` в памяти процесса, без записи.
6. **Аудит:** не затронут — загрузка в панели по-прежнему пишет `route.created`; загрузки райдера журнал панели не
   пишут (как было).

## 8.2 Deviations from spec

- `[ASSUMPTION]` таймаутов подтверждены без изменений: `idleMs` 30 с, `totalMs` 180 с, ответ `408 VALIDATION_FAILED`
  `{ fields: [{ path: 'body', code: 'INVALID' }] }`. Дополнительное обоснование 180 с — заезды: 16 МиБ на 1 Мбит/с ≈
  135 с (в §2 расчёт только для 5 МиБ маршрута). Значения — `DEFAULT_BODY_TIMEOUTS` в `src/raw-body.ts`, политики
  модулей ссылаются на них (`TRACKS_POLICY.bodyTimeouts`, `ROUTE_POLICY.bodyTimeouts`); параметр `readLimited`
  обязательный (все три контроллера передают политику).
- При отказе (413 и таймаут) поток **сливается** (`resume`), не уничтожается: уничтожение `IncomingMessage` рвёт сокет,
  клиент не получил бы `408`/`413`. На время слива вешается пустой обработчик `error` — обрыв клиента во время слива не
  становится необработанной ошибкой потока.
- Предел на пользователя — отдельное поле политики (`maxConcurrentUploadsPerUser: 1`,
  `riderMaxConcurrentUploadsPerUser: 1`), а не константа класса.
- Int-тест таймаута на реальной БД (сверх AC5): временно ставит `bodyTimeouts.idleMs` = 200 мс (восстановление в
  `finally`) — проверка «слот освобождён, данные не сохранены, `Connection: close`» через HTTP-стенд.
- Приложение райдера не менялось: `408 VALIDATION_FAILED` — общий текст («Не удалось загрузить маршрут» в «Моих
  маршрутах», «Что-то пошло не так…» в загрузке заезда), без падения (`ApiHttpError` с `ApiError`).

## 12. Outcome

- **api:** `src/upload-slots.ts` (`UploadSlots`: предел процесса 4 + 1 на пользователя, идемпотентный `release`) —
  в `TrackUploadsService.admit` и `MyRoutesService.admit` вместо `inFlight`; `RoutesService.admit` (панель) не менялся.
  `readLimited` — таймауты `idleMs` 30 с / `totalMs` 180 с → `408 VALIDATION_FAILED` (`body`/`INVALID`), слив остатка,
  `Connection: close` (контроллеры); все три загрузки передают `bodyTimeouts` политики.
- **admin:** `ROUTE_FILE_ACCEPT` (`.gpx,.kml` из `ROUTE_FILE_EXTENSIONS`) в `RoutesScreen` и `CorridorField`; тексты:
  «Загрузить маршрут», «Маршрут GPX или KML…», «Не удалось прочитать файл», «Выберите файл GPX или KML». Панель шлёт
  файл сырым телом `application/octet-stream` независимо от расширения (`api-client` `uploadRoute`) — KML уходит так же.
- **docs:** `pokatim-security.md` (раздел «Приём тела загрузок», слоты в routes-02, KML в панели, `paths` +
  `upload-slots.ts`), `pokatim-backend.md`, `docs/product/routes.md`, `admin-panel.md`, `races-and-seasons.md`.
  Закрывает follow-up'ы routes-02: §8.2 «Follow-up (ревью pass 1, Claude LOW 5)» и RC-10.
- **Тесты:** unit `upload-slots.test.ts` (4), `raw-body.test.ts` (5, fake timers + `PassThrough`); int
  `track-uploads.int.test.ts` и `routes-mine.int.test.ts` — второй одновременный приём того же пользователя `429`
  (`retryAfterSec: 5`), другого `202`, слот свободен после ответа, 413 и 415; предел процесса (5-й — `429`, заезды);
  `408` через HTTP-стенд без сохранения и со свободным слотом (хелпер `test/uploads.ts: heldUpload` — тело-поток,
  ожидание занятого слота по spy `tryAcquire`); admin — `accept` `.gpx,.kml` и загрузка `.kml` на «Маршрутах» и в
  поле коридора.
- **Отрицательное доказательство:** `maxConcurrentUploadsPerUser`/`riderMaxConcurrentUploadsPerUser` = 4 → оба int-теста
  «второй одновременный…» красные (2 failed); unit `readLimited` до реализации — 3 красных (таймауты не срабатывали).
- **Проверки:** `pnpm check` (изолированные `MONGO_URL_TEST`/`REDIS_URL_TEST`, `TURBO_CONCURRENCY=1`) — зелёный:
  api 102 файла / 1029 тестов, admin 26 / 240, `Tasks: 13 successful, 13 total`.
- **Не проверено:** реальная медленная отправка через сокет за прокси (nginx/ALB таймауты поверх наших) и поведение
  приложения райдера на `408` вживую (по коду — общий текст ошибки).
