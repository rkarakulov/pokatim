---
paths:
  - "**/*.test.ts"
  - "**/*.test.tsx"
  - "**/*.spec.ts"
  - "**/e2e/**"
---

# pokatim — тесты (дополняет `tests.md`)

- Обработка треков (`packages/tracks`, коридор, кластеры) — фикстуры реальных FIT/GPX/TCX в `__fixtures__/`,
  включая битые, пустые, без timestamp, вне коридора.
- Сверка с коридором — `packages/tracks/src/__fixtures__/corridor/*.gpx` + `corridor-expected.json`: эталоны по
  построению (генератор `scripts/generate-corridor-fixtures.ts`, пакет не вызывается), версия в эталоне =
  `CORRIDOR_ENGINE_VERSION`; длинный трек (200 000 точек) — в памяти теста, не коммитится. Сторож версии —
  `corridor-golden.json` (полный результат всех фикстур): изменился — поднять версию и перезаписать
  `UPDATE_CORRIDOR_GOLDEN=1`. Новые выходы движка, не меняющие вердикт (maps-02: интервалы схода
  `matchCorridorDetailed`), — отдельной функцией вне `CorridorMatch`: golden и AC16 (ключи результата) не меняются,
  тест `match` = `matchCorridor` на всех фикстурах.
- Упрощение линии (`simplifyTrack`) — golden `simplify-golden.json` (sha256 индексов сохранённых точек всех фикстур по
  профилям вызовов) + сверка с эталонным перебором в тесте; перезапись `UPDATE_SIMPLIFY_GOLDEN=1` — только с решением
  в task.md (меняются хранимые линии). Стоянка 200 000 точек — в памяти теста.
- Результаты гонок (race-results-03) — int на реальном MongoDB: заезд эталона сдвигается во времени в окно гонки
  стенда (`rideGpx` из `apps/api/test/results.ts`), маршрут — линия из `corridor-expected.json` в `route_geometries`;
  проверка — `AttemptCheckProcessor.check` напрямую, события — `resultsWorker(h)`. Отрицательные доказательства —
  `admitEntry` без записи, запрос без `lockEntry`, без `checkRevision`, без семафора потоков.
- Протокол (race-results-05) — отрицательное доказательство замка результатов: `lockResults` подменён чтением →
  исключение лучшей попытки, закоммиченное после чтения чек-листа публикации, даёт 200 вместо `409
  protocol_published` и попадает в снимок (`results-protocol.int.test.ts`).
- Споры (race-results-06) — отрицательные доказательства подачи (`disputes-locks.int.test.ts`, постоянные тесты):
  без `lockEntry` цели (подменён чтением) подача и отмена участия цели обе коммитятся — открытый спор против
  отменённой заявки; без `lockResults` подача и публикация обе коммитятся — открытый спор при опубликованном
  протоколе. С замками побеждает одна операция. Споры для тестов `results`/`races` — прямой вставкой
  (`test/disputes.ts: seedDispute`).
- Флаги датчиков (race-results-07) — `sensorFlags` unit на синтетических сегментах (границы порогов) + golden
  `sensor-flags-golden.json` по реальным трекам с пульсом из `__fixtures__` (окно — весь трек), версия в эталоне =
  `FLAGS_VERSION`, перезапись — `UPDATE_SENSOR_FLAGS_GOLDEN=1`; `corridor-golden.json` не меняется. Int-гонки
  results по умолчанию — схема `overall` (`corridorRace(h, …, { scheme })`: v1-правила мест); новые гонки — `scheme:
  null` (схему ставит первая заявка), анкета — `seedVerifiedProfile`. Отрицательные доказательства анкеты —
  `verified-profile-locks.int.test.ts` (`lockForEntry` подменён чтением; `PUT` без условия фиксации).
- Ряды споров (06b) — `buildSeries` unit на синтетических точках; int `dispute-series.int.test.ts`: заезд
  `rideGpx(…, { heartRate, power })`, процессор напрямую (`build`), поток разбора настоящий; отрицательные
  доказательства — постановка без ключа NX (вторая задача) и задача без сверки ревизии (кэш старой ревизии).
- Гео-запросы MongoDB (`2dsphere`) — только интеграционные тесты на реальной БД; геометрия `packages/tracks` —
  unit на фикстурах.
- Гонки identity (MongoDB, R9): **ворота** — `vi.spyOn(repository, 'lockUser…')` приостанавливает операцию между
  проверкой и блокировкой (`gate()` из `apps/api/test/identity.ts`), другая завершается целиком; **удерживаемая
  транзакция** — `holdTransaction` пишет документ и не коммитит, проверяемая операция ждёт (`untilBlocked`:
  повтор транзакции по spy или запись вне транзакции в `$currentOp`), затем коммит. Ожидание заканчивается и
  тогда, когда операция завершилась, — проверяется результат.
- Ключевая гарантия гонки — с **отрицательным доказательством**: убрать механизм (`lockUser`, условие фильтра,
  сверку хеша) → тест краснеет по результату, не по таймауту; результат — в task.md §12.
- Запрет загрузки фото (profile-moderation-followups, `profile-avatar-locks.int.test.ts`): `heldUpload` прошёл
  `admit` → третий сброс фото коммитится → тело дочитано → `409 avatar_blocked`, нового `profile_avatars` нет; ворота
  `vi.spyOn(profiles, 'findProfile')` — снимок замены без запрета → сброс → write conflict → повтор → 409.
  Отрицательное доказательство — без проверки `before.avatarBlockedUntil` в `write()` 200 и фото записано. Порядок
  уведомлений о сбросе — ворота на `ProfileRepository.resetAvatar` (`resetAt` A < B, `seq` A > B → в центре текст A);
  без `seq` в схлопывании тест красный. Часы стенда сдвинуты на дни — токены истекли, тест входит заново.
- e2e: веб — Playwright, приложение — Maestro (когда появятся).
- Часовой пояс тестов приложения — Europe/Minsk (`apps/app/jest.config.js`, AGENTS.md §4.7).
