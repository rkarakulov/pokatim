# Фото организатора кофе-райда — PR B: приложение

Задача: `docs/tasks/2026-10-31-ride-photo/task.md` (task3, P3, P4, AC7). ADR: `docs/adr/0028-image-pipeline-and-ride-photos.md`.
Стек: поверх PR A (#169, API фото райда). PR C (панель) — отдельно.

## Что сделано

- **Экран карточки-приглашения** (`rides/invite/[id]`): блок «Своё фото» под карточкой — только организатору будущего
  опубликованного райда (`viewer.role === 'organizer' && viewer.canManage` из `me`). «Добавить своё фото» / «Заменить
  фото» — выбор без обрезки и `PUT` байтами; «Удалить фото» — только при фото. Кнопки заняты на время выбора и запроса
  и выключают друг друга (квота `rides-manage` не тратится на no-op удаление — LOW из findings PR A). После успеха —
  кеш `me` и инвалидация `['rides']`: лента, Главная, деталь и статус карточек приглашения (`night` с фото — новый
  токен сервера).
- **Ошибки** (`ride-photo-errors.ts`): 415/413/422 `IMAGE_*` (`too_small` — «нужно хотя бы 400 пикселей»), 429 (занятая
  обработка — «подождите несколько секунд», часовой лимит — «Повторите через …»), 409 `RIDE_INVALID_STATE`, проверка до
  отправки, старый dev-клиент; удаление и сеть — тексты действий с райдом.
- **Общий выбор фото** `features/media/pick-image(.web).ts`: native — `expo-image-picker` (у фото райда без редактора,
  iOS отдаёт совместимое представление HEIC → JPEG, MIME вне JPEG/PNG/WebP — отказ до отправки), web —
  `expo-document-picker`. Аватар — тонкая обёртка `pick-avatar.ts` (поведение и тесты профиля прежние);
  `load-image-picker.ts` и `image-picker-support.ts` перенесены в `features/media`.
- **Герой ленты «Кофе-райды» и Главной**: `SectionHero` с необязательным `photo` — `expo-image` `cover` по центру,
  декоративное (без озвучивания, на web пустой `alt`), под `PhotoScrim` (токен `photoScrim`, цвет `overlay.scrim`,
  полосами `View` — одинаково на iOS, Android и web), текст и линия — `text.onPhoto`; без фото или при ошибке картинки —
  прежний типографский герой.
- **Строки** `rideInvite.photo.*` в `packages/i18n` (`[ASSUMPTION]` — копи по прототипу).
- **Доки**: `docs/product/rides.md` (фото в приложении), правила `pokatim-app.md`, task.md §8.2 (D8–D11) и §12.

## Деплой

Только приложение (OTA/сборка и web). Новых зависимостей и env нет. Нужен API из PR A.

## Риски

- Значения затемнения — `[ASSUMPTION]`: прототипов `key-rides.html`/`key-home.html` в репозитории нет, сверка — на
  глаз на dev.
- Ручная проверка на симуляторе/устройстве и в браузере с реальным фото — **NOT VERIFIED** (только jest native/web).

## Проверки

См. task.md §12 «PR B»: полный `pnpm check` на зафиксированном HEAD.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
