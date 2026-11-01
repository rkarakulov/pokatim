# Фото райда, follow-up — PR A: OG с фото, отзыв картинок приглашения, уведомление о сбросе, фото для модерации

Задача: `docs/tasks/2026-11-01-ride-photo-followups/task.md` (task3). ADR: дополнения ADR-0028 (п. 7) и ADR-0018.
PR B (шапка карточки в приложении, фото скрытого райда в панели) — отдельно.

## Что сделано

- **OG райда с фото** — `photoId` в хэше OG, `OG_CARD_POLICY.renderVersion` 3 → 4, тот же макет поверх фото под
  скримом `photoScrimHero` (цвета `onPhoto`), PNG с палитрой ≤ `maxPhotoPngBytes` (600 КБ). Общая композиция с 4a —
  `sharing/photo-card.png.ts`.
- **Отзыв картинок приглашения** — привязка `story-card:ride:<token>` = `{ rideId, photoId }`, проверка на каждой
  отдаче `GET /v1/story-cards/:file` (`StoryCardImageService` → порт `inviteCardLive`): скрытый райд или снятое фото —
  404 JSON, PNG удаляется.
- **Уведомление `ride_photo_reset`** — «Удалить фото» в панели пишет outbox `rides.photo-reset` в транзакции сброса;
  организатор получает «Фото райда удалено» (группа «Райды», цель — карточка райда, без причины, без письма).
- **`GET /v1/admin/rides/:id/photo?photoId=`** — фото для карточки модерации у любого статуса (`rides.moderate`,
  `private, no-store`). api-client — `moderationRidePhotoUrl`.
- **Контракты** — `ride_photo_reset` в конце `NOTIFICATION_KINDS`, `ModerationRidePhotoQuery`. i18n — текст
  последствий «Удалить фото».
- **Доки** — ADR-0028/0018, `docs/product/{rides,notifications,admin-panel}.md`, правила `pokatim-{backend,security,
  contracts}.md`.

## Деплой

- Миграций и env нет. `OG_CARD_POLICY.renderVersion` 4 — полный проход `og.sync` (≤ 60 рендеров за прогон).
- Токены приглашений, выданные до выката, — без привязки, отдаются до 24 ч (переходное окно).
- Redis: + ключ привязки ≈ 100 Б на картинку приглашения; OG райдов с фото — до 600 КБ (в окне пререндера 14 сут.).

## Риски

- Не отзываются: кэш устройства, уже скачавшего PNG (до суток), сохранённые и отправленные файлы, публичный HTTP-кэш OG
  и кэши превью соцсетей (ADR-0028 «Принятые риски»).
- Шумное фото в OG влезает только палитрой 16 цветов (≈ 296 КБ): у «шумных» фото возможна постеризация.

## Проверки

- `TURBO_CONCURRENCY=4 pnpm check` (изолированные Mongo DB и Redis db) — 15/15 задач, api: 262 файла, 2993 теста.
- Отрицательные доказательства — `task.md` §12.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
