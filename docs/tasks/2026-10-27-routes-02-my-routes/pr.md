# Маршруты 02: «Мои маршруты» — загрузка GPX/KML райдером, личная библиотека

## Что

Решения пользователя (M1–M4, `task.md` §2.1): переключатель «Каталог / Мои» во вкладке «Маршруты»; GPX и KML; маршрут
виден только автору; переименование и удаление насовсем.

- **tracks:** KML маршрута — `parseKml` (`LineString`, `MultiGeometry`, `gx:Track`, склейка в порядке документа,
  нулевые высоты My Maps — «высот нет»), `detectRouteFormat` (GPX/KML), `precheckRouteFile`; защиты XML вынесены из
  `gpx.ts` в `xml.ts` без смены поведения; фикстуры KML (генератор `scripts/generate-kml-fixtures.ts`).
- **contracts / api-client:** `ROUTE_ORIGINS`, `ROUTE_FILE_EXTENSIONS`, `my-route.schema.ts` (`MyRoute`, `MyRoutePage`,
  `MyRouteQuery`, `RenameRouteInput`, `MY_ROUTE_MAX_COUNT`), код `ROUTE_QUOTA_EXCEEDED` (409); методы «моих маршрутов».
- **API `routes`:** `/v1/routes/mine` — загрузка (лимиты 20/ч на райдера и 60/ч на IP до тела, семафор, квота 100),
  список, карточка, карта, `POST …/rename`, `POST …/delete` (транзакция трёх коллекций); всё под `AuthGuard`,
  `no-store`, чужой — 404. Приём и worker — общие (`RoutesService.accept` по владельцу и происхождению). **Изоляция:**
  панель, каталог, публичные ручки, коридор гонки и порты (`RouteCatalog`, `RouteGeometry`, кэш) видят только
  `origin: 'platform'` — отрицательные int-тесты на каждую точку. Удалённый во время обработки маршрут — worker
  `skipped`. API панели принимает и KML (UI панели — GPX, follow-up).
- **Приложение:** переключатель (`?view=mine`), лента «Мои» (статусы, опрос 3 с, пусто, ошибки, pull-to-refresh),
  загрузка (выбор файла, название, прогресс, «Отменить», тексты отказов), карточка `/routes/mine/<id>` под гардом
  (карта без коридора, цифры, «Переименовать», «Удалить» с подтверждением; без «Поделиться» и OG). Общий
  `RouteLineMap` (им же пользуется карта каталога), `MyRouteListCard`.
- **docs:** `docs/product/routes.md` («Мои маршруты»), правила `pokatim-{app,backend,contracts,db,security}.md`.

## Важно

- **Миграция `0021_routes_rider` (HG-1, подтверждено человеком 2026-10-27):** создаёт
  `routes_owner_origin_sha_unique { ownerUserId, origin, sha256 }` (unique) и `routes_owner_origin_idx { ownerUserId,
  origin, _id: -1 }`, **затем удаляет `routes_owner_sha_unique`**. Данные не меняются, идемпотентна.
- **Порядок деплоя: миграция → API.** Между миграцией и выкладкой старый код проверяет дубль `findByOwnerSha` до
  вставки; расходится только имя индекса в `isDuplicateKey` при одновременной двойной загрузке (500 вместо 200, окно в
  минуты).
- **Откат кода** после того, как у сотрудника появится пара `platform` + `rider` одного файла, — старый индекс
  `routes_owner_sha_unique` заново не создать (принято).
- Новый код ошибки `ROUTE_QUOTA_EXCEEDED` — в конце `ErrorCode`; текст API `ROUTE_FORMAT_UNSUPPORTED` — «Выберите файл
  GPX или KML».

## Проверки

- `TURBO_CONCURRENCY=1 pnpm check` (изолированные Mongo/Redis) — см. `task.md` §12.

## NOT VERIFIED

- e2e веба (`pnpm e2e:web` с `E2E_API=1`, шаг «Мои») — не запускался (нужны `build:web`, API, worker, Mailpit).
- Ручная проверка на симуляторах iOS/Android и в браузере, загрузка реальных экспортов My Maps / Google Earth / Komoot.
