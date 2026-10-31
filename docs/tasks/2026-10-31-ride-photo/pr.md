# Фото организатора кофе-райда — PR A: API, контракты, конвейер `media`, 4a с фото

Задача: `docs/tasks/2026-10-31-ride-photo/task.md` (task3). ADR: `docs/adr/0028-image-pipeline-and-ride-photos.md`.
PR B (приложение) и PR C (панель) — отдельно.

## Что сделано

- **`modules/media`** — общий конвейер изображений (модуль-лист, правило `media-leaf`): сигнатура, пределы пикселей,
  настройки sharp процесса, `processCover` (поворот по EXIF, вписать в 1600 px, короткая сторона результата ≥ 400),
  один гейт обработки `ImageProcessing` и общие слоты приёма `ImageUploadSlots` для аватара и фото райда, `replyJpeg`.
  Аватар переведён на ядро без изменения поведения (тесты профиля — только импорты и имена).
- **Фото райда (`rides`)**: коллекция `ride_photos` (миграция `0046_ride_photos`), `PUT /v1/rides/:id/photo`,
  `POST /v1/rides/:id/photo/delete`, `GET /v1/ride-photos/:id` (только текущее фото нескрытого райда,
  `public, max-age=86400, immutable`), `photo` во view райда (лента, `me`, публичная карточка; скрытый — `null`).
- **Модерация**: `POST /v1/admin/rides/:id/photo-reset` (`rides.moderate`, `{ photoId, reason }`, журнал
  `ride.photo_reset`), `ModerationRideDetail.photo`.
- **Стирание аккаунта**: шаг `rides` удаляет все фото организатора и ссылки на райдах (`photos=N` в логе шага).
- **4a с фото (`sharing`)**: `photoId` в фактах и в ключе только у `night`, `renderVersion` 4, байты — порт
  `invitePhoto`, композиция sharp (фото `cover` → скрим `photoScrim` → текст `onPhoto`) → PNG с палитрой (≤ 2 МБ).
- **Контракты и клиент**: `RidePhotoId`, `RidePhotoRef`, `RIDE_PHOTO_*`, `ImageInvalidDetails`, коды
  `IMAGE_FORMAT_UNSUPPORTED` / `IMAGE_TOO_LARGE` / `IMAGE_INVALID`, `ResetRidePhotoRequest`, аудит `ride.photo_reset`;
  api-client `uploadRidePhoto`, `ridePhotoUploadRequest`, `deleteRidePhoto`, `ridePhotoUrl`, admin `resetRidePhoto`,
  `ridePhotoUrl`.
- **Дизайн-токен** `photoScrim` (+ тест контраста `onPhoto` поверх белого фото ≥ 4.5:1).
- **Доки**: ADR-0028, дополнения ADR-0011/0015/0018/0019, `docs/product/rides.md`, `docs/product/admin-panel.md`,
  правила `pokatim-security.md`, `pokatim-db.md`, `pokatim-backend.md`.

## Деплой

- Миграция **`0046_ride_photos`** (expand-only, идемпотентна): коллекция `ride_photos`, индексы
  `ride_photos_ride_unique`, `ride_photos_organizer_idx`. Новых env нет.
- `STORY_CARD_POLICY.renderVersion` 3 → 4: карточки сторис перерисуются по запросу (кэш 24 ч).

## Риски

- Кэш браузеров держит снятое фото до 24 ч (принятый, ADR-0028).
- PNG 4a с фото: шумная фикстура ≈ 1,73 МБ при пределе 2 МБ — запас у реальных фото больше.
- Значения скрима — `[ASSUMPTION]` до сверки с прототипом в PR B.

## Проверки

См. task.md §12 (Outcome): полный `pnpm check` и таргетные int-тесты.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
