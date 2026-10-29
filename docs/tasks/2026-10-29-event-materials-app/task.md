# task.md — материалы события в приложении (event-tickets PR C, §7)

## 1. Title

UI материалов события в `apps/app`: карточка гонки, карточка старта календаря, экран билета.

## 2. Goal

Участник видит материалы организатора (ссылки, текст, PDF) там, где готовится к событию: в публичной карточке события и
на билете (в том числе офлайн). API и api-client готовы в PR C #121 (`getEventMaterials`, `eventFileUrl`,
`TicketView.materials`); этот PR — только приложение.

## 3. Scope

- Компонент `components/event-materials.tsx` (+ модель `features/tickets/materials-format.ts`): иконка по `type`,
  название, описание ≤ 2 строк, «PDF · 1,2 МБ» или домен ссылки; нажатие — ссылка `openExternalUrl`, PDF — `downloadFile`
  (`api.eventFileUrl`), текст — раскрытие описания.
- Запрос `features/tickets/materials-query.ts` (публичный список, `staleTime` 60 с) и блок `event-materials-block.tsx`
  с состояниями AGENTS.md §4.12.
- Карточки `features/races/race-detail.tsx`, `features/calendar/calendar-detail.tsx` — блок после описания, перезапрос
  pull-to-refresh.
- Билет `features/tickets/ticket-details.tsx` — слот материалов → `EventMaterials` по `view.materials` (без запроса).
- i18n `packages/i18n/src/ru.ts` (`tickets.materials.*`), иконки тем в `components/icon.tsx`.

### 3.0 Решения (по plan-C §7, `docs/product/tickets.md`, ADR-0023)

- D1. Ключ запроса — `['events', kind, id, 'materials']`, вне `['tickets']`: мутации регистрации/участия инвалидируют
  билеты, материалы от них не зависят.
- D2. 404 публичного списка (черновик гонки, снятый старт) — блока нет, без ошибки (RC-C9: как «пусто»).
- D3. Ссылка открывается только после `RegistrationUrl.safeParse` (как ссылка регистрации календаря); небезопасная — строка
  без действия и без домена.
- D4. PDF — `downloadFile` (web — `<a download>` в той же вкладке, native — системный браузер): сервер отдаёт
  `attachment` (RC-C3).
- D5. Офлайн-копия билета хранит `TicketView` целиком — материалы входят в неё без изменений хранилища (QR — по-прежнему
  только SecureStore).
- D6. Иконка темы — декоративная (скрыта от скринридера); подпись строки — «название. описание (полностью). PDF · размер / домен», подсказка —
  «Откроется в браузере» / «Скачать PDF» / «Показать полностью»/«Свернуть».

## 4. Out of Scope

Просмотр PDF внутри приложения, кэш PDF офлайн, материалы в «Ваших билетах» Главной, правки API/контрактов.

## 8.2 Deviations from spec

- task.md к началу работы в ветке отсутствовал — создан по plan-C §7 и брифу оркестратора.

## 9. Acceptance Criteria

1. Карточка гонки и старта: первая загрузка — скелетон под заголовком «Материалы»; пусто/404 — блока нет; ошибка без
   данных — «Нет соединения» / «Не удалось загрузить» по месту с «Повторить»; ошибка обновления — строки остаются, баннер
   с повтором.
2. Строка: иконка, название, описание, «PDF · размер» или домен; ссылка — `openExternalUrl`, PDF — `downloadFile` по
   `eventFileUrl`, текст — раскрытие; ошибка открытия — баннер.
3. Билет показывает `TicketView.materials` без запроса; старый сервер без поля — блока нет; офлайн-копия — с материалами.
4. a11y: роли `link`/`button`, подписи и подсказки, `expanded` у текста; строки — `@pokatim/i18n`; оформление — только
   токены и `@rkarakulov/ui`; без `Platform.OS`.
5. `pnpm check` зелёный.

## 11. Implementation Context

- Образцы: `features/calendar/calendar-registration.tsx` (блок с собственным запросом, `LoadFailure`),
  `features/tickets/ticket-row.tsx` (строка-ссылка), `lib/open-external-url(.web).ts`, `lib/download-file(.web).ts`.
- Тесты: `components/event-materials.test.tsx` (+ `.web.test.tsx`), `features/tickets/materials-format.test.ts`,
  `__tests__/race-detail.test.tsx`, `__tests__/calendar-detail.test.tsx`, `__tests__/ticket-screen.test.tsx`,
  `features/tickets/offline-store.test.ts`. В тестах карточек, где `@/lib/api` — автомок, по умолчанию
  `getEventMaterials → []`.

## 12. Outcome

Coder, 2026-10-29, ветка `feature/event-materials-app` (от `origin/develop`).

- Сделано по §3: компонент, модель, запрос и блок, карточки гонки и старта (+ pull-to-refresh), билет и офлайн-копия,
  иконки тем, i18n, правило `pokatim-app.md` («Билеты»), `docs/product/tickets.md` («Материалы»).
- Тесты: `event-materials.test.tsx` (7), `event-materials.web.test.tsx` (2), `materials-format.test.ts` (5),
  `race-detail` (+6: скелетон, пусто, 404, ошибка с повтором, сеть, ошибка обновления), `calendar-detail` (+3),
  `ticket-screen` (+3, включая офлайн-копию), `offline-store` (+1). В 10 тестах карточек — `getEventMaterials → []` по
  умолчанию.
- `pnpm check` (TURBO_CONCURRENCY=1, отдельные Mongo/Redis) — 15/15 задач, app: 248 suites / 2338 tests.
- NOT VERIFIED: ручная проверка на симуляторах iOS/Android и в браузере (скачивание PDF, открытие ссылки).
