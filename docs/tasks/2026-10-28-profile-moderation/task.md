# Модерация профиля райдера: жалобы, очередь, сброс фото и клуба, перевыпуск id фото

Уровень: task3. Один PR: API (`apps/api`, `packages/contracts`, `packages/api-client`) и панель (`apps/admin`,
`packages/i18n`). Кнопка «Пожаловаться» в приложении (`apps/app`) — follow-up (экраны профиля правит PR B).

## 1. Title

Модерация публичного профиля райдера (закрывает R-2 и RC-A2 (b) `docs/tasks/2026-10-28-rider-profile/task.md`).

## 2. Goal

Фото, клуб и имя в публичном профиле — UGC без премодерации. До прода нужно:

- дать райдерам пожаловаться на чужой публичный профиль;
- дать `admin` и `moderator` очередь жалоб в панели и действия «Сбросить фото», «Сбросить клуб», «Сбросить имя»,
  «Отклонить жалобы» с причиной в журнале действий;
- при уходе профиля из публичного доступа перевыпускать id фото, чтобы старый URL фото давал 404.

## 3. Scope

### API

1. **Жалоба на профиль** — `POST /v1/riders/:publicId/reports` (`AuthGuard`), тело
   `{ reason: ProfileReportReason, comment?: string }`:
   - причины `PROFILE_REPORT_REASONS = ['photo', 'club', 'name', 'impersonation', 'spam', 'other']`;
   - комментарий — до 500 символов, правила текста как у жалоб на маршрут;
   - профиль должен быть публичным (имя и согласие; иначе 404, как `GET /v1/riders/:publicId`); свой профиль —
     409 `PROFILE_INVALID_STATE { reason: 'own_profile' }`;
   - одна **открытая** жалоба от пользователя на профиль: повтор при открытой — идемпотентный успех без второй
     записи; после закрытия жалоб модератором можно пожаловаться снова (фото и клуб меняются);
   - лимит — 20 жалоб в сутки на пользователя (`RATE_LIMITED` 429);
   - ответ — `RiderProfileViewer { canReport, reported }`.
2. **Состояние зрителя** — `GET /v1/riders/:publicId/me` (`AuthGuard`, `no-store`) → `RiderProfileViewer`:
   `reported` — есть открытая жалоба этого пользователя, `canReport` — профиль чужой и `!reported`. Непубличный — 404.
3. **Очередь панели** — `GET /v1/admin/rider-profiles?cursor&limit` (`PanelGuard`, `profiles.moderate`): профили с
   открытыми жалобами, от последней жалобы к старым. Элемент: `userId`, подпись `Участник ·<id>` или
   `Имя ·<id>` (правило Q2 — имя только при согласии), число открытых жалоб, главная причина, время последней
   жалобы, есть ли фото и клуб.
4. **Карточка** — `GET /v1/admin/rider-profiles/:userId`: подпись (Q2), клуб, фото (`{ id } | null`), публичен ли
   профиль, жалобы (последние 100, без автора: причина, комментарий, время, открыта или закрыта и чем),
   `reportRevision` (номер последней жалобы — защита «Отклонить» от гонки, как у райдов и маршрутов). Профиля нет —
   404.
5. **Действия** (`profiles.moderate`, тело `{ reason }` 3–500 символов, одна транзакция «профиль → жалобы → журнал»):
   - `POST /v1/admin/rider-profiles/:userId/avatar-reset` — удалить фото (документ `profile_avatars` удаляется,
     старый URL → 404), `avatarId: null`; журнал `profile.avatar_reset`;
   - `POST /v1/admin/rider-profiles/:userId/club-reset` — `club: null`; журнал `profile.club_reset`;
   - существующий `POST /v1/admin/profiles/:userId/name-reset` — без изменения контракта; теперь ещё закрывает
     открытые жалобы и перевыпускает id фото (п. 6);
   - `POST /v1/admin/rider-profiles/:userId/dismiss-reports` — `{ reason, reportRevision }`, закрыть открытые жалобы
     как `dismissed`, профиль не меняется; пришла новая жалоба после открытия карточки — 409
     `PROFILE_INVALID_STATE { reason: 'stale_reports' }`; журнал `profile.reports_dismissed`.

   Сброс закрывает все открытые жалобы профиля как `actioned`. Сбрасывать нечего (фото или клуба нет) —
   `{ reset: false }` без журнала, жалобы не закрываются (как D2 сброса имени). Ответ сбросов — `{ reset: boolean }`,
   панель перечитывает карточку. В журнале — подпись `Участник ·<id>` (D3) и причина; сброшенные клуб, имя и фото в
   журнал и логи не попадают.
6. **Перевыпуск id фото (RC-A2 (b))** — при переходе профиля из публичного в непубличный (публичен = имя строкой и
   `showNameInResults`): отзыв согласия или очистка имени в `PATCH /v1/profile`, сброс имени модератором. В той же
   транзакции, что запись профиля: копия аватара под новым `randomToken`, `avatarId` — новый, старый документ
   удаляется. Старый URL → 404, своё фото у райдера продолжает работать по новому id.
7. **Удаление аккаунта** — `ProfileErasure.erase` удаляет жалобы **на** пользователя (`targetUserId`); жалобы,
   поданные удалённым пользователем на других, остаются (псевдонимный `reporterUserId`, как у райдов и маршрутов).
8. **Миграция `0034_profile_reports`** (следующая свободная на момент мержа) — коллекция и индексы.

### Панель (`apps/admin`)

9. Раздел «Профили райдеров» (`/rider-profiles`, право `profiles.moderate`, группа `bottom`, в конец `NAVIGATION`):
   - очередь «Открытые жалобы» — таблица с подписью, числом жалоб, главной причиной, временем последней, «Показать
     ещё»; пусто — «Жалоб нет»;
   - карточка `/rider-profiles/:userId`: фото 128 px (или пустой квадрат), подпись, клуб, «Публичный» / «Скрыт
     райдером», жалобы; действия «Сбросить фото», «Сбросить клуб», «Сбросить имя», «Отклонить жалобы» — диалог
     причины с предупреждением «Не повторяйте имя или клуб в причине» (D11); 409 `stale_reports` — «Пришли новые
     жалобы, обновите карточку».

### Документы

10. `docs/product/profile.md` — решения S1–S8, риски R-2 и RC-A2 закрыты, follow-up; `docs/product/admin-panel.md`
    (раздел), ADR-0019 (перевыпуск id), `.claude/rules/pokatim-db.md`, `pokatim-security.md`, `docs/product/account.md`
    (жалобы при удалении).

## 4. Out of Scope

- Кнопка «Пожаловаться» и экран жалобы в приложении — follow-up к PR B профиля.
- Уведомление райдеру о сбросе, бан загрузки фото, премодерация, автоматическое распознавание.
- Шаблонные причины сброса (enum, D11).
- Жалобы на имя в таблицах результатов (жалоба — только из публичного профиля).

## 5. Architecture Context

ADR-0007 (Mongo), ADR-0008 (`AuthGuard`), ADR-0009 (панель, права, журнал), ADR-0015 (удаление), ADR-0019 (аватары).
Образцы: `routes/route-reports.*`, `routes/routes-moderation.*` (очередь, «Отклонить» с `reportRevision`),
`rides/ride-reports.*`, `profile/profile-moderation.service.ts` (сброс имени, подпись D3), панель —
`features/rider-routes`, `features/rides-moderation`.

## 5.1 Placement & Reuse Gate

- Жалобы, очередь и сбросы — модуль `profile` (единственный писатель `profiles` и `profile_avatars`): новые
  `profile-reports.{collection,repository,service}.ts`, `rider-profile-moderation.*`; поиск по `publicId` —
  `ProfileRepository`. `riders` (композиция) не трогается или трогается минимально — решает architect.
- Журнал — `PanelAudit.append`, подпись — `riderSubjectLabel`; лимиты — `RateLimiter`; курсор — `page-cursor.ts`;
  транзакции — `MongoTransactions`; `randomToken` — `modules/identity`; диалог причины и таблицы панели — общие
  компоненты `features/rider-routes`.

## 6. Relevant Files

`apps/api/src/modules/profile/*`, `apps/api/src/modules/panel/*` (виды действий журнала),
`apps/api/src/db/migrations/`, `packages/contracts/src/profile/`, `packages/contracts/src/admin/` (действия журнала),
`packages/api-client/src/{index,admin}.ts`, `apps/admin/src/{navigation,router}.ts(x)`, `apps/admin/src/features/`,
`packages/i18n`.

## 7. Implementation Notes

- Порядок записи в транзакции жалобы — первой условная запись профиля (`$inc openReportCount, reportRevision`,
  `$max lastReportAt`), затем вставка жалобы: конкурирующий сброс пишет тот же документ — транзакции конфликтуют
  (образец `RouteReportsService`).
- Перевыпуск id фото — внутри транзакции `ProfileService.update` и `resetPublicName`, по факту смены «публичен» (флаг
  до/после из `returnDocument: 'before'`).

## 8. Risks / Assumptions / Open Questions

- **S-1. Повторная жалоба после закрытия.** Райдер может жаловаться снова после решения модератора — фото и клуб
  меняются; защита от спама — лимит 20 в сутки и одна открытая жалоба.
- **S-2. Карточка показывает фото и клуб скрытого профиля.** Модератору нужно видеть то, на что жаловались, даже
  если райдер отозвал согласие; имя — по Q2 (только при согласии).
- **S-3. Причина в журнале.** Модератор может повторить в причине клуб или имя — предупреждение в диалоге (D11).
- **S-4. Кэш.** Публичный профиль кэшируется до 60 с; фото после сброса — 404 на сервере, в браузерах с `immutable`
  живёт до очистки кэша (R-4).
- **Assumption.** Сброс не уведомляет райдера: он видит пустое фото или клуб в своём профиле.

## 8.1 Requirements Consistency

### Architecture Review (2026-10-28)

Status: **CONCERNS** — блокеров нет. RC-P1…RC-P7 — рекомендации architect; coder идёт по рекомендациям (автономный
режим), решение фиксируется в 8.2 / Outcome.

- **RC-P1. `409 PROFILE_INVALID_STATE { reason: 'stale_reports' }` против прецедента.** «Отклонить жалобы» с
  устаревшей ревизией у маршрутов и райдов — `409 CONFLICT` без `details` (`routes-moderation.service.ts`,
  `rides-moderation.service.ts`); панель ловит `CONFLICT` одним `ConflictBanner` (`rider-routes-format.ts`,
  `RideModerationScreen.tsx`). Варианты: (a) **`409 CONFLICT`** для устаревшей ревизии (как у соседей), новый код
  `PROFILE_INVALID_STATE` — только для `own_profile` (жалоба райдера); (b) как в спецификации — `stale_reports` в
  `ProfileStateDetails` (третий способ сказать «карточка устарела» в панели); (c) `CONFLICT` везде, без нового кода
  (`own_profile` — тоже `CONFLICT`: приложение не отличит «свой» от гонки). **Рекомендация — (a).** Текст панели «Пришли
  новые жалобы, обновите карточку» — на `CONFLICT`.
- **RC-P2. «Отклонить жалобы», когда открытых жалоб уже нет** (другой модератор только что сбросил или отклонил,
  ревизия та же) — спецификация не говорит. Варианты: (a) **идемпотентный успех `{ dismissed: false }` без журнала**
  (как D2 сброса); (b) `409 PROFILE_INVALID_STATE` (как `RIDE_INVALID_STATE` у райдов — там есть машина статусов, у
  профиля нет). **Рекомендация — (a).**
- **RC-P3. Журнал `profile.name_reset` получает `details`.** Сброс имени теперь закрывает жалобы; соседние действия
  пишут `details.reportCount` (число закрытых). HTTP-контракт сброса имени не меняется, меняется только запись журнала
  (`details: null` → `{ reportCount }`, поле уже есть в `AuditEntry.details`). Варианты: (a) **`{ reportCount }` во
  всех четырёх действиях `profile.*` модерации** (0 — тоже число); (b) `details` только при `reportCount > 0`.
  **Рекомендация — (a)**; int-тест `profile-admin.int.test.ts` (`details: null`) правится.
- **RC-P4. Фото 128 px в карточке панели — нет токена.** В `@rkarakulov/design-tokens` только `size.avatar*` 24–32
  px; px-литерал запрещён (AGENTS §4.11). Варианты: (a) **`'avatar-preview': 128` в `apps/admin/src/panel-tokens.ts`**
  (`--panel-avatar-preview`, тот же временный механизм Q17, что ширины окна и колонок; TODO выноса в базу уже есть);
  (b) задача и релиз в app-foundation (`size.avatarPreview`) до PR — блокирует PR; (c) существующий `size.emptyTile`
  52 px — отступление от спецификации. **Рекомендация — (a).**
- **RC-P5. §5.1 «диалог причины и таблицы — общие компоненты `features/rider-routes`».** Общие компоненты панели живут
  в `apps/admin/src/ui` (`ReasonDialog`, `DataTable`, `ConflictBanner`, `PageHeader`, `EmptyState`, `Banner`,
  `StatusTag`) — `pokatim-web.md`; `features/rider-routes` — только образец экранов (`ReasonDecisionDialog` там
  доменный). Подпись `Участник ·<id>` / `Имя ·<id>` — `riderLabel` из `features/results/results-format.ts` (импорт между
  фичами — прецедент `disputes`, `seasons`). Это уточнение, не альтернатива.
- **RC-P6. `riders/:publicId/{me,reports}` — в модуле `profile`, а не `riders`.** `pokatim-backend.md` закрепляет
  `riders/:publicId` за модулем-композицией `riders`. Варианты: (a) **новый контроллер `@Controller('riders')` +
  `AuthGuard` в `ProfileModule`** — все данные (`profiles`, `profile_reports`) у `profile`, новых рёбер графа нет;
  find-my-way различает статические `me`/`reports`/`races` и глубину пути — порядок регистрации модулей не важен;
  (b) контроллер в `riders` + новый порт `PROFILE_REPORTS` в `ProfileCoreModule` — лишний порт ради пути;
  (c) путь `/v1/profile/reports/:publicId` — расходится со спецификацией и будущим экраном `/riders/[id]`.
  **Рекомендация — (a)**, строку в `pokatim-backend.md` уточнить («`riders/:publicId` — публичное чтение `riders`;
  `riders/:publicId/{me,reports}` — `profile`»).
- **RC-P7. Удаление жалоб при удалении аккаунта цели vs append-only модерации (AGENTS §4.10).** Жалоба — не решение
  модерации (решение и причина — в `panel_audit`, он не трогается); прецедент — `RouteReportsRepository.deleteForRoute`.
  Комментарии жалоб на удалённого могут содержать его ПДн — удалять правильно. Варианты: (a) **удалять
  (`deleteForTarget`) — как в §3 п. 7**; (b) обезличивать (`comment: null`, оставить причину) — данные без субъекта
  никому не нужны. **Рекомендация — (a)**, без отклонения от спецификации.
- **Решение по RC-P1…RC-P7 (исполнитель, 2026-10-28; автономный режим, вынесено в отчёт):** везде принята
  рекомендация architect. AC7 читать как «устаревший `reportRevision` — 409 `CONFLICT`».
- **Без находок:** серверный авторитет (клиент шлёт только причину и комментарий; публичность, «свой», ревизия —
  сервер), outbox/BullMQ (событий для других модулей и уведомлений нет — Out of Scope), обратная совместимость
  (только новые схемы, коды и действия журнала — в конец списков), граф модулей (новых рёбер нет: `profile → identity,
  panel` уже есть; `profile` не импортирует `results`/`rides`/`routes`/`riders`), CSP панели (см. 11.7: фото — тот же
  origin, `img-src 'self'` уже есть).

## 8.2 Отклонения при реализации (API, coder, 2026-10-28)

- **RC-P1…RC-P7** — приняты рекомендации architect (см. 8.1): устаревший `reportRevision` — `409 CONFLICT`;
  «Отклонить» без открытых — `{ dismissed: false }` без журнала; `details.reportCount` во всех четырёх действиях
  `profile.*` (в т. ч. `name_reset`: `null` → `{ reportCount }`, int-тест поправлен); `riders/:publicId/{me,reports}` —
  контроллер в `profile`; жалобы на удалённого стираются.
- **«Решения S1–S8» в `docs/product/profile.md`** — в спецификации номера не расшифрованы; исполнитель свёл решения §3
  в восемь пунктов (S1 жалоба, S2 одна открытая, S3 лимит, S4 очередь, S5 карточка, S6 действия, S7 журнал, S8
  перевыпуск id).
- **`packages/i18n`** — в части API добавлены только три подписи журнала `admin.audit.action.profile.{avatar_reset,
  club_reset,reports_dismissed}`: без них не собирается typecheck панели (`AuditScreen` строит ключ шаблоном). Прочие
  строки панели (`admin.riderProfiles.*`, `admin.nav.riderProfiles`, `domain.profileReportReason.*`) — часть панели.
- **Тестовый помощник `apps/api/test/profiles.ts`** (новый, не в списке 11.10): публичный райдер, фото без sharp
  (документ напрямую в БД), вызовы жалоб и панели.
- **ADR-0019** — перевыпуск оформлен дополнением (п. 6 «Решения»), не новым ADR.
- **Документы панели** (`docs/product/admin-panel.md`, `.claude/rules/pokatim-web.md`) — не тронуты: их обновляет
  исполнитель панели.

### Панель (coder, 2026-10-28)

- **RC-P4, RC-P5** — приняты: `'avatar-preview': 128` в `panel-tokens.ts` (класс `.avatar-preview` в `index.css`);
  экраны собраны из `src/ui` (`DataTable`, `ReasonDialog`, `ConflictBanner`, `PageHeader`, `EmptyState`, `StatusTag`,
  `DisabledReason`), подпись — `riderLabel` из `features/results/results-format.ts`.
- **Предупреждение D11** — `Banner tone="warning"` в слоте `extraFields` `ReasonDialog` (над полем причины), во всех
  четырёх действиях; общий компонент не менялся.
- **Неактивные сбросы** — `disabled` + `aria-describedby` на одну строку `DisabledReason` «Сбросить можно только то,
  что есть в профиле.» под шапкой. «Сбросить имя» неактивна при `name: null` (сервер отдаёт имя только при согласии,
  Q2 — как «Сбросить имя» в «Результатах»: имя скрытого профиля нигде не показывается).
- **«Отклонить жалобы»** скрыта при `openReportCount === 0` (как у райдов), а не заблокирована.
- **Колонка «В профиле»** очереди — признаки фото и клуба одной ячейкой («Фото, клуб» / «Фото» / «Клуб» / «—»).
- **Тест `design-system.test.ts`** — добавлена проверка `--panel-avatar-preview: 128px;` (не в списке 11.9).

## 9. Acceptance Criteria

1. `POST /v1/riders/:publicId/reports`: 200 `{ canReport: false, reported: true }`; повтор — 200 без второй записи;
   свой — 409 `own_profile`; непубличный и неизвестный — 404; без входа — 401; 21-я за сутки — 429; неверная
   причина и длинный комментарий — 400.
2. `GET /v1/riders/:publicId/me` — `canReport`/`reported` до и после жалобы; после «Отклонить» — снова `canReport`.
3. Очередь: только профили с открытыми жалобами, сортировка по последней жалобе, курсор; без права — 403, без входа
   в панель — 401; подпись по Q2.
4. Карточка: фото, клуб, жалобы без `reporterUserId`, `reportRevision`; профиля нет — 404.
5. `avatar-reset`: старый `GET /v1/avatars/:id` → 404, `avatar: null` у райдера, жалобы закрыты `actioned`, запись
   журнала без клуба и имени; повтор — `{ reset: false }` без журнала.
6. `club-reset` — аналогично для клуба; `name-reset` закрывает жалобы.
7. `dismiss-reports`: закрывает как `dismissed`, профиль не меняется; устаревший `reportRevision` — 409
   `stale_reports`.
8. Перевыпуск: отзыв согласия (и очистка имени, и сброс имени) — старый id фото → 404, новый `avatar.id` в
   `GET /v1/profile` отдаёт те же байты; включённое согласие и смена клуба id не меняют.
9. Удаление аккаунта цели удаляет жалобы на него; жалобы удалённого жалобщика остаются (int-тест erasure).
10. Панель: раздел виден только с `profiles.moderate`; очередь, карточка, четыре действия с причиной, 409 — понятный
    текст; тесты экранов.
11. Миграция `0034_*` (индексы, идемпотентна); `TURBO_CONCURRENCY=1 pnpm check` зелёный.

## 10. Documentation Impact

См. п. 10 Scope. `pr.md` — миграция, новые эндпоинты, follow-up кнопки в приложении. Architect добавляет:

- `.claude/rules/pokatim-backend.md` — раздел «Профиль райдера»: `RiderReportsController` (`riders/:publicId/{me,
  reports}`, `AuthGuard`, модуль `profile` — RC-P6), `RiderProfilesModerationController` (`admin/rider-profiles`),
  `ProfileReportsService`, `AvatarReissue`, лимит `profile-report:<uid>` 20/сут; перевыпуск id фото — в транзакциях
  `PATCH` и сброса имени.
- `.claude/rules/pokatim-db.md` — `profile_reports` (единственный писатель, сторож, закрытие, `deleteForTarget`,
  уникальный частичный индекс «одна открытая»), `profiles.{openReportCount,reportRevision,lastReportAt}` + очередь;
  порядок записи «профиль первым»; перевыпуск id (копия → профиль → удаление старого).
- `.claude/rules/pokatim-security.md` — RC-A2 закрыт вариантом (b); жалобы — лимит, одна открытая, `own_profile`;
  панель — подпись Q2, жалобы без автора, журнал без имени/клуба/фото.
- `.claude/rules/pokatim-web.md` — раздел «Профили райдеров» (`features/rider-profiles`, `--panel-avatar-preview`).
- `.claude/rules/pokatim-contracts.md` — `PROFILE_REPORT_REASONS`, `PROFILE_INVALID_STATE` (RC-P1).
- `docs/runbooks/account-deletion.md` и ADR-0015 «Правило для будущих модулей» — шаг `profile` стирает жалобы на
  пользователя.

## 11. Implementation Context

Architecture Review — **Status: CONCERNS** (блокеров нет; RC-P1…RC-P7 в 8.1, coder идёт по рекомендациям). Код
проверен по `feature/profile-moderation` = `origin/develop` (aa857ba). Миграций `0034+` нет ни в одной ветке `origin`
(`git fetch` 2026-10-28) — перед PR сверить снова.

### 11.1 Placement и граф модулей

Всё — в модуле `profile` (единственный писатель `profiles` и `profile_avatars`). Новых рёбер графа нет: `profile →
identity, panel` уже есть (`profile.module.ts`), `profile` **не** импортирует `results`, `rides`, `routes`, `riders`
(цикл `results/routes → profile`, `no-circular` по файлам с type-импортами). `riders` не меняется (RC-P6). Новый пакет —
нет, в app-foundation — ничего.

| Что | Файл (`apps/api/src/modules/profile/`) | Модуль Nest | Слой |
|---|---|---|---|
| Документ жалобы, имя коллекции | `profile-reports.collection.ts` (новый) | — | collection |
| Единственный писатель `profile_reports` | `profile-reports.repository.ts` (новый) | `ProfileCoreModule` (providers + exports: нужен `ProfileErasure` и `ProfileModule`) | repo |
| Жалоба и состояние зрителя | `profile-reports.service.ts` (новый, `ProfileReportsService`) | `ProfileModule` | service |
| `GET riders/:publicId/me`, `POST riders/:publicId/reports` | `rider-reports.controller.ts` (новый, `@Controller('riders')` + `@UseGuards(AuthGuard)`) | `ProfileModule.controllers` | controller |
| Очередь, карточка, `avatar-reset`, `club-reset`, `dismiss-reports` | `rider-profiles-moderation.controller.ts` (новый, `@Controller('admin/rider-profiles')`, `PanelGuard` + `@RequirePermission('profiles.moderate')` на классе) | `ProfileModule.controllers` | controller |
| Действия модерации (все четыре) + чтения панели | `profile-moderation.service.ts` (расширить: `list`, `detail`, `resetAvatar`, `resetClub`, `dismissReports`, `resetName`) | `ProfileModule` | service |
| Перевыпуск id фото | `avatar-reissue.ts` (новый, `@Injectable() AvatarReissue`) | `ProfileModule.providers` (нужен `ProfileService` и `ProfileModerationService`) | service-helper |
| Публичность профиля (одна функция) | `profile.policy.ts`: `isPublicProfile(doc)` (`typeof publicName === 'string' && showNameInResults === true`) + `PROFILE_POLICY.reportLimit` | — | policy |
| Стирание жалоб на пользователя | `profile-erasure.ts` | `ProfileCoreModule` | port |

- `ProfileAdminController` (`admin/profiles/:userId/name-reset`) остаётся как есть (контракт не меняется), вызывает
  расширенный `resetName`.
- Контроллеры с префиксом `riders` в двух модулях: `RidersPublicController` (`riders/:publicId`,
  `riders/:publicId/races`, `PublicReadGuard`) и `RiderReportsController` (`riders/:publicId/me`,
  `riders/:publicId/reports`, `AuthGuard`) — пути различаются статическим сегментом/глубиной, guard — на классе своего
  контроллера; порядок регистрации (`ProfileModule` раньше `RidersModule` в `app.module.ts`) не важен. int-тест: `GET
  riders/:publicId/me` без токена → 401 (не 200 публичного профиля), `GET riders/:publicId` без токена → 200.
- `admin-routes.test.ts` проверит `PanelGuard` нового `admin/*` контроллера автоматически.

### 11.2 Контракты (`packages/contracts`) и совместимость

- **`profile/profile-report.schema.ts`** (новый): `PROFILE_REPORT_REASONS = ['photo','club','name','impersonation',
  'spam','other'] as const` (только в конец); `ProfileReportReason = z.enum(…, { error: fieldError('REQUIRED') })`;
  `PROFILE_REPORT_COMMENT_MAX = 500`; `CreateProfileReportRequest = z.strictObject({ reason, comment:
  optionalText(500, MULTI_LINE).optional() })` (как `CreateRouteReportRequest`); `RiderProfileViewer = z.object({
  canReport: z.boolean(), reported: z.boolean() })`; `PROFILE_STATE_REASONS = ['own_profile'] as const`,
  `ProfileStateDetails = z.object({ reason: tolerantEnum(PROFILE_STATE_REASONS) })` (RC-P1 (a)).
- **`profile/profile-moderation.schema.ts`** (новый, панель — строгие enum):
  - `PROFILE_REPORT_RESOLUTIONS = ['actioned','dismissed']`; `MODERATION_PROFILE_REPORTS_MAX = 100`;
    `RIDER_PROFILE_MODERATION_MAX_LIMIT = 50`.
  - `RiderProfileModerationQuery = z.strictObject({ ...PageQuery.shape, cursor: PageCursor.optional(), limit:
    z.coerce.number().int().min(1).max(50).default(20) })` (образец `RiderRouteModerationQuery`).
  - `RiderProfileModerationRow = { userId: Uuid, name: string | null /* только при согласии, Q2 */, openReportCount,
    topReason: ProfileReportReason.nullable(), lastReportAt: iso | null, hasAvatar: boolean, hasClub: boolean }`;
    `RiderProfileModerationPage = { items, nextCursor: string | null }`.
  - `RiderProfileModerationReport = { id, reason, comment, createdAt, resolution: z.enum(RESOLUTIONS).nullable(),
    resolvedAt }` — **без `reporterUserId`**.
  - `RiderProfileModerationDetail = { userId, name (Q2), club: string | null, avatar: { id: AvatarId } | null,
    isPublic: boolean, openReportCount, lastReportAt, reportRevision: int ≥ 0, reports: max(100) }`.
  - Тела: аватар и клуб — **`ResetRiderNameRequest`** (`{ reason: ActionReason }`) переиспользовать под общим
    именем `RiderProfileResetRequest = ResetRiderNameRequest` (не копия); `DismissRiderProfileReportsRequest =
    z.strictObject({ reason: ActionReason, reportRevision: z.number().int().nonnegative() })`.
  - Ответы: аватар и клуб — `RiderNameResetResult` (`{ reset }`) под алиасом `RiderProfileResetResult`;
    `dismiss-reports` — `RiderProfileReportsDismissResult = z.object({ dismissed: z.boolean() })` (RC-P2).
  - Подпись строки собирает панель (`riderLabel(userId, name)`), сервер отдаёт `name` уже по правилу Q2 — так же, как
    `riderName` таблиц результатов.
- `common.ts` `ErrorCode` — **в конец**: `'PROFILE_INVALID_STATE'` (комментарий «profile-moderation: жалоба на свой
  профиль (details.reason)»); текст `apps/api/src/error-messages.ts` — «На свой профиль пожаловаться нельзя»
  (`error-messages.test.ts` проверит полноту). Устаревшая ревизия — базовый `CONFLICT` (RC-P1).
- `admin/audit.schema.ts` `AUDIT_ACTIONS` — **в конец** (после `appearance.decor_changed`): `'profile.avatar_reset'`,
  `'profile.club_reset'`, `'profile.reports_dismissed'` (subject `rider`). `details.reportCount` уже есть.
- `index.ts` — экспорт новых файлов.
- **Совместимость:** только новые схемы, коды и значения enum в конце; `ProfileView`, `PublicRiderProfile`,
  `RiderNameResetResult` не меняются. Приложение новых ответов пока не читает (кнопка — follow-up); `RiderProfileViewer`
  — `z.object` (нестрогий), будущие поля — `.default`.
- **`packages/api-client`:**
  - `src/index.ts` (образец `getCatalogRouteViewer`/`reportCatalogRoute`, стр. ~653): `getRiderViewer(token,
    publicId)` → `GET /v1/riders/${encodeURIComponent(publicId)}/me`, `reportRider(token, publicId, body)` → `POST
    …/reports`, оба `RiderProfileViewer`.
  - `src/admin.ts` (раздел «профили райдеров»): `listRiderProfiles(params)`, `getRiderProfile(userId)`,
    `resetRiderAvatar(userId, body)`, `resetRiderClub(userId, body)`, `dismissRiderProfileReports(userId, body)`,
    `riderAvatarUrl(id)` (`${baseUrl}/v1/avatars/${encodeURIComponent(id)}`, без запроса — как `avatarUrl`).
    `resetRiderName` — без изменений.

### 11.3 Модель данных и миграция `0034_profile_reports`

Expand-only, без транзакции, идемпотентна, **без бэкфилла**.

- **`profiles`** (`ProfileDoc`, необязательные, чтение `?? 0` / `?? null`): `openReportCount?: number` (= числу
  открытых жалоб), `reportRevision?: number` (`$inc` каждой жалобой, монотонна — маркер «Отклонить жалобы»),
  `lastReportAt?: Date | null` (`$max`, только порядок очереди). `VIEW_PROJECTION` и `findPublic` их **не** берут —
  наружу в `ProfileView`/`PublicRiderProfile` не выходят. Pipeline-upsert'ы (`updatePublicName`, `setAvatar`) поля не
  трогают (`$set` pipeline сохраняет прочие поля) — `KEEP_PROFILE_FIELDS` не расширять.
  - Индекс **`profiles_report_queue_idx`**: `{ lastReportAt: -1, _id: -1 }`, `partialFilterExpression: {
    openReportCount: { $gt: 0 } }` (образец `rides_report_queue_idx`); запрос очереди обязан содержать
    `openReportCount: { $gt: 0 }` и `.hint('profiles_report_queue_idx')`. Отсутствующее поле в частичный индекс не
    попадает — бэкфилл не нужен.
- **`profile_reports`** (новая, `PROFILE_REPORTS_COLLECTIONS.reports = 'profile_reports'`): `{ _id: uuidv7,
  targetUserId, reporterUserId, reason: ProfileReportReason, comment: string | null, createdAt, resolvedAt: Date |
  null, resolution: 'actioned' | 'dismissed' | null, resolvedBy: string | null }` — `resolvedAt`/`resolution`/
  `resolvedBy` пишутся явным `null` (правило `pokatim-db.md`).
  - **`profile_reports_open_unique`**: `{ targetUserId: 1, reporterUserId: 1 }`, `unique: true`,
    `partialFilterExpression: { resolvedAt: { $eq: null } }`. **Проверено:** равенство с `null` в частичном
    уникальном индексе уже работает в проекте (`0002_identity` `${collection}_active_unique` — `{ usedAt: { $eq: null
    }, supersededAt: { $eq: null } }`, MongoDB 8.0), правило `pokatim-db.md` прямо описывает `{ x: { $eq: null } }`.
    Закрытие (`resolvedAt → Date`) выводит документ из индекса — новая жалоба того же пользователя после решения
    вставляется (S-1). Запрос «есть открытая» обязан содержать `resolvedAt: null` (иначе индекс не применим).
    Альтернатива, если бы `$eq: null` не поддерживался, — поле-ключ `openKey: 'open' | null` + `{ $type: 'string' }`;
    не нужна.
  - **`profile_reports_target_idx`**: `{ targetUserId: 1, _id: -1 }` — карточка (100 новых), `closeOpen`,
    агрегация `topReasons`, `deleteForTarget`.
  - Индекса по `reporterUserId` нет: жалобы удалённого жалобщика не трогаются.
- Файл `apps/api/src/db/migrations/0034_profile_reports.ts`: экспорт `PROFILE_REPORTS_INDEXES` (образец
  `0017_ride_reports.ts`: `ensureCollection` из `0002_identity` + `createIndex` по списку), `profileReports:
  MongoMigration = { id: '0034_profile_reports', … }`; в конец массива `migrations/index.ts`.
  `migrations.int.test.ts` — ожидаемые индексы (ключ, `unique`, `partialFilterExpression`) + повторный прогон.

### 11.4 Порядок записи в транзакциях

Общее правило (как `rides`/`routes`, `pokatim-db.md`): **первая запись транзакции — документ `profiles`** (условие в
фильтре). Жалоба, сбросы, «Отклонить», `PATCH /v1/profile` и сброс имени пишут один документ — параллельные
транзакции конфликтуют (write conflict → `withTransaction` повторяет колбэк), `openReportCount` = числу открытых жалоб.
Колбэк идемпотентен: `uuidv7()` жалобы и `randomToken()` нового id фото — **до** `transactions.run`.

**Жалоба** (`ProfileReportsService.report(userId, publicId, body)`, образец `RouteReportsService.report`):

1. `rateLimiter.consume('profile-report:<uid>', PROFILE_POLICY.reportLimit /* 20 / 86400 */)` → 429 `RATE_LIMITED` +
   `retryAfterSec` (как у маршрутов — до проверок, 404 тоже тратит квоту).
2. `repository.findPublic(publicId)` (фильтр публичности уже внутри) → нет — 404; `_id === userId` — 409
   `PROFILE_INVALID_STATE { reason: 'own_profile' }`.
3. `reports.openExists(targetUserId, userId)` → есть — `{ canReport: false, reported: true }` без записи.
4. Транзакция: `repository.recordReport(tx, publicId, userId, now)` — `findOneAndUpdate({ publicId,
   showNameInResults: true, publicName: { $type: 'string' }, _id: { $ne: userId } }, { $inc: { openReportCount: 1,
   reportRevision: 1 }, $max: { lastReportAt: now } }, { projection: { _id: 1 } })` → `null` — вернуть `false`;
   иначе `reports.insert(tx, doc)` с `targetUserId = _id`. `updatedAt` профиля **не** трогать (это время записи
   райдера).
5. `isDuplicateKey(error, PROFILE_REPORTS_OPEN_UNIQUE_INDEX)` — параллельная жалоба того же пользователя закоммитилась
   первой → идемпотентный успех. `recorded === false` (профиль скрыт между шагами 2 и 4) → повторить шаг 2 → 404.
6. Лог: `profile.reported uid=<reporter> reason=<code>` — без `publicId`, `userId` цели, комментария, имени.

**Зритель** (`viewer`): `findPublic` → 404; `reported = openExists(target, uid)`; `canReport = target !== uid &&
!reported`.

**Сбросы** (`ProfileModerationService`, общий приватный `act`): транзакция —

| Шаг | `avatar-reset` | `club-reset` | `name-reset` (расширение) | `dismiss-reports` |
|---|---|---|---|---|
| 1. запись профиля | `findOneAndUpdate({ _id, avatarId: { $type: 'string' } }, { $set: { avatarId: null, openReportCount: 0, updatedAt } }, { returnDocument: 'before', projection: { avatarId: 1 } })` | `{ _id, club: { $type: 'string' } }` → `$set { club: null, openReportCount: 0, updatedAt }` | `resetPublicName`: тот же фильтр, `$set` + `openReportCount: 0`, **projection `{ showNameInResults: 1, avatarId: 1 }`** (`returnDocument` по умолчанию — `before`) | чтение в tx `findForModeration` → нет — 404; `reportRevision !== body.reportRevision` — 409 `CONFLICT`; `openReportCount === 0` — `{ dismissed: false }` без журнала (RC-P2); затем `clearReports(tx, _id, reportRevision)` — `{ _id, reportRevision, openReportCount: { $gt: 0 } }` → `$set { openReportCount: 0 }` (без `updatedAt`), `null` — 409 `CONFLICT` |
| не совпало | `findOne({ _id })`: нет — 404, есть — `{ reset: false }`, жалобы не закрываются, журнала нет | так же | так же (D2) | — |
| 2. побочное | `avatars.delete(tx, prev, userId)` (старый URL → 404) | — | `before.showNameInResults === true && before.avatarId` → `AvatarReissue.reissue` (11.5) | — |
| 3. жалобы | `reports.closeOpen(tx, userId, 'actioned', actor, now)` | так же | так же | `closeOpen(…, 'dismissed', …)` |
| 4. журнал | `PanelAudit.append` `profile.avatar_reset` | `profile.club_reset` | `profile.name_reset` | `profile.reports_dismissed` |

Журнал всех четырёх: `actor: { kind: 'user', userId }`, `subject: { kind: 'rider', id: userId, label:
riderSubjectLabel(userId) }` (D3), `targetUserId` не заполняется, `reason: body.reason`, `details: { reportCount:
closed }` (RC-P3). Ни клуба, ни имени, ни id фото в журнале и логах (лог — `profile <action> by <actor> reset=<bool>`,
как сейчас). Ответ: `{ reset }` / `{ dismissed }`; панель перечитывает карточку.

### 11.5 Перевыпуск id фото (RC-A2 (b))

`AvatarReissue.reissue(tx, userId, oldId, newId, now): Promise<string | null>`:

1. `avatars.findForCopy(tx, oldId, userId)` (новый метод `ProfileAvatarRepository`: полный документ по `{ _id,
   userId }`; ≤ 90 КБ). Нет (гонка удаления) → `profiles.replaceAvatarId(tx, userId, oldId, null, now)` → `null`.
2. `avatars.insert(tx, { ...doc, _id: newId })` (байты те же — AC8 «те же байты»; `createdAt` — прежний).
3. `profiles.replaceAvatarId(tx, userId, oldId, newId, now)` — `updateOne({ _id: userId, avatarId: oldId }, { $set:
   { avatarId: newId, updatedAt: now } })` (вторая запись того же документа в той же транзакции — допустимо).
4. `avatars.delete(tx, oldId, userId)`.

Где вызывается — «был публичен → стал нет» **без лишних чтений**:

- **`ProfileService.writeProfile`** уже читает `before = findProfile(userId, tx)` до `updatePublicName` (там есть
  `publicName`, `showNameInResults`, `avatarId` — `VIEW_PROJECTION`) и получает `after` (`returnDocument: 'after'`).
  Условие: `isPublicProfile(before) && !isPublicProfile(after) && after.avatarId` → `reissue(…, after.avatarId,
  newAvatarId)`; вернуть `{ ...after, avatarId: новый }` для `viewOf`. `newAvatarId = randomToken()` — в `update` до
  транзакции, рядом с кандидатом `publicId`; повтор при `isDuplicateKey('_id_')` использует тот же. Порядок:
  `updatePublicName` (первая запись) → событие согласия → перевыпуск.
- **`resetPublicName`**: фильтр уже гарантирует «имя было строкой», после — `publicName: null` (непублично всегда);
  было публично ⇔ `before.showNameInResults === true` из того же `findOneAndUpdate` (projection расширить) —
  дополнительного чтения нет. Сигнатура: `Promise<{ outcome: 'reset' | 'empty' | 'not_found'; avatarId: string |
  null; wasPublic: boolean }>`.
- Не вызывается: включение согласия, смена клуба/имени при сохранённой публичности, замена/удаление фото (уже новый
  id / 404), `avatar-reset`/`club-reset` (публичность не меняется), удаление аккаунта (`deleteAllOf`).
- Сторож `profile_avatars` (`profile.repository.test.ts`) не меняется: коллекцию по имени по-прежнему знают только
  `profile.collection.ts`, `ProfileAvatarRepository` и `0033`.

### 11.6 Чтения панели и стирание

- **Очередь** `ProfileModerationService.list(query)`: `decodeCursor(query.cursor, z.iso.datetime())` →
  `repository.reportQueue(after, limit + 1)` — `find({ $and: [{ openReportCount: { $gt: 0 } }, keyset $or по
  (lastReportAt, _id)] })`, sort `{ lastReportAt: -1, _id: -1 }`, `.hint('profiles_report_queue_idx')`, projection
  `publicName, showNameInResults, club, avatarId, openReportCount, lastReportAt` (образец
  `RoutesRepository.listPublicationQueue`) → `reports.topReasons(userIds)` (одна агрегация, ничья — порядок
  `PROFILE_REPORT_REASONS`) → строки: `name = isPublicProfile(doc) ? publicName : null` (Q2), `hasAvatar`, `hasClub`.
  Курсор — `encodeCursor(lastReportAt.toISOString(), userId)` (`_id` профиля — UUID, проходит `Uuid` курсора).
- **Карточка** `detail(userId)`: `repository.findForModeration(userId)` → нет — 404 → `reports.latest(userId)` (100,
  `_id: -1`) → ответ явным списком (без `reporterUserId`, `resolvedBy`). `club` и `avatar` — **всегда** (S-2), имя — по
  Q2, `isPublic = isPublicProfile(doc)`.
- **`ProfileErasure.erase`**: `reports.deleteForTarget(userId)` (`deleteMany({ targetUserId })`) → `verified.delete` →
  `avatars.deleteAllOf` → `deleteProfile`. Без транзакции, идемпотентно; жалоба, вставленная между шагами, — до
  удаления профиля (иначе `recordReport` не найдёт документ); сирота убирается повторным проходом
  (`account.deletion-sweep`). Жалобы, поданные удалённым, не трогаются. Сигнатура `erase` прежняя.
- **`ProfileReportsRepository`** (единственный писатель): `insert`, `openExists`, `closeOpen(tx, targetUserId,
  resolution, resolvedBy, now)` (`updateMany({ targetUserId, resolvedAt: null }, { $set: … })` → `modifiedCount`),
  `latest`, `topReasons`, `deleteForTarget`. Сторож `profile-reports.repository.test.ts` (образец
  `route-reports.repository.test.ts`): методы коллекции — только `insertOne`, `findOne`, `find`, `aggregate`,
  `updateMany`, `deleteMany`; `updateMany` — только с `resolvedAt: null`; имя коллекции знают только
  `profile-reports.collection.ts`, репозиторий и `0034`.

### 11.7 Панель (`apps/admin`)

- `src/features/rider-profiles/` (новая): `RiderProfilesScreen.tsx` (очередь: `PageHeader`, `DataTable` — подпись
  `riderLabel(userId, name)`, «Жалобы» (число), «Причина» (`domain.profileReportReason.*`), «Последняя» (`format.ts`),
  фото/клуб — признаки; «Показать ещё» — `useInfiniteQuery` как `RidesModerationScreen`; пусто — `EmptyState` «Жалоб
  нет»; скелетон — `DataTable`), `RiderProfileScreen.tsx` (карточка: фото `<img src={api.riderAvatarUrl(id)} alt=…>`
  в квадрате `var(--panel-avatar-preview)` или пустой квадрат той же раскладки; `StatusTag` «Публичный» / «Скрыт
  райдером»; клуб; список жалоб; четыре кнопки → `ReasonDialog` с `consequences` + предупреждением «Не повторяйте
  имя или клуб в причине» (D11); «Сбросить фото/клуб/имя» неактивны, когда нечего сбрасывать — по карточке, сервер
  всё равно отвечает `{ reset: false }`; «Отклонить жалобы» — при `openReportCount > 0`, шлёт `reportRevision`),
  `rider-profiles-query.ts` (ключи, инвалидация после действия), `rider-profiles-format.ts` (тексты ошибок: `CONFLICT`
  → `ConflictBanner` «Пришли новые жалобы, обновите карточку» с перечитыванием; 404 — «Профиль не найден»).
  Образец экранов — `features/rides-moderation`, `features/rider-routes` (RC-P5). «Сбросить имя» — существующий
  `api.resetRiderName`.
- `src/router.tsx`: `rider-profiles` и `rider-profiles/$userId` (`key={userId}`) под `RequirePermission
  permission="profiles.moderate"` (образец `rider-routes`, стр. 304–325). Поиска в URL нет (одна очередь).
- `src/navigation.ts`: `'/rider-profiles'` в union `to`; пункт `{ to: '/rider-profiles', labelKey:
  'admin.nav.riderProfiles', permission: 'profiles.moderate', group: 'bottom' }` — **в конец** массива с
  комментарием.
- `src/panel-tokens.ts`: `'avatar-preview': 128` (RC-P4); класс раскладки фото — в CSS панели рядом с прочими
  `--panel-*` (только переменная, без px).
- **CSP — правок нет:** API-клиент панели — тот же origin (`api.ts`: `baseUrl: ''`; dev/preview — прокси Vite `/v1`,
  стенд/прод — тот же домен), `img-src 'self' data: blob:` в `infra/docker/admin-nginx.conf` покрывает
  `/v1/avatars/:id`. `csp.test.ts` — добавить проверку `img-src` содержит `'self'` (сторож: фото модерации).
  Заголовок ответа аватара `CSP: default-src 'none'; sandbox` на `<img>` не влияет.
- `packages/i18n/src/ru.ts`: `admin.nav.riderProfiles` («Профили райдеров»), `admin.riderProfiles.*` (заголовок,
  колонки, состояния, действия, диалоги, предупреждение D11, ошибки), `domain.profileReportReason.*` (6 причин — их же
  возьмёт приложение в follow-up), `admin.audit.action.profile.{avatar_reset,club_reset,reports_dismissed}`
  (`AuditScreen` строит ключ шаблоном — без ключа не соберётся typecheck).

### 11.8 Security (checklist нужен: да — UGC, ПДн в панели, журнал, новый эндпоинт записи)

- **AuthN/AuthZ:** `riders/:publicId/{me,reports}` — `AuthGuard` + `@CurrentUser()`; панель — `PanelGuard` +
  `profiles.moderate` на классе (сторож `admin-routes.test.ts`); без права — 403, без сессии панели — 401.
- **Входные данные:** `RiderPublicId` pipe (400 на мусор), `Uuid` для `:userId`, тела — `strictObject`, комментарий —
  `optionalText(500, MULTI_LINE)`, причина — `ActionReason`; в фильтр Mongo — только примитивы после zod.
- **Оракулы:** непубличный и неизвестный `publicId` — один 404; `own_profile` раскрывает только «это вы».
- **Данные наружу:** жалобы в панели без `reporterUserId`/`resolvedBy`; имя — только при согласии (Q2); счётчики
  жалоб не выходят в `ProfileView`/публичный профиль.
- **Злоупотребления:** 20 жалоб/сут на пользователя, одна открытая на профиль; повтор не пишет.
- **Логи и журнал:** без имени, клуба, комментария, id фото и `userId` цели (D14); причина модератора — в журнале
  (D11, предупреждение в диалоге).
- **Перевыпуск id:** старый URL → 404 на сервере; кэш браузеров `immutable` — принятый риск (S-4).

### 11.9 Test matrix

| AC | Тест | Файл |
|---|---|---|
| 1 | int: 200 `{ canReport: false, reported: true }`; повтор — 200, в коллекции одна запись, `openReportCount = 1`; свой — 409 `PROFILE_INVALID_STATE` `own_profile`; непубличный (нет согласия, нет имени), неизвестный — 404; кривой `publicId` — 400; без входа — 401; 21-я за сутки — 429; неверная причина, комментарий 501 — 400; параллельные две жалобы одного пользователя — одна запись | `apps/api/src/modules/profile/profile-reports.int.test.ts` |
| 1 | int **гонка** «жалоба ↔ сброс» (отрицательное доказательство, образец `ride-reports.int.test.ts` «гонка Скрыть ↔ жалоба»): после обеих транзакций `openReportCount` = числу открытых жалоб | `profile-reports.int.test.ts` |
| 2 | int: `me` до/после жалобы; после «Отклонить» — снова `canReport`, вторая жалоба принимается (S-1); свой — `canReport: false`; непубличный — 404; без токена — 401 (а `GET /v1/riders/:publicId` без токена — 200) | `profile-reports.int.test.ts` |
| 3 | int: только профили с открытыми жалобами; порядок по `lastReportAt`, курсор (limit 1, две страницы), мусорный курсор — 400; `topReason` (ничья — порядок справочника); `name` только при согласии; 403 без права (организатор), 401 без сессии | `apps/api/src/modules/profile/rider-profiles-moderation.int.test.ts` |
| 4 | int: фото/клуб скрытого профиля видны, имя — `null`; `isPublic`; жалобы без `reporterUserId` (тест ключей); `reportRevision`; нет профиля — 404 | `rider-profiles-moderation.int.test.ts` |
| 5–6 | int: `avatar-reset` → старый `GET /v1/avatars/:id` 404, `GET /v1/profile` `avatar: null`, жалобы `actioned`, журнал (`subject.label = Участник ·…`, `details.reportCount`, в JSON записи нет клуба/имени/id фото), повтор — `{ reset: false }` без журнала и жалобы открыты; `club-reset` — так же; `name-reset` закрывает жалобы, `details.reportCount` | `rider-profiles-moderation.int.test.ts`, `apps/api/src/modules/profile/profile-admin.int.test.ts` |
| 7 | int: `dismiss-reports` → `dismissed`, профиль не изменён (`updatedAt` тот же); устаревший `reportRevision` (жалоба после чтения карточки) — 409 `CONFLICT`; открытых нет — `{ dismissed: false }` без журнала | `rider-profiles-moderation.int.test.ts` |
| 8 | int: отзыв согласия / очистка имени (`PATCH`) / сброс имени модератором → старый id 404, новый `avatar.id` в `GET /v1/profile` отдаёт те же байты (сравнение буферов), в `profile_avatars` один документ; включение согласия, смена клуба, смена имени при согласии — id тот же; непубличный → непубличный — id тот же | `apps/api/src/modules/profile/profile.int.test.ts` (PATCH), `profile-admin.int.test.ts` (сброс имени) |
| 9 | int: erasure цели — её жалобы удалены, чужие целы; жалобы удалённого жалобщика остались; повтор безопасен | `apps/api/src/modules/account/account-erasure.int.test.ts` |
| 11 | int миграции: индексы `profile_reports_open_unique` (unique + partial), `profile_reports_target_idx`, `profiles_report_queue_idx`; повтор; unit-сторож писателя `profile_reports` | `apps/api/src/db/migrations/migrations.int.test.ts`, `apps/api/src/modules/profile/profile-reports.repository.test.ts` |
| — | unit: `isPublicProfile` | `apps/api/src/modules/profile/profile.policy.test.ts` (новый) |
| — | contracts: `CreateProfileReportRequest` (причины, 500/501, управляющие), `RiderProfileViewer`, `ProfileStateDetails` (tolerant), панельные схемы (строгие enum, `reports ≤ 100`), `DismissRiderProfileReportsRequest`; порядок `ErrorCode`/`AUDIT_ACTIONS` (новые — в конце) | `packages/contracts/src/profile/{profile-report,profile-moderation}.schema.test.ts`, `common.test.ts`, `admin/audit.schema.test.ts` |
| — | api-client: пути и методы viewer/report (токен), 5 методов панели + `riderAvatarUrl` без запроса | `packages/api-client/src/rider-profile.test.ts`, `admin.test.ts` |
| 10 | admin: очередь (скелетон, пусто, «Показать ещё», подпись Q2), карточка (фото/пустой квадрат, статус, жалобы, 4 действия → `ReasonDialog` с предупреждением, 409 `CONFLICT` → баннер и перечитывание, 404); раздел скрыт без `profiles.moderate`; `img-src 'self'` | `apps/admin/src/features/rider-profiles/{RiderProfilesScreen,RiderProfileScreen}.test.tsx`, `apps/admin/src/layout/AppLayout.test.tsx`, `apps/admin/src/csp.test.ts` |
| — | arch: `pnpm arch:check` (нет новых рёбер), `admin-routes.test.ts` (новый `admin/*` с `PanelGuard`) | — |

Изоляция int-тестов — своя БД Mongo и свой Redis db (`MONGO_URL_TEST`, `REDIS_URL_TEST`).

### 11.10 Implementation Context (для coder)

- **ENTRY POINTS:** `apps/api/src/modules/profile/profile.module.ts`, `profile-moderation.service.ts`,
  `profile.service.ts`, `apps/api/src/db/migrations/index.ts`, `packages/contracts/src/index.ts`,
  `apps/admin/src/router.tsx`.
- **FILES TO MODIFY:** `apps/api/src/modules/profile/{profile.module,profile.collection,profile.repository,
  profile.service,profile.policy,profile-moderation.service,profile-avatar.repository,profile-erasure}.ts`;
  `apps/api/src/error-messages.ts`; `apps/api/src/db/migrations/{index,migrations.int.test}.ts`;
  `apps/api/src/modules/profile/{profile.int.test,profile-admin.int.test}.ts`,
  `apps/api/src/modules/account/account-erasure.int.test.ts`; `packages/contracts/src/{common,index}.ts`,
  `admin/audit.schema.ts`; `packages/api-client/src/{index,admin}.ts`; `packages/i18n/src/ru.ts`;
  `apps/admin/src/{navigation.ts,router.tsx,panel-tokens.ts,csp.test.ts}` (+ CSS панели для квадрата фото).
- **FILES TO CREATE:** `apps/api/src/modules/profile/{profile-reports.collection,profile-reports.repository,
  profile-reports.service,rider-reports.controller,rider-profiles-moderation.controller,avatar-reissue}.ts` + тесты
  (11.9); `apps/api/src/db/migrations/0034_profile_reports.ts`; `packages/contracts/src/profile/{profile-report,
  profile-moderation}.schema.ts` + тесты; `apps/admin/src/features/rider-profiles/*`.
- **FILES TO READ:** `routes/{route-reports.service,route-reports.repository,routes-moderation.service,
  routes-viewer.controller,routes-moderation.controller}.ts`, `routes/route-reports.repository.test.ts`,
  `rides/ride-reports.int.test.ts` (гонка), `routes/routes.repository.ts` (`recordRouteReport`,
  `listPublicationQueue`, `clearRouteReports`), `db/migrations/{0002_identity,0017_ride_reports,0033_rider_profile}.ts`,
  `src/page-cursor.ts`, `panel/index.ts` (`PanelAudit`, `AuditRecord`), `profile-avatar.service.ts` (транзакции фото),
  `apps/admin/src/features/{rides-moderation,rider-routes}/*`, `apps/admin/src/ui/{ReasonDialog,DataTable,
  ConflictBanner}.tsx`, `apps/admin/src/features/results/{results-format.ts,StandingsTable.tsx}` (`riderLabel`, сброс
  имени).
- **TYPES & SCHEMAS:** `ProfileDoc` (+3 поля), `ProfileReportDoc`, `ProfileReportResolution`, контракты 11.2,
  `AuditRecord['action']` (+3), `PROFILE_POLICY.reportLimit`.
- **OUT OF SCOPE:** `apps/app` (кнопка и экран жалобы — follow-up), модуль `riders`, `results`/`rides`/`routes`
  (только образцы), уведомления райдеру, CSP/nginx, `ProfileView` и публичные ответы.

### 11.11 Риски

- **R-P1. Конфликты транзакций с `PATCH /v1/profile`.** Жалоба теперь пишет документ профиля: частый `PATCH` цели и
  поток жалоб конфликтуют — `withTransaction` повторяет; нагрузка мала (20/сут на жалобщика).
- **R-P2. Копия фото в транзакции** — до ~90 КБ чтения и вставки внутри `PATCH`; в пределах лимитов транзакции
  MongoDB.
- **R-P3. Номер миграции** — `0034` свободен на 2026-10-28; перед PR `git fetch` и сверить `migrations/index.ts`.
- **R-P4. Порядок `ErrorCode` / `AUDIT_ACTIONS`** — при слиянии с параллельными ветками новые значения — в конец.

## 12. Outcome

### Часть API (coder, 2026-10-28)

- **Контракты:** `profile/profile-report.schema.ts` (`PROFILE_REPORT_REASONS`, `CreateProfileReportRequest`,
  `RiderProfileViewer`, `ProfileStateDetails`), `profile/profile-moderation.schema.ts` (очередь, карточка, тела и
  ответы действий; сбросы — алиасы схем сброса имени); `PROFILE_INVALID_STATE` и три действия журнала — в конце
  списков. api-client: `getRiderViewer`, `reportRider`; панель — `listRiderProfiles`, `getRiderProfile`,
  `resetRiderAvatar`, `resetRiderClub`, `dismissRiderProfileReports`, `riderAvatarUrl`.
- **API (`profile`):** `profile_reports` (коллекция, `ProfileReportsRepository` + сторож), `ProfileReportsService` +
  `RiderReportsController`, `RiderProfilesModerationController` + расширенный `ProfileModerationService` (`list`,
  `detail`, `resetName/Avatar/Club`, `dismissReports`), `AvatarReissue` (в `PATCH` и сбросе имени), `isPublicProfile` и
  `PROFILE_POLICY.reportLimit`, `ProfileErasure` стирает жалобы на пользователя, миграция `0034_profile_reports`.
- **Тесты:** unit — `profile.policy.test.ts`, `profile-reports.repository.test.ts`; int — `profile-reports.int.test.ts`
  (AC1–2, гонки), `rider-profiles-moderation.int.test.ts` (AC3–7), `profile.int.test.ts` и `profile-admin.int.test.ts`
  (AC6, AC8), `account-erasure.int.test.ts` (AC9), `migrations.int.test.ts` (AC11); contracts и api-client.
- **Проверка:** `TURBO_CONCURRENCY=1 pnpm check` (изолированные Mongo `pokatim_profmod_test`, Redis db 11) — зелёный:
  15/15 задач, api 156 файлов / 1693 теста, app 1749, admin 357, contracts 365, api-client 132. Ранние прогоны падали
  на таймаутах jest `apps/app` при load average ≈ 29 (разные тесты от прогона к прогону; отдельный прогон app — зелёный).
- **Не сделано (часть панели):** `apps/admin` (раздел «Профили райдеров»), `admin.riderProfiles.*`,
  `domain.profileReportReason.*`, `admin.nav.riderProfiles`, `--panel-avatar-preview`, `csp.test.ts`,
  `docs/product/admin-panel.md`, `.claude/rules/pokatim-web.md`.

### Часть панели (coder, 2026-10-28)

- **Панель:** `features/rider-profiles/` — `RiderProfilesScreen` (очередь «Открытые жалобы», `useInfiniteQuery` +
  «Показать ещё», пусто «Жалоб нет», скелетон и ошибка — `DataTable`), `RiderProfileScreen` (фото 128 px или пустой
  квадрат, подпись Q2, «Публичный» / «Скрыт райдером», клуб, жалобы без автора; четыре действия через `ReasonDialog`
  с предупреждением D11; 409 `CONFLICT` — `ConflictBanner` «Пришли новые жалобы, обновите карточку»; 404 — «Профиль не
  найден»), `rider-profiles-query.ts`, `rider-profiles-format.ts`; маршруты в `router.tsx` под `profiles.moderate`,
  пункт `NAVIGATION` в конце группы `bottom`; токен `--panel-avatar-preview`.
- **i18n:** `admin.nav.riderProfiles`, `admin.riderProfiles.*`, `domain.profileReportReason.*` (6 причин).
- **Тесты:** `RiderProfilesScreen.test.tsx` (6), `RiderProfileScreen.test.tsx` (10), `AppLayout.test.tsx` (меню
  admin/moderator, прямой URL организатора), `csp.test.ts` (`img-src 'self'`), `design-system.test.ts` (токен).
- **Документы:** `docs/product/admin-panel.md` (право, журнал, карта разделов, раздел «Профили райдеров»),
  `.claude/rules/pokatim-web.md` (раздел «Профили райдеров»).
- **Проверка:** `TURBO_CONCURRENCY=1 pnpm check` (Mongo `pokatim_profmod_test`, Redis db 11) — зелёный с первого
  прогона: 15/15 задач, admin 40 файлов / 375 тестов, api 1693, app 1749.
