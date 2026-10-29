# PR A — pass 1, claude

# Findings — 2026-10-29-achievements (PR A) — pass 1 — reviewer: claude
base: origin/develop   commits: 35ba69a..67e1e25 (working tree clean)
verdict: APPROVE

Проверено самостоятельно: unit `achievements.policy.test.ts` (19/19), int `achievements`, `rider-rides`,
`rider-route-rides`, `route-ride-routes` (5 файлов, 44/44) на своей БД `pokatim_reviewachv_test` (rs0:27117) и Redis
`:6379/7`; тесты контрактов и api-client — зелёные. `pnpm check` целиком не запускал (NOT VERIFIED, есть в Outcome
coder). `account-erasure.int.test.ts` и `migrations.int.test.ts` прочитаны, но не запускались.

Покрытые измерения: корректность сверки (A2–A4, план, порядок «выдачи → маркер»; при чтении `listOf` и `syncedAt`
параллельно дубль вставки защищает и от устаревшего `listOf`), гонки GET/GET и GET/seen, A3, утечки в публичном
эндпоинте (явный список полей, `findPublic` → один 404, без записи, только `race_*`, `factDate` без времени),
9 правил и границы, стирание (шаг после `route-rides`, повтор — нули), миграция 0035 (expand-only, идемпотентна,
номер совпадает с `origin/develop`), индексы (`rides_participant_idx` для `pastFactsOf`, префикс `userId` у
выдач), границы модулей (на `achievements` ссылаются только `app.module.ts`, `account` и миграция/тесты), лимиты,
контракты (старые клиенты не затронуты, `tolerantEnum` в ответах, строгий запрос), документы (раздел 10 — ADR-0020,
`profile.md`, `account.md`, 4 правила). Аудит, BullMQ, i18n, дизайн-система, платформы — к PR A не применимы.
CRITICAL/HIGH нет.

### [LOW] Устаревший параллельный GET может снять отзыв (а не только переписать объект)
- **file:** apps/api/src/modules/achievements/achievements.repository.ts
- **location:** 87–98 `restoreOrRefresh` (и 78–84 `revoke`)
- **problem:** `restore`/`refresh` пишут `{ userId, code }` с `$set: { revokedAt: null, … }` без условия на текущее
  состояние. Сценарий: GET A прочитал факты (подиум есть, объект сменился → план `refresh`); затем DQ; GET B
  прочитал факты без подиума и отозвал выдачу; GET A применяет `refresh` и снимает отзыв. Ответ A содержит выдачу;
  если `seenAt` был `null`, приложение покажет вспышку уже пропавшего достижения и отправит `seen` — после возврата
  факта оно больше не вспыхнет. Симметрично устаревший `revoke` прячет вернувшееся до следующего GET.
- **why_it_matters:** ADR-0020 и 7.2 принимают eventual consistency только для `object`/`factAt` и утверждают «`seen`
  не затрагивается»; снятие отзыва косвенно затрагивает `seen`. Окно узкое (два GET одного райдера вокруг смены
  факта), исправляется следующей сверкой — отсюда LOW.
- **evidence:** `updateOne({ userId, code }, { $set: { object, factAt, revokedAt: null, updatedAt } })`; план различает
  `restore` и `refresh` (`achievements.policy.ts:167-169`), репозиторий — нет (`achievements.service.ts:136-139`).
- **recommended_fix:** сузить фильтры по ожидаемому состоянию из плана: `refresh` — `{ userId, code, revokedAt: null }`
  (не снимает чужой отзыв), `restore` — `{ userId, code, revokedAt: { $ne: null } }`; либо явно записать в ADR-0020,
  что устаревший GET может временно снять отзыв.

### [LOW] Порт `RIDER_ROUTE_RIDES`: предел 2000 без сортировки — при усечении теряются произвольные заезды
- **file:** apps/api/src/modules/route-rides/route-rides.repository.ts
- **location:** 142–157 `passedOf`
- **problem:** `find({ userId, status: 'passed' }).limit(limit)` без `sort`. В `rides` для той же ситуации
  сознательно сделан порядок ↑ («при усечении теряются новые, а не первые»), здесь — естественный порядок.
- **why_it_matters:** у райдера > 2000 пройденных заездов `route_first`/`routes_5` могут указывать не на самый
  ранний заезд/5-й маршрут, и объект может «прыгать» между сверками (лишние `refresh`). Практически недостижимо в v1.
- **evidence:** порт сам пишет «Порядок не задан»; ср. `RidesRepository.pastFactsOf` — `.sort({ startsAt: 1, _id: 1 })`.
- **recommended_fix:** `.sort({ 'activity.startedAt': 1, _id: 1 })` (сортировка в памяти по строкам одного
  пользователя ограничена пределом), либо зафиксировать в комментарии порта, что при усечении объект не детерминирован.

Вердикт: **APPROVE** — CRITICAL/HIGH нет.

## PR A — pass 1, codex

Вердикт: APPROVE, находок нет (`tools/ai_review/codex_review.sh --base origin/develop`).

## PR A — исправления LOW (автор, 2026-10-29)

- LOW-1 — `restoreOrRefresh` получает `revoked`: `restore` — фильтр `revokedAt: { $ne: null }`, `refresh` —
  `revokedAt: null`; устаревший параллельный план не снимает свежий отзыв. Тест — «устаревший план параллельной
  сверки» в `achievements.int.test.ts`.
- LOW-2 — `RouteRidesRepository.passedOf` сортирует `activity.startedAt ↑, _id ↑` до предела.
- Прогон: `vitest run src/modules/achievements src/modules/route-rides` — 6 файлов, 72 теста, passed.

## PR B — pass 1, claude

# Findings — 2026-10-29-achievements (PR B) — pass 1 — reviewer: claude
base: feature/achievements-api   commits: feature/achievements-api..f7b656cb (021ea0d2, f7b656cb), working tree clean
verdict: REQUEST CHANGES (HIGH-1)

Проверено: хост вспышки (seen, сбой seen, возврат на передний план, выход/смена аккаунта — `queryClient.clear()` в
`_layout.tsx:76-84` + `resetShown` при `ready=false`), порядок очереди, `fullScreenModal`, «Поделиться» →
`replace(storyPath)`, блоки `/profile` и `/riders/[id]` (пусто/ошибка/404/только клиент), SSR (хост выключен без
сессии, блок публичного профиля — тот же паттерн `fetchStatus`, что `useRiderRaces`), порядок маршрутов
(`app-routes-manifest.server.test.ts`), i18n, reduce motion. Прогон: `jest achievement-flash, achievements-blocks,
features/achievements, own-profile, rider-profile` — 5 suites, 72 tests passed. `pnpm check` целиком не перезапускал
(отчёт coder — в Outcome).

### [HIGH] HIGH-1 Размеры значка — px-литералы в фиче, а не токен
- **file:** apps/app/src/features/achievements/achievement-badge.tsx
- **location:** :14 `BADGE_SIZE = { grid: 72, hero: 152 }`; производные :17-20 (`RING_INSET`, `RING_WIDTH`, `DISC`, `ICON`)
- **problem:** размеры значка заданы числами по месту в фиче (отклонение B4 «follow-up в app-foundation»).
- **why_it_matters:** AGENTS.md §4.11 прямо запрещает «px-литералы оформления (размеры …)»; контракт ревью — нарушение
  §4.11 = HIGH. При этом в проекте есть принятый путь без релиза app-foundation: бренд-слой `@pokatim/design-tokens`
  (`packages/design-tokens/src/index.ts:76-82` — `layout.avatarProfile: 56` для rider-profile с тем же follow-up
  `size.avatarLg`). Выбор B4 расходится с прецедентом и правилом.
- **evidence:** `export const BADGE_SIZE = { grid: 72, hero: 152 } as const;` (feature-local; `grep` других
  `*_SIZE`-констант в `apps/app/src` — нет).
- **recommended_fix:** вынести в `@pokatim/design-tokens` (`layout.badgeGrid` / `layout.badgeHero` или отдельный
  `achievementBadge` с долями кольца/диска) с проверкой в `design-tokens.test.ts`, follow-up `size.badge*` оставить в
  8.2; либо явное решение человека, зафиксированное в task.md, что литерал допустим.

### [MEDIUM] MEDIUM-1 Закрытие вспышки «назад» посреди очереди сразу открывает её снова
- **file:** apps/app/src/features/achievements/achievement-flash-host.tsx
- **location:** :33-43 (`pending`, `quiet`, эффект `router.push(FLASH_PATH)`)
- **problem:** очередь [a, b, c]; показан `a` (`markShown(a)`, `seen a`). Пользователь жмёт системное «назад» (Android)
  или «назад» браузера на web. Для хоста `pending` всё время `true` (b, c не показаны и `seen:false`), а `quiet`
  меняется `true → false` при уходе с `/achievements/flash` → эффект срабатывает → `push` вспышки с [b, c]. То же после
  «Поделиться» на не последнем элементе: по выходе из сторис вспышка открывается заново с оставшимися.
- **why_it_matters:** B1 утверждает, что жест «назад» = закрытие, но фактически пользователь не может закрыть
  очередь, не пролистав все (до 9) элементов; на web «назад» превращается в ловушку истории (каждый `push` — новая
  запись). Не бесконечно (каждый показ попадает в `shown`), но выглядит как зацикливание и противоречит «Закрыть».
- **evidence:** `useEffect(() => { if (pending && !quiet) router.push(FLASH_PATH); }, [pending, quiet, router]);` —
  зависимость `quiet` перезапускает эффект при любом уходе с тихого адреса. Тестов на «назад» посреди очереди и на
  «Поделиться» с остатком нет (`__tests__/achievement-flash.test.tsx`).
- **recommended_fix:** при уходе со вспышки (unmount экрана / `close` / `back`) помечать всю снимок-очередь показанной
  в `flash-session` (или считать вспышку «отработанной» до следующего изменения `dataUpdatedAt`/возврата из фона),
  чтобы повторное открытие шло только на новый ответ сервера; решить явно, что делать с остатком после
  «Поделиться» (A5 допускает показ позже — тогда при следующем открытии/возврате, а не сразу). Добавить тесты:
  «назад» на 1 из 2 → вспышка не открывается сразу; «Поделиться» на 1 из 2 → выход из сторис.

### [LOW] LOW-1 Появление значка мигает: статичный кадр, затем исчезает и анимируется
- **file:** apps/app/src/features/achievements/achievement-card.tsx
- **location:** :24-41 (`BadgeEnter`)
- **problem:** `useReducedMotion()` (`@rkarakulov/ui/dist/theme/motion.js`) — `null` на первом рендере каждого
  монтирования; `BadgeEnter` при `null` рисует статичный значок, после ответа `false` переключается на
  `Animated.View` с `opacity: 0` и проигрывает появление. На каждом элементе очереди (`key={current.code}`) значок
  видим → пропадает → появляется — то самое «мерцание», от которого комментарий обещает уйти.
- **why_it_matters:** визуальный дефект на iOS/Android при включённом движении; тест «движение разрешено» его не
  ловит (проверяет только итоговый `achievement-badge-animated`).
- **recommended_fix:** пока `reduced === null` — держать значок невидимым (opacity 0 без анимации) или кешировать
  ответ системы на уровне модуля/контекста, чтобы второй и последующие элементы не начинали с `null`.

### [LOW] LOW-2 Публичный блок не отбрасывает не-гоночные коды на клиенте
- **file:** apps/app/src/features/riders/rider-screen.tsx / apps/app/src/features/achievements/achievements-block.tsx
- **location:** rider-screen.tsx:118 (`<AchievementsBlock testID="rider-achievements" query={achievements} />`), achievements-block.tsx:93-94
- **problem:** «только race_*» в публичном профиле держит только сервер; тип `PublicRiderAchievement.code` —
  `tolerantEnum` всех 9 кодов, клиент показывает всё известное.
- **why_it_matters:** защита в глубину для A7 (маршруты и райды — личные); регресс API отобразился бы молча.
- **recommended_fix:** в публичном блоке фильтровать `catalogEntry(code).shareable` (или отдельный флаг `public`) и
  тест с `route_first` в публичном ответе.

### [LOW] LOW-3 Скелетон экрана достижения не повторяет раскладку
- **file:** apps/app/src/features/achievements/achievement-screen.tsx
- **location:** :56-62, :97
- **problem:** успешное состояние — крупный круг значка (152) по центру и центрированный текст; скелетон — две
  текстовые строки слева с `minHeight`.
- **why_it_matters:** §4.12 «скелетон, повторяющий раскладку успешного состояния» — заметный скачок при загрузке по
  прямой ссылке/холодном старте.
- **recommended_fix:** круглый `Skeleton` размера `hero` по центру + центрированные `SkeletonText`.

### [LOW] LOW-4 Неиспользуемый ключ i18n и пробелы в тестах хоста
- **file:** packages/i18n/src/ru.ts; apps/app/src/__tests__/achievement-flash.test.tsx
- **location:** ru.ts:714 `'achievements.badge'`; тесты хоста
- **problem:** `achievements.badge` нигде не используется (`grep` по apps/packages — только определение). В тестах
  хоста нет сценариев: выход из аккаунта/смена пользователя (`ready: true → false → true` очищает `shown` и кэш —
  вспышка нового аккаунта показывается), возврат на передний план (`focusManager` → новое достижение → вспышка),
  запрос при открытом не-тихом экране после ухода с `/races/story/`.
- **why_it_matters:** мёртвый текст; ключевые ветки хоста из brief (смена пользователя, возврат) не закреплены тестом —
  регресс `resetShown` не покраснеет ни одним тестом.
- **recommended_fix:** удалить ключ или использовать; добавить 2 теста хоста (rerender с `ready=false→true` и
  новым списком; `focusManager.setFocused(true)` после истечения `staleTime`).

Без замечаний: порядок очереди (`flashQueue` — обратный порядок ответа, unit-тест), отбрасывание `unknown` (RC-8) в
списке/вспышке/публичном блоке, `shareRaceId` (только `race_*` и `kind: 'race'`), откат `seen` только своих кодов,
`shown` защищает от зацикливания при сбое `seen`, очистка кэша и `shown` при выходе, тихие адреса (`/auth/`,
`/devices/return`, `/settings/account/delete`, сторис, сами достижения), `fullScreenModal` и маршруты внутри
`Stack.Protected`, прямой адрес вспышки без очереди → Главная, публичный блок только на клиенте после найденного
профиля, 404 → блока нет, ошибка → `TabFailure` без поломки экрана, pull-to-refresh обоих экранов, a11y-подписи плиток,
дата с годом (RC-7), Documentation Sync (`pokatim-app.md` «Достижения», task.md 8.2/Outcome).

## PR B — pass 1, codex

verdict: REQUEST CHANGES

### [HIGH] Прямое открытие вспышки оставляет пустой экран при загрузке и ошибке
- **file:** apps/app/src/features/achievements/achievement-flash-screen.tsx
- **location:** 29–38, 53
- **problem:** Экран использует только `data` запроса и возвращает `null`, пока очередь не сформирована. При открытии `/achievements/flash` без заполненного кэша загрузка проходит на пустом экране. При ошибке GET или отсутствии сети `data` остаётся `undefined`, очередь — `null`, и экран остаётся пустым без возможности повторить запрос или закрыть вспышку.
- **why_it_matters:** Нарушен AGENTS.md §4.12: обязательны скелетон первой загрузки и ошибка с повтором. На web сценарий возникает при обновлении страницы, на native — при холодном старте по ссылке. Тихая обработка ошибки фонового хоста не распространяется на уже открытый экран.
- **evidence:** `const { data } = useAchievements()`; очередь заполняется только при наличии `data`; `if (queue === null) return null`. Тест прямого открытия проверяет только успешный ответ со всеми просмотренными достижениями; ошибка и paused-запрос не проверяются.
- **recommended_fix:** Сохранить полный объект запроса и обработать состояния до формирования очереди через `AsyncContent` или аналогичный компонент системы: скелетон раскладки вспышки, сетевую/серверную ошибку с повтором и доступный выход. Добавить тесты прямого открытия с отложенным ответом, ошибкой и отсутствием сети.

### [HIGH] Размеры значка заданы в приложении вне дизайн-системы
- **file:** apps/app/src/features/achievements/achievement-badge.tsx
- **location:** 10–20, 40–63
- **problem:** `BADGE_SIZE` содержит локальные размеры оформления `72` и `152`. Из них компонент вычисляет размеры диска, иконки, отступы кольца и толщину рамки. Недостающие значения системы заменены константами фичи с обещанием последующего переноса.
- **why_it_matters:** Это прямое нарушение AGENTS.md §4.11 и `.claude/rules/app.md`: размеры оформления должны поступать из дизайн-системы; отсутствие токена требует её расширения. Контракт ревью относит такое нарушение к HIGH. Запись B4 в task.md фиксирует отклонение, но не является разрешением человека отступить от инварианта.
- **evidence:** `export const BADGE_SIZE = { grid: 72, hero: 152 }`; значения используются в `width`, `height`, `borderWidth` и размере `Icon`. `packages/design-tokens` в diff не изменён, релиз необходимых токенов базы не представлен.
- **recommended_fix:** Добавить необходимые размеры и параметры значка в дизайн-систему по правилам проекта, затем потреблять их в компоненте. Для расширения общей системы выполнить предусмотренные тест и пример на UiKit; убрать локальные px-константы из приложения.

NOT VERIFIED: `pnpm check`, браузерный смоук и запуск на iOS/Android самостоятельно не выполнялись. Выводы проверены статически по реальному diff, правилам, маршрутам, настройкам QueryClient и связанным вызовам; отчёт исполнителя о зелёных проверках независимо не подтверждён.
## PR B — исправления pass 1 (coder, 2026-10-29)

Все находки приняты (проверены по коду, возражений нет); на каждую — тест.

- **HIGH-1 (оба) — размеры значка.** `BADGE_SIZE` и доли из фичи удалены. В `@pokatim/design-tokens` (по образцу
  `layout.avatarProfile`): `layout.badgeGrid` 72, `layout.badgeHero` 152, `badgeShape` (доли кольца, диска, иконки — px
  считаются от диаметра). Тест — `design-tokens.test.ts` (значения и «диск с кольцом вписаны в диаметр»). 8.2 B4
  обновлён, follow-up `size.badge*` в app-foundation остался.
- **HIGH (codex) — прямое открытие вспышки.** Пока снимка нет — `AsyncContent` (скелетон карточки
  `AchievementCardSkeleton`, ошибка и офлайн с повтором) и «Закрыть» сверху (назад или на Главную). Тесты: отложенный
  ответ (скелетон + «Закрыть»), 500 → «Не удалось загрузить» → «Повторить» → вспышка, офлайн → «Нет соединения» →
  «Закрыть» → `/`.
- **MEDIUM-1 — «назад»/«Поделиться» посреди очереди.** `flash-session.markPresented`: при открытии вспышки весь снимок
  скрыт до ответа сервера новее снимка (`hiddenCodes(dataUpdatedAt)`); пометка `seen` пишет кэш с прежним
  `updatedAt`, поэтому новым ответом считается только перезапрос (возврат на передний план после `staleTime`,
  pull-to-refresh). Тесты: «назад» на 1 из 2 → вспышка не открывается, после нового ответа — остаток без
  показанного; «Поделиться» на 1 из 2 → сторис → «назад» → вспышки нет. Проверено от обратного: без пометки снимка оба
  теста падают.
- **LOW-1 — мигание.** Пока ответ «Уменьшить движение» неизвестен — значок скрыт (`opacity: 0`, без анимации), затем
  статичен или появляется; последний ответ процесса кэшируется, следующий элемент очереди не ждёт `null`. Тест —
  `achievement-card.test.tsx`.
- **LOW-2 — публичный блок.** `publicOnly` → `publicItems` (флаг каталога `public` — только `race_*`). Тесты: unit
  `publicItems`; публичный ответ с `route_first` — не показан; только не-гоночные — блока нет.
- **LOW-3 — скелетон экрана достижения** — `AchievementCardSkeleton`: круг значка `layout.badgeHero` по центру и
  центрированные строки; в сетке блока — круглые места значков (`BadgeSkeleton`).
- **LOW-4.** Ключ `achievements.badge` удалён. Тесты хоста: выход и вход другим аккаунтом (`ready` false → true,
  `queryClient.clear()`) — показанное прежним снова вспыхивает; возврат на передний план (`focusManager`) после
  `staleTime` — новое достижение вспыхивает.

Правило `.claude/rules/pokatim-app.md` («Достижения») обновлено: токены значка, `hiddenCodes`, прямое открытие,
`publicOnly`.

## PR B — pass 2, claude

# Findings — 2026-10-29-achievements (PR B) — pass 2 — reviewer: claude
base: origin/develop   commits: origin/develop..0481ff7a (021ea0d2, f7b656cb, 31c1002e, merge 0481ff7a), working tree clean
verdict: REQUEST CHANGES (HIGH-1)

Прогон: `jest achievement-flash, achievements-blocks, features/achievements, own-profile, rider-profile,
app-routes-manifest` — 7 suites, 96 tests passed; `tsc --noEmit` apps/app — 0; `eslint` изменённых файлов — 0;
`vitest` packages/design-tokens — 579 passed. Playwright (`e2e:web`) не запускал.

Закрытие pass 1 (проверено по коду и тестам):
- HIGH-1 (оба) — закрыто: `BADGE_SIZE` удалён, `layout.badgeGrid`/`badgeHero` + `badgeShape` в `@pokatim/design-tokens`
  (`index.ts:84-95`), тест геометрии (2·(0.07+0.1)+0.56 = 0.90 ≤ 1), в фиче px-литералов нет (`achievement-badge.tsx`,
  `achievements-block.tsx:23` — `layout.badgeGrid + space.s5`).
- HIGH (codex) прямое открытие — закрыто: `AsyncContent` + `AchievementCardSkeleton` + «Закрыть» (назад или `/`),
  снимок — с первым ответом; тесты отложенного ответа, 500 → повтор, офлайн → «Закрыть».
- MEDIUM-1 — закрыто для основного сценария: `markPresented(snapshot, at)` + `hiddenCodes(dataUpdatedAt)`; оптимистичная
  правка `seen` сохраняет `dataUpdatedAt` (`queries.ts:44`), `cancelQueries` в `onMutate` откатывает гонку перезапроса;
  `resetShown` чистит и `presented`. Остаток — см. LOW-1 ниже.
- LOW-1 мигание — закрыто (`knownReduced`, скрытый первый кадр). LOW-2 — `publicItems` + тесты. LOW-3 — скелетон с кругом
  `badgeHero`. LOW-4 — ключ удалён, тесты выхода/входа и `focusManager` есть.
- `/welcome` и хост: конфликта нет — гость (`ready=false`) хост не запускает, `/welcome` под `Stack.Protected guard={!signedIn}`,
  маршруты достижений — в группе вкладок; `QUIET_PREFIXES` гостевых адресов не требует.

### [HIGH] HIGH-1 Смоук web после влития develop ждёт `/register`, а гость теперь уходит на `/welcome`
- **file:** apps/app/e2e/web.spec.ts
- **location:** :415-433 (новый `test.describe('достижения без сессии …')`), :427
- **problem:** для `/achievements/flash` и `/achievements/race_win` без сессии при `WITH_API` ожидается
  `toHaveURL(`${BASE_URL}/register`)`. После guest-landing (влит в ветку, `_layout.tsx` `redirectTo` → `'/welcome'` для
  нового гостя без регистрации) все соседние тесты гарда ждут `/welcome` (`:409` — `/profile`, `:448`, `:467`, `:486`, `:513`).
- **why_it_matters:** job смоука с API в CI (`ci.yml:146-207`, `E2E_API=1`, `pnpm e2e:web`) упадёт на двух тестах —
  мерж по зелёному CI невозможен; плюс тест закрепляет устаревшее поведение гарда.
- **evidence:** `if (WITH_API) { await expect(page).toHaveURL(`${BASE_URL}/register`); }` против
  `:409 await expect(page).toHaveURL(`${BASE_URL}/welcome`);` для `/profile` в том же сценарии.
- **recommended_fix:** заменить ожидание на `/welcome` (как у `/profile`) и прогнать `pnpm e2e:web` с `E2E_API=1`.

### [LOW] LOW-1 Перезапрос, пришедший пока вспышка открыта, снимает защиту «назад» посреди очереди
- **file:** apps/app/src/features/achievements/flash-session.ts / achievement-flash-screen.tsx
- **location:** flash-session.ts:22; achievement-flash-screen.tsx:58-64
- **problem:** `presented.dataUpdatedAt` фиксируется снимком при открытии и больше не обновляется. Если за время показа
  пришёл новый ответ (web — фокус вкладки через >60 с, native — возврат из фона), `hiddenCodes(t1)` уже не прячет
  снимок; непоказанные коды на сервере `seen:false` → хост держит `pending`. Пользователь жмёт «назад» на 1 из N —
  `quiet` становится `false`, вспышка сразу открывается снова с остатком (ровно симптом MEDIUM-1 pass 1, при условии).
- **why_it_matters:** редкий, но реальный путь (свернул приложение на вспышке, вернулся, закрыл «назад»). Не цикл —
  остаток при следующем открытии с новым ответом, но выглядит как «закрыл — открылось снова».
- **recommended_fix:** пока экран вспышки смонтирован — обновлять `presented.dataUpdatedAt` до текущего `dataUpdatedAt`
  (эффект по `dataUpdatedAt` с теми же кодами снимка) либо фиксировать момент ухода с экрана; тест — перезапрос при
  открытой вспышке, затем «назад» → вспышки нет.

Без замечаний: correctness `markPresented`/`hiddenCodes` (одна активная очередь, сброс при выходе, новый ответ
исключает только `shown`), сохранение `dataUpdatedAt` при оптимистичной правке и откате, вспышка при прямом открытии
(не открывается повторно хостом — путь тихий; «Закрыть» без истории → `/`), `AsyncContent`-ветка уходит при первом
`data` (снимок — обновление состояния при рендере), токены значка и их тест, `publicOnly`, скелетоны блока/карточки,
порядок маршрутов и гарды с `/welcome`, i18n, a11y, reduce motion. Безопасность: изменений API нет; публичный блок —
только `race_*` и на клиенте. Documentation Sync — `pokatim-app.md` «Достижения» и task.md 8.2 (B2, B4, B5) соответствуют
коду.

## PR B — pass 2, codex

verdict: REQUEST CHANGES

### [HIGH] Прямые ссылки на достижения не позволяют повторить восстановление сессии
- **file:** apps/app/src/app/achievements/flash.tsx; apps/app/src/app/achievements/[code].tsx
- **location:** `AchievementFlashRoute`:7–8; `AchievementRoute`:6–8
- **problem:** Оба маршрута сразу монтируют экран с активным `useAchievements()`, пока сессия ещё восстанавливается. Корневой `Stack.Protected` намеренно допускает состояния `unknown` и `unavailable`. Если восстановление сессии завершилось сетевой ошибкой, экраны показывают ошибку запроса достижений, а «Повторить» повторяет только этот запрос. Восстановление сессии повторно не запускается.
- **why_it_matters:** При обновлении страницы `/achievements/flash` или `/achievements/race_win` с временно недоступным API пользователь остаётся на ошибке даже после восстановления соединения: в сторе нет сессии, поэтому каждый повтор снова завершается `UnauthorizedError` до обращения к API. Нарушен §4.12: повтор должен восстанавливать загрузку, а сетевая ошибка должна отображаться как «Нет соединения».
- **evidence:** `useAchievements()` по умолчанию имеет `enabled = true` (`features/achievements/queries.ts:16–21`). `withAccessToken` немедленно бросает `UnauthorizedError`, если `session === null` (`features/auth/authorized.ts`). После неудачного восстановления `session-store.ts` сохраняет `status: 'unavailable', session: null`. Существующий `/profile` обрабатывает этот случай через `useSettingsShell()`: `useShellFailure()` передаёт исходную ошибку восстановления и повтор `useSessionStore.getState().hydrate()`. В новых маршрутах этой оболочки нет. Тесты прямого открытия заранее устанавливают живую сессию через `signInForTest()`, поэтому сценарий не проверяют.
- **recommended_fix:** Добавить обоим маршрутам существующую оболочку `useSettingsShell()` до монтирования экранов достижений. Проверить сценарий `unknown → unavailable → повтор hydrate → signedIn`: до восстановления запрос достижений не выполняется, показывается ошибка восстановления с рабочим повтором, после успешного восстановления загружается достижение.

Проверено статически: исправления первого прохода, реальные маршруты и гарды, восстановление сессии, очередь вспышки, оптимистичный `seen`, публичный блок, совместимость `unknown`, i18n, токены, состояния загрузки и документация. API, миграции, очереди и аудит этим diff не изменены.

NOT VERIFIED: `pnpm check`, браузерный смоук и iOS/Android самостоятельно не запускались; результаты исполнителя независимо не подтверждены.
## PR B — исправления pass 2 (coder, 2026-10-29)

Все находки pass 2 приняты (подтверждены по коду); на каждую — тест.

- **HIGH (codex) — прямые ссылки до восстановления сессии.** `app/achievements/flash.tsx` и `[code].tsx` — за
  `useSettingsShell()` (как `/profile`): пока сессия `unknown` — скелетон оболочки без запроса достижений;
  `unavailable` — «Нет соединения» / «Не удалось загрузить» с повтором `hydrate()`. Тест (оба адреса):
  `unknown` → скелетон, `listAchievements` не вызван → `unavailable` → «Нет соединения» → «Повторить» → `hydrate` →
  `signedIn` → достижение.
- **HIGH (claude) — смоук после guest-landing.** `e2e/web.spec.ts` «достижения без сессии»: гость с API уходит на
  `/welcome` (как `/profile`). Прогон `build:web` + `playwright -g "достижения|свой профиль"` без API (порты 8190/8191) —
  3 passed (SSR 200 без карточки и OG, после гидрации — «Нет соединения»). Ветка `E2E_API=1` — NOT VERIFIED: стенду
  нужны собранный API, базы и mailpit на портах `apps/api/.env`, общих с другими агентами.
- **LOW-1 (claude) — ответ, пришедший при открытой вспышке.** `flash-session`: `openPresented(codes)` — пока экран
  смонтирован, очередь скрыта при любом ответе; `closePresented(dataUpdatedAt)` при уходе — последнее
  `dataUpdatedAt` запроса на этот момент (`queryClient.getQueryState`), не снимка. Так не нужна перерисовка экрана на
  каждый ответ (в тесте экран модалки новый `dataUpdatedAt` не получал — эффект по нему не срабатывал). Тест: 1 из 2,
  перезапрос при открытой вспышке, «назад» → вспышки нет, переход на другой экран (хост пересчитывает очередь) →
  вспышки нет. Проверено от обратного: с `dataUpdatedAt` снимка при уходе тест падает.

Правило `pokatim-app.md` («Достижения») обновлено: `openPresented`/`closePresented`, оболочка маршрутов, `/welcome`.
