# Треки и устройства: ручная загрузка FIT/GPX, Garmin и Wahoo через Open Wearables

Задача — `docs/tasks/2026-10-26-tracks-devices/task.md`, ADR-0011.

## Что
- **Ручная загрузка FIT/GPX** (`POST /v1/tracks/uploads`, сырой поток ≤ 16 МиБ, формат по содержимому) → разбор в
  worker (`worker_threads`, 160 МБ, 30 с) → активность, упрощённая линия (`2dsphere`), дубли под `lockUserActivities`.
- **Устройства** через self-hosted агрегатор Open Wearables: порт `WearablesAggregator`, адаптер OW, активация
  подключения по тикету под входом, pull каждые 15 мин и «Синхронизировать сейчас», Svix-вебхук (без секрета — 404).
  Выключены по умолчанию (`DEVICES_ENABLED=false`).
- **Приложение:** экран «Устройства» (иконка верхней панели), возврат авторизации `devices/return`, шаг онбординга
  «Подключите устройство».
- `packages/tracks`: разбор FIT (`@garmin/fitsdk`), GPX (`fast-xml-parser`, без DTD/сущностей), поток агрегатора;
  серверный вход `@pokatim/tracks/parse` в бандл приложения не попадает.

## Миграции
`0010_tracks`, `0011_devices` — expand-only, идемпотентны (`0009` — у параллельного блока app-03; при слиянии
поправить список и тест порядка миграций).

## Env (сервер)
`TRACK_STORAGE_MAX_BYTES`, `TRACK_STORAGE_MIN_FREE_BYTES`, `DEVICES_ENABLED=false`, `OW_API_URL`, `OW_API_KEY`,
`OW_WEBHOOK_SECRET`, `OW_SHARED_INSTANCE=true`, `OW_DOCKER_NETWORK` (шаблон дописывает пустые; значения — владелец).
Compose: том `trackfiles`, `DEPLOY_STAGE: dev`, `docker-compose.ow.yml` (сеть OW — если задан `OW_DOCKER_NETWORK`).

## Зависимости и лицензии
- `@garmin/fitsdk` 21.218.0 — FIT Protocol License (проприетарная: внутреннее использование, без передачи SDK
  третьим лицам) — **подтвердить владельцу (V5)**; только сервер.
- `fast-xml-parser` 5.11.2 — MIT (транзитивные — MIT).
- `expo-document-picker` ~58.0.4 — MIT.

## Проверки
`pnpm check` — EXIT 0 (`TURBO_CONCURRENCY=1`; параллельно — известный флейк admin «429» под нагрузкой);
`E2E_API=1 pnpm e2e:web` — 14 passed; `build:web`, `expo export -p android` — ok; миграции дважды — ok.
Отрицательные доказательства — `task.md` §12.

## NOT VERIFIED
`deploy-rehearsal` (нет Docker), живой OW (Garmin/Wahoo, вебхуки), симуляторы и ручной смоук — `task.md` §12.

## Действия владельца
Приложение B `task.md`: проверить живой каталог провайдеров OW (Wahoo в исходниках OW 0.9.0-140 нет), включить
`DEVICES_ENABLED=true`, тестеры — с аккаунтами, не подключёнными к соседнему сервису; V5, V6.
