# plan-B.md — PR B «Билеты в приложении» (`feature/event-tickets-app`)

Architect, 2026-10-29. Основа — `task.md` §3.0 (T1–T4), §5.7, §8.1, §9 AC12; контракты PR A —
`packages/contracts/src/tickets/ticket.schema.ts`, api-client (`getRaceTicket`, `getCalendarRegistration`,
`registerForCalendarStart`, `cancelCalendarRegistration`, `listTickets`, `getTicket`, `getEventTicketing`),
`docs/product/tickets.md`. Правила: `AGENTS.md` §4.11–4.13, `.claude/rules/{app,pokatim-app}.md`, скил
`app-dev-kit:mobile-expo`. Ветка — от свежего `origin/develop` после мержа PR A.

Status: **CONCERNS** (блокеров нет; RC-B1…RC-B8 — рекомендации по умолчанию, coder принимает их, если человек не
решит иначе; отклонения от §5.7 — в `task.md` §8.2 при реализации).

## 0. Достаточность API PR A

Проверено по `ticket.schema.ts` и `packages/api-client/src/index.ts`: **изменений API в PR B не требуется.**

| Нужно экрану | Источник |
|---|---|
| билет целиком (событие, kind, даты, место, адрес, город, участник, категория, код, `qr`, статус, `past`, инструкции, `checkedInAt`) | `GET /v1/tickets/:code` → `TicketView` |
| «Открыть билет» в «Ваше участие» | `GET /v1/races/:id/ticket` → `MyTicketRef \| null` (ленивый выпуск) |
| регистрация на старт: включена, места, `seatsLeft`, `registrationOpen`, дистанции | `GET /v1/events/calendar/:id/ticketing` → `EventTicketingPublic` |
| своя регистрация + билет, регистрация, отмена | `GET\|POST /v1/calendar/:id/registration`, `POST …/cancel` → `CalendarRegistrationState` |
| «Ваши билеты» на Главной | `GET /v1/tickets` → `MyTickets.upcoming` |
| материалы (PR C), Wallet (PR E) | в `TicketView` полей нет — слоты рендерят `null`; PR C/E добавят опциональные поля и наполнят слоты |

Ошибки: `EVENT_FULL`, `EVENT_REGISTRATION_CLOSED{reason}`, `VALIDATION_FAILED` (дистанция), `RATE_LIMITED`,
`NOT_FOUND` — уже в `ErrorCode`. Тексты ошибок приложения — новые ключи i18n (§4).

Не используем: `getEventTicketing('race', id)` (очный старт на карточке гонки — не в §5.7; follow-up).

## 1. Requirements Consistency (PR B)

- **RC-B1 `Stack.Protected` vs «гостю — вход с возвратом» (T2).** Гард `Stack.Protected` редиректит гостя на
  `redirectTo` (`/welcome`/`/sign-in`) и теряет исходный URL — возврата на `/tickets/<код>` не будет. **R:** экран
  **вне** `Stack.Protected`, гард в самом экране по образцу `settings/account/delete.tsx`: сессия `unknown|unavailable`
  — `ShellSkeleton` (+ `useShellFailure`); гость — `rememberReturnPath('/tickets/<код>')` → `router.replace('/sign-in')`;
  вошёл — билет (онбординг не обязателен — свой билет из письма). Альтернативы: (б) оставить в `Stack.Protected` и
  ловить исходный URL в корневом layout до редиректа — хрупко, трогает общий гард; (в) без возврата — нарушает T2.
- **RC-B2 «Поделиться: код и ссылка» (§5.7).** Код — запасной ключ check-in (сотрудник вводит его вручную, §5.3):
  поделиться кодом = передать билет (вне scope §4) и открыть подмену при входе. **R:** «Поделиться» — только ссылка на
  событие (`/races/<id>` или `/calendar/<id>`) и текст «Я участвую: {событие}, {дата}», **без кода и QR**. Альтернативы:
  (б) код в тексте + предупреждение; (в) убрать «Поделиться». Это меняет §5.7 — отметить в §8.2.
- **RC-B3 «Место/маршрут» без координат.** В `TicketView` нет координат; карта маршрута гонки уже есть на карточке
  гонки. **R:** «Как добраться» — внешние карты поиском по тексту `address ?? place` + `city` (https-ссылка
  `https://yandex.by/maps/?text=<encodeURIComponent>` через `openExternalUrl`, синхронно в обработчике; строки нет, если
  нет ни адреса, ни места); маршрут гонки — через «О событии». Альтернативы: (б) платформенные схемы `geo:`/`maps:`
  файлами `maps-link(.web).ts`; (в) координаты места в API (PR A уже смержен — новая миграция, вне scope).
- **RC-B4 Офлайн на web.** SW кеширует только статику, HTML и API — мимо (`app.md`): холодный офлайн-старт PWA на
  `/tickets/<код>` не загрузит страницу вообще. **R:** web-копия (localStorage) работает в открытой вкладке/PWA при
  потере сети и при сбое API; холодный офлайн-старт PWA — ограничение v1 (follow-up: navigation fallback SW для
  `/tickets/*`, отдельная задача с security-ревью SW). Показ копии — только при `signedIn` и совпадении владельца
  (`sessionOwner`); при `unavailable` web копию не показывает (владелец неизвестен). Native — сессия восстанавливается
  из SecureStore офлайн (ADR-0005), копия работает и при холодном старте. AC12 трактовать так — записать в §8.2.
- **RC-B5 Цвет QR и темы.** Тёмные темы дали бы светлый QR на тёмном (инверсный — читается не всеми сканерами);
  hex запрещены. **R:** новая роль бренда в `@pokatim/design-tokens` — `ticket.qrInk`/`ticket.qrPaper` (во всех
  `appThemes`; «бумага» — светлая во всех темах) + тест контраста (`contrast.ts`, ≥ 7:1) и пример на `/ui-kit`.
  Альтернатива: `surface.base`/`text.primary` + `inversionAttempts` в сканере панели — ломается на сторонних сканерах.
- **RC-B6 Блок «Ваши билеты» и §4.12.** Блок есть только при предстоящих билетах; скелетон для всех вошедших дал бы
  «прыжок» у большинства (билетов нет). **R:** по прецеденту G5 (`LandingSection`): первая загрузка и ошибка без
  данных — блока нет (без скелетона и повтора); ошибка обновления при показанных данных — данные остаются. Отклонение
  от §4.12 — в §8.2.
- **RC-B7 Внешняя регистрация vs «Регистрация в Покатим».** У старта может быть и `registrationUrl`, и включённые
  билеты. **R:** при `enabled: true` — блок регистрации в «Покатим» вместо кнопки «Зарегистрироваться» на сайте
  организатора (одна регистрация — без двусмысленности); при `enabled: false`, ошибке или 404 запроса сводки — прежняя
  внешняя кнопка (деградация без баннера). Пока сводка грузится — скелетон на месте блока регистрации.
- **RC-B8 Сохранение копии.** Кеш только «последнего открытого» не поможет, если билет ни разу не открывали онлайн.
  **R:** копия пишется при каждом успешном `getTicket` + предзагрузка `getTicket` для ≤ 3 ближайших `upcoming` при
  успешном `listTickets` (Главная; лимит чтения 120/мин — запас). Альтернатива — только при открытии (как §5.7).

## 2. Маршрут и раскладка `/tickets/[code]`

- Файл `src/app/tickets/[code].tsx` (экран-обёртка, гард RC-B1) + `features/tickets/ticket-screen.tsx`. В
  `_layout.tsx` — `<Stack.Screen name="tickets/[code]" />` рядом с `settings/account/delete` (вне гардов, комментарий).
- `generateMetadata` → `{ title: «Билет — Покатим», robots: 'noindex' }` без кода/ПДн, без `og:url` и `loader` (§5.3
  «страница noindex»); `DocumentTitle` — тот же нейтральный заголовок.
- Параметр: `TicketCode.safeParse(code)`; невалидный — `NotFoundScreen`-подобное «Билет не найден» без запроса.
- Раскладка (`SafeAreaView` → `DetailHeader` → `OfflineBanner`/баннер копии → `ScrollView` + `RefreshControl`):
  1. `Kicker` типа («Гонка» / «Старт календаря»; `unknown` — без кикера), заголовок события (`titleLg`).
  2. `TicketStatusPill` (Активен / Отмечен {время} / Отменён / Событие отменено / Событие завершено (`past`)).
  3. Строки `DetailRow`: дата и время (Минск, с годом, `formatMinskDateTime`; конец — если есть), место, адрес,
     участник, группа (`tier` + `groupKey` — подписи `features/races/format.ts`) или дистанция (`formatDistances`).
  4. `TicketQr` (только `qr !== null`) на плашке `ticket.qrPaper`, под ним код крупно `formatTicketCode`
     (`accessibilityLabel` — код посимвольно); при `qr === null` — код + пояснение статуса («QR недоступен: …»).
  5. Инструкции организатора (`instructions`, многострочный текст).
  6. Действия: «Как добраться» (RC-B3), «О событии» (`/races/<id>` | `/calendar/<id>`), «Поделиться» (RC-B2,
     `shareLink`; нет origin на native — кнопки нет).
  7. Слоты `TicketMaterialsSlot` (PR C) и `TicketWalletSlot` (PR E): `null`, пока в ответе нет полей.
- Состояния: первая загрузка — `TicketSkeleton` (повторяет 1–6, заголовок `DetailHeader` сразу); 404 — `EmptyState`
  «Билет не найден» (чужой и несуществующий — одинаково; копия этого кода стирается); сеть без данных — офлайн-копия
  (если есть) с баннером «Офлайн-копия от {дата, время}», иначе «Нет соединения» + повтор; 5xx без данных — «Не
  удалось загрузить» + повтор (копию показываем и здесь, баннер тот же); ошибка обновления при данных — баннер с
  повтором (`AsyncContent`).
- Время на экране — после монтирования (`useMounted`) не нужно: экран не SSR-ит данные (только клиентский запрос).

## 3. Файлы

### Создать (`apps/app/src`)

| Файл | Содержание |
|---|---|
| `app/tickets/[code].tsx` | гард RC-B1, `generateMetadata` (noindex), рендер `TicketScreen` |
| `features/tickets/queries.ts` | ключи и хуки (§4) |
| `features/tickets/ticket-screen.tsx` | экран (§2), пропсы `{ code: string }` |
| `features/tickets/ticket-details.tsx` | `TicketDetails({ view: TicketView, offlineSavedAt?: number })` — чистое представление (общий для онлайн и копии) |
| `features/tickets/ticket-skeleton.tsx` | `TicketSkeleton()` |
| `features/tickets/ticket-status-pill.tsx` | `TicketStatusPill({ status, past, checkedInAt })` |
| `features/tickets/ticket-actions.tsx` | `TicketActions({ event: TicketEventSummary })` — «Как добраться», «О событии», «Поделиться» |
| `features/tickets/ticket-format.ts` (+ test) | `ticketKindLabel`, `ticketStatusLabel`, `ticketCategoryLabel`, `ticketDateLine`, `directionsQuery(event)`, `eventPath(event)`, `ticketShareInput(event)`, `isTicketVisibleOffline(view, now)` |
| `features/tickets/maps-link.ts` (+ test) | `directionsUrl(query)` → `https://yandex.by/maps/?text=…` (RC-B3) |
| `features/tickets/qr-matrix.ts` (+ test) | `qrMatrix(payload): { size: number; path: string }` — `qrcode` (`create(payload, { errorCorrectionLevel: 'M' })`, импорт ядра без canvas/png), `path` — `M x y h1v1h-1z` по тёмным модулям (детерминированно, без `useId`, quiet zone 4 модуля) |
| `features/tickets/ticket-qr.tsx` / `ticket-qr.web.tsx` (+ tests) | `TicketQr({ payload: string; size: number })`: native — `useSvgLib()` из `features/routes/use-svg-native.ts` (ленивый `react-native-svg`, правило `pokatim-app.md`) → `Svg viewBox` + `Path`; модуля нет — сообщение «Обновите приложение» + код; web — inline `<svg>` + `<path>`; `accessibilityRole="image"`, подпись «QR-код билета» |
| `features/tickets/offline-store.ts` / `offline-store.web.ts` (+ tests) | офлайн-модель (§5) |
| `features/tickets/use-offline-ticket.ts` | `useOfflineTicket(code)` → `{ view, savedAt } \| null` (чтение после монтирования, владелец — `sessionOwner`) |
| `features/tickets/home-tickets.tsx` (+ test) | `HomeTickets()` — блок «Ваши билеты» (до 3 ближайших `upcoming`, `TicketRow`, «Все билеты» нет — §4 Out of Scope) |
| `features/tickets/ticket-row.tsx` | `TicketRow({ ticket: MyTicketRef; onPress })` — событие, дата, статус |
| `features/tickets/open-ticket-button.tsx` | `OpenTicketButton({ ticket: MyTicketRef \| null })` — «Открыть билет» → `/tickets/<код>`; `null`/`cancelled` — ничего |
| `features/tickets/error-messages.ts` (+ test) | `ticketErrorMessage(error)`: `EVENT_FULL`, `EVENT_REGISTRATION_CLOSED` по `reason`, `VALIDATION_FAILED` (дистанция), `RATE_LIMITED`, сеть, прочее |
| `features/calendar/calendar-registration.tsx` (+ test) | `CalendarRegistration({ start: CalendarStartDetail })` — блок §6 |
| `features/calendar/distance-picker.tsx` | `DistancePicker({ distances: number[]; value: number \| null; onChange })` — `Chip`-радиогруппа |

### Изменить

- `app/_layout.tsx` — экран `tickets/[code]` вне гардов (RC-B1).
- `__tests__/app-routes.ts` — `'tickets/[code]'`.
- `app-routes-manifest.server.test.ts` — строка: `/tickets/ABCDE12345` → `/tickets/[code]`.
- `features/auth/return-path-allowlist.ts` (+ test) — `TICKET_PATH = /^\/tickets\/([^/?#]+)$/`, проходит только
  канонический код (`TicketCode.safeParse(x).success && data === x`), без `-`/строчных — без двусмысленности.
- `features/auth/secure-storage.ts` — `SecureKey` + `'pokatim.ticketQr'` (§5).
- `features/auth/use-sign-out.ts` и подписка `signedIn → signedOut` в `app/_layout.tsx` — `clearOfflineTickets()`
  (покрывает явный выход, отзыв сервером, refresh 401, удаление аккаунта).
- `features/races/queries.ts` — `raceTicketKey(id) = ['races','ticket',id]`, `useRaceTicket(id, enabled)`; в общем
  применении ответа участия (`applyEntry`/`onSuccess` мутаций «Участвовать», «Отменить участие», «Повысить») —
  `invalidateQueries(raceTicketKey(id))` и `['tickets']`.
- `features/races/participation/race-participation.tsx` — при `entry.status === 'active'`: `useRaceTicket` →
  `OpenTicketButton` под `EntryResult` (ошибка/загрузка — ничего: билет вторичен, не ломаем блок; 404 старого API —
  `null`).
- `features/calendar/calendar-detail.tsx` — `CalendarRegistration` вместо/рядом с `Registration` (RC-B7).
- `app/(tabs)/index.tsx` — `HomeTickets` вошедшему над разделами (после `InstallBanner`), pull-to-refresh
  перезапрашивает `['tickets','list']`.
- `packages/i18n/src/ru.ts` — ключи `tickets.*`, `calendar.registration.*` (§7).
- `packages/design-tokens` — роль `ticket.qrInk`/`qrPaper` (RC-B5) + тест контраста; `/ui-kit` — пример `TicketQr`.
- `apps/app/package.json` — `qrcode` (+ `@types/qrcode` dev); проверить: web-бандл не тянет `pngjs`/`canvas`, Metro
  резолвит ядро, SSR-сборка (`build:web`) проходит. Лицензия MIT.
- `e2e/web.spec.ts` — шаг: гость `/tickets/ABCDE12345` → «Вход» (без 500, `noindex` в HTML).
- `.claude/rules/pokatim-app.md` — раздел «Билеты» (§10).

## 4. TanStack Query

| Ключ | Запрос | Параметры |
|---|---|---|
| `['tickets','list']` | `listTickets` (`withAccessToken`) | `staleTime: DEFAULT_STALE_MS`, `enabled: signedIn`; `onSuccess`-эффект: предзагрузка RC-B8 |
| `['tickets','detail',code]` | `getTicket` | `DEFAULT_STALE_MS`, `retry` — по умолчанию клиента, 404 — без повторов; успех → `saveOfflineTicket` |
| `['races','ticket',raceId]` | `getRaceTicket` | только вошедшему с активной заявкой, клиент; 404 старого API → `null` |
| `['calendar','ticketing',id]` | `getEventTicketing('calendar', id)` | публичный, только клиент (без `loader`), `PUBLIC_STALE_MS` |
| `['calendar','registration',id]` | `getCalendarRegistration` | только `signedIn` и `enabled: true` сводки, `DEFAULT_STALE_MS` |

Мутации (`networkMode: 'always'` — офлайн даёт ошибку, а не вечную паузу):

- `useRegisterForCalendarStart(id)` / `useCancelCalendarRegistration(id)`: ответ → `setQueryData(['calendar',
  'registration',id])`; затем `invalidateQueries(['calendar','ticketing',id])` и `['tickets']`. `409 EVENT_FULL` /
  `EVENT_REGISTRATION_CLOSED` — текст + `invalidateQueries(['calendar','ticketing',id])`.
- Участие в гонке — см. §3 «Изменить» (`['races','ticket',id]`, `['tickets']`).
- Выход — `queryClient.clear()` (есть) + `clearOfflineTickets()`.

## 5. Офлайн-модель

- Что храним: `OfflineTicket = { view: TicketView; savedAt: number }` по коду; не больше 10 записей; запись удаляется,
  когда событие закончилось > 24 ч назад (`endsAt ?? startsAt + 12 ч`, часы устройства) или `getTicket` вернул 404.
  Валидация при чтении — `TicketView.safeParse` (повреждённое/старое — стереть).
- Native (`offline-store.ts`): секретная часть — `secureStorage` `pokatim.ticketQr` = `{ owner, qr: { [code]: payload } }`
  (≤ 10 × ~60 Б — в пределах 2 КБ SecureStore); остальное (`view` с `qr: null`, `savedAt`) — файл
  `Paths.document/tickets-offline.json` (`expo-file-system` `File`, уже в сборке) с `owner`. Сборка копии — склейка;
  `owner` файлов не совпал с `sessionOwner` — стереть оба. QR не лежит в незащищённом файле.
- Web (`offline-store.web.ts`): `localStorage['pokatim.ticketsOffline'] = { owner, items }` (одна запись, ≤ 10 билетов);
  доступ — только в эффектах/обработчиках (SSR-safe), сбой хранилища — тихо (сценарий без копии). Показ — только при
  `signedIn` и `owner === sessionOwner` (RC-B4).
- Стирание: подписка `signedIn → signedOut` корневого layout + `useSignOut` (в т.ч. офлайн-выход); вход другим
  пользователем — несовпадение владельца при чтении; удаление аккаунта — через тот же выход.
- Безопасность: QR-токен на устройстве владельца — допустимо (§5.7); он же на экране. Не пишем в логи, `console.*`,
  URL, подписи a11y. На web localStorage доступен XSS той же origin — та же поверхность, что и access в памяти;
  CSP проекта не меняется. Офлайн-копия показывает QR, только если `view.qr !== null` и событие не прошло по часам
  устройства; баннер «Офлайн-копия от {savedAt}. Статус мог измениться».

## 6. Регистрация на старт календаря (`calendar/[id]`)

- `CalendarRegistration({ start })`: сводка `['calendar','ticketing',id]`; грузится — скелетон блока; `enabled:false`,
  ошибка — прежний `Registration` (внешняя ссылка, RC-B7).
- `enabled: true`: строка места/адреса/мест («Осталось мест: N из M»; без лимита — без строки).
  - Гость: «Зарегистрироваться» → `rememberReturnPath('/calendar/<id>')` + «Вход» (путь уже в allowlist).
  - Вошедший, `registration === null`: `registrationOpen` и `seatsLeft !== 0` — `DistancePicker` (если дистанций > 1,
    обязателен; 1 — подставляется; 0 — без тела) + «Зарегистрироваться» (loading); `seatsLeft === 0` — «Мест нет»;
    `!registrationOpen` — «Регистрация закрыта».
  - Есть регистрация: «Вы зарегистрированы · {дистанция}», `OpenTicketButton`, «Отменить регистрацию» → инлайн-
    подтверждение (по образцу `withdraw-confirm.tsx`), только при `registrationOpen` (до старта).
- Клиент не вычисляет «полон/открыто» — только `seatsLeft`/`registrationOpen` сервера; 409 — текст + перезапрос.

## 7. i18n (`packages/i18n/src/ru.ts`, формальное «вы»)

`tickets.title`, `tickets.kind.{race,calendar}`, `tickets.status.{active,checkedIn,cancelled,eventCancelled,past,
unknown}`, `tickets.checkedInAt`, `tickets.code`, `tickets.qrLabel`, `tickets.qrUnavailable.{cancelled,eventCancelled,
past}`, `tickets.participant`, `tickets.group`, `tickets.distance`, `tickets.place`, `tickets.address`,
`tickets.instructions`, `tickets.action.{directions,event,share,open}`, `tickets.shareText`, `tickets.offline.banner`,
`tickets.notFound.{title,message}`, `tickets.updateApp`, `tickets.home.title`; `calendar.registration.{register,
signIn,registered,cancel,cancelConfirm,full,closed,seatsLeft,distance,distanceRequired}`,
`tickets.error.{full,closed.started,closed.unpublished,closed.cancelled,closed.notEnabled,rateLimited}`.

## 8. Тест-матрица (jest-expo + RTL; web — `*.web.test.ts(x)`)

| Что | Тест |
|---|---|
| allowlist | `return-path.test.ts`: `/tickets/<канон>` — да; `ABCDE-12345`, строчные, `//`, лишний сегмент — нет |
| манифест SSR | `app-routes-manifest.server.test.ts`: `/tickets/X` → `/tickets/[code]` |
| QR | `qr-matrix.test.ts`: детерминированный `path`, размер v4 (33 + 2×4) для `PKT1.`+43, тёмные модули совпадают с `qrcode`; `ticket-qr.test.tsx` (мок svg: «Обновите приложение» при `false`), `ticket-qr.web.test.tsx` (`<svg>` с `path`, a11y) |
| формат | `ticket-format.test.ts`: статусы/`past`/`unknown`, категория race/calendar/null, дата Минск (TZ ≠ Минск), `directionsQuery`, `eventPath`, share без кода (RC-B2) |
| экран | `ticket-screen.test.tsx`: скелетон → данные; `qr: null` — без QR + пояснение; 404 — «не найдено» и стирание копии; сеть без данных + копия → баннер «Офлайн-копия от …»; без копии — «Нет соединения» + повтор; 5xx — «Не удалось загрузить»; гость → `rememberReturnPath` + `/sign-in`; невалидный код — без запроса |
| офлайн | `offline-store.test.ts` (native, моки `expo-secure-store`/`expo-file-system`): QR только в SecureStore, файл без `qr`; чужой владелец — стирание; ≤ 10, TTL; `clear`. `offline-store.web.test.ts`: localStorage, SSR без `window`, сбой хранилища — без броска, владелец |
| выход | `use-sign-out.test.tsx` и тест корневого layout: `signedIn → signedOut` зовёт `clearOfflineTickets` |
| гонка | `race-participation` RTL: активная заявка + билет → «Открыть билет» ведёт на `/tickets/<код>`; `null`/`cancelled` — нет кнопки; мутации инвалидируют `['races','ticket',id]` и `['tickets']` |
| календарь | `calendar-registration.test.tsx`: `enabled:false`/ошибка — внешняя кнопка; гость → вход с возвратом; дистанция обязательна при > 1; `EVENT_FULL` → текст + перезапрос сводки; зарегистрирован → «Открыть билет», отмена с подтверждением; `registrationOpen:false` — «закрыта», без отмены |
| Главная | `home-tickets.test.tsx`: пусто/ошибка/загрузка — блока нет; 3 ближайших; нажатие → билет; предзагрузка ≤ 3 |
| ошибки | `error-messages.test.ts` по `reason` |
| токены | контраст `ticket.qrInk/qrPaper` во всех `appThemes` |
| e2e | `e2e/web.spec.ts`: гость `/tickets/<код>` → «Вход», HTML 200 с `noindex`, без ошибок страницы |

Ручная проверка iOS/Android/PWA (QR читается сканером, офлайн-копия при авиарежиме) — в `pr.md` (`NOT VERIFIED`, если
не делалась).

## 9. Риски

- `qrcode` в трёх бандлах (Metro native, web, SSR Node): импорт ядра, а не `lib/browser`/`lib/server`; проверить
  `build:web` и размер бандла. Запасной вариант — `qrcode-generator` (без зависимостей) — решение coder с записью в §8.2.
- `react-native-svg` в старых dev-клиентах — фолбэк «Обновите приложение» + код (код достаточен для ручного check-in).
- Яркость экрана при показе QR — вне scope (нужен `expo-brightness`, новая нативная зависимость).
- Лимит чтения 120/мин: предзагрузка ≤ 3 + focus-refetch — в пределах.
- Номер миграции не затрагивается (PR B без API).

## 10. Порядок работ

1. Токены QR (RC-B5) + i18n-ключи.
2. `qr-matrix` (TDD) → `TicketQr` (native/web) → пример `/ui-kit`.
3. `ticket-format`, `maps-link`, `error-messages` (TDD).
4. `offline-store(.web)` (TDD) + стирание при выходе.
5. `queries.ts`; экран `/tickets/[code]` (гард RC-B1, мета), `_layout`, `app-routes`, манифест, allowlist.
6. «Открыть билет» в «Ваше участие» + инвалидации участия.
7. `CalendarRegistration` на `calendar/[id]`.
8. `HomeTickets` на Главной + предзагрузка.
9. e2e-шаг, `pokatim-app.md` «Билеты», `docs/product/tickets.md` («В приложении»), §8.2 task.md (RC-B1…B8) →
   `pnpm check`, `build:web` + `start:web` смоук.

## 11. Documentation Impact

`.claude/rules/pokatim-app.md` — раздел «Билеты (event-tickets)»: экран вне гардов с собственным гардом, ключи,
офлайн-модель и стирание, QR-компонент (ленивый svg), роли `ticket.*`; `docs/product/tickets.md` — «В приложении»
(вход, офлайн-копия и её предел на web, «Поделиться» без кода); `task.md` §8.2 — отклонения RC-B1, B2, B4, B6, B7, B8.

## 12. Outcome (coder, 2026-10-29, ветка `feature/event-tickets-app`, не запушена)

Сделано (RC-B1…B8 приняты; отклонения — `task.md` §8.2 «PR B»). API PR A не менялся.

- Экран `/tickets/[code]` вне гардов с гардом в экране (гость → «Вход» и возврат, `unavailable` → офлайн-копия или
  ошибка с повтором), `noindex` без кода; QR — `qrcode` (ядро `lib/core/qrcode`) → `path`, native — ленивый
  `react-native-svg`, web — inline `<svg>`; роли `ticket.qrInk/qrPaper` + тест контраста ≥ 7:1.
- Офлайн-копии: native — QR в SecureStore `pokatim.ticketQr`, остальное — файл; web — `localStorage`; ≤ 10, TTL сутки
  после события, владелец; стирание — `useSignOut` и переход в `signedOut` корневого layout.
- «Открыть билет» в «Ваше участие» (инвалидации `['races','ticket',id]`, `['tickets']`), регистрация на старт календаря
  (дистанция, места, «Мест нет», «Закрыта», отмена с подтверждением, 409 → перезапрос сводки), «Ваши билеты» на Главной
  с предзагрузкой ≤ 3.
- Дополнение оркестратора (SW): навигации на `/tickets/*` — network-first, HTML-оболочка в кеш `tickets-shell-<версия>`
  под общим ключом, офлайн — из кеша; выход удаляет кеш. Безопасность проверена: SSR-разметка `/tickets/<код>` без кода
  и данных билета и одинакова для любых кодов (сборка `build:web`, `curl` двух кодов → `diff` пусто, вхождений кода 0).
- Пример `TicketQr` на `/ui-kit` не добавлен (витрина — `UiKit` базы без слота проекта) — §8.2.

Проверки:

- `TURBO_CONCURRENCY=1 pnpm check` (Mongo/Redis — отдельные БД) → format, lint, arch, typecheck — зелёные; тесты: все
  пакеты зелёные, кроме `@pokatim/api` `avatar-image.test.ts` (таймаут 5 с под нагрузкой, код PR B не трогает API);
  отдельный прогон файла — 13/13. Тесты app/admin, не дошедшие до запуска, — `turbo run test --filter=@pokatim/app
  --filter=@pokatim/admin` → app 227 suites / 2103 tests, admin 39 files — зелёные.
- `EXPO_PUBLIC_API_URL=http://127.0.0.1:3000 pnpm build:web` → exit 0, `sw.js: 104 файлов`; `qrcode` — только в
  чанке маршрута `[code]`, `pngjs`/canvas-рендерера в бандле нет; `node --check sw.js` — ок.
- `pnpm e2e:web` (без API, Chrome есть) → 21 passed, 8 skipped, 5 failed; новый шаг «билет без сессии» — passed.
  5 падений (`rides/report`, `rides/invite`, `rides/route-pick`, `routes/pick`, `routes/rides` без сессии: «Не удалось
  загрузить» вместо «Нет соединения») воспроизводятся на базовой ветке PR A без изменений PR B — не регрессия.

Не проверено (NOT VERIFIED): iOS и Android на устройстве/симуляторе (QR читается сканером, офлайн-копия в авиарежиме,
холодный старт native), PWA офлайн-старт в реальном браузере (поведение SW покрыто исполнением `sw.js` в jest), e2e с
API (`E2E_API=1`).
