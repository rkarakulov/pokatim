# «Свои», P1 — группа уведомлений `social`

Уровень: task3 (контракты, модуль `notifications`, worker push, приложение, service worker). Эпик —
`docs/tasks/2026-10-31-social-stage-0/task.md` (строка P1 таблицы §3.2, RC-1…RC-16); продукт — `docs/product/social.md`
K10, K13, `docs/product/notifications.md` N3/N4/N7/N10/N12; архитектура — ADR-0027 п. 6, ADR-0017. Образец — группа
«Достижения» (`docs/tasks/2026-10-31-achievements-push`).

## 1. Title

Инфраструктура уведомлений группы «Свои»: группа, настройки, действующие лица с именами при чтении, схлопывание.

## 2. Goal

Подготовить `notifications` к шести событиям K10 так, чтобы P7 только привязал события `social.*` к intake: имена
действующих лиц не хранятся в тексте (N12, K13), а подставляются при чтении списка и при отправке push; повтор
события копит действующих лиц в одном уведомлении («Катя Л. и ещё 2»).

## 3. Scope

1. **Contracts** (`notification.schema.ts`, только в конец перечислений — старые сборки):
   - группа `social` — последней в `NOTIFICATION_GROUPS`;
   - шесть видов: `social_riders_going`, `social_thanks`, `social_added`, `social_respect`,
     `social_invite_registered`, `social_ride_ask` — в конец `NOTIFICATION_KINDS`;
   - цель `rider` (`{ type: 'rider', publicId: RiderPublicId }` → `/riders/<publicId>`) — в конец
     `NotificationTarget`; остальные цели группы — существующие `ride`, `race`, `my-route`;
   - подресурс `GET|PUT /v1/notifications/settings/social` — `SocialNotificationSettingsView { push }` (ответ терпит
     новые ключи) и строгий `UpdateSocialNotificationSettings`; по умолчанию включено, без наследования (как
     «Достижения»).
2. **API, модуль `notifications`:**
   - `NotificationDoc` += `actors: userId[]` и `params` (данные для текста без имён: название райда / гонки /
     маршрута и т. п.); старые документы — без полей (чтение терпит отсутствие);
   - для группы `social` `title`/`body` собираются **при чтении** (`GET /v1/notifications`) и **при отправке push**
     из текущих публичных имён `RIDER_NAMES.publicRiders`; нет публичного профиля или аккаунт удалён — «Райдер»;
     цель `rider` тоже разрешается при чтении/отправке (последний действующий с публичным профилем → его `publicId`;
     нет такого — `target: null`, push открывает центр);
   - создание и схлопывание социального уведомления: ключ схлопывания по таблице K10 (на райд; в сутки по Минску;
     на цель в сутки), повтор с новым действующим лицом — `$addToSet` в `actors`, уведомление снова непрочитано и
     поднимается наверх (N7); повтор того же лица ничего не меняет;
   - точка входа для P7 — метод/порт создания социального уведомления (вызывает intake в P7); правки
     `notification-intake.ts`, `notification-texts.ts`, `notifications.policy.ts` в этом PR — только инфраструктура
     (эпик §3.2);
   - фильтр push по тумблеру `social`, тихие часы, лимит 20/ч и сводка — как у остальных групп;
   - стирание: уведомления, настройки и отложенные push удалённого стираются как сейчас; в чужих уведомлениях id
     удалённого остаются и читаются как «Райдер» (K10, K13).
3. **Приложение:** строка «Свои» последней на экране «Настройки уведомлений» (`/settings/notifications`) — тумблер
   push, подресурс `settings/social`; цель `rider` в `notificationTargetPath`; иконка/подпись группы и вида в строке
   центра — по образцу «Достижений».
4. **Service worker** (`apps/app/scripts/service-worker.ts`): копия белого списка целей += `rider`.
5. **Документы:** `notifications.md` (N3 тексты v1 для шести видов, N4, N10 — цель `rider`, «Где в продукте»),
   ADR-0027 п. 6 / ADR-0017 — уточнения по факту, правила `pokatim-backend.md`, `pokatim-db.md`,
   `pokatim-contracts.md` — если меняются формулировки.

### Тексты v1 (заголовок / тело)

`{имена}` — `publicName` самого свежего действующего лица с публичным профилем (нет — «Райдер»), при нескольких —
«{имя} и ещё N» (N — остальные действующие лица, включая непубличных).

| Вид | Заголовок | Тело | Цель | Схлопывание |
|---|---|---|---|---|
| `social_riders_going` | Свои идут | {имена} · «{райд}» | `ride` | на райд |
| `social_thanks` | Спасибо за компанию | {имена} · «{райд}» | `ride` | на райд |
| `social_added` | Вас добавили в свои | {имена} | `rider` | в сутки |
| `social_respect` | Респект | {имена} · «{гонка или маршрут}» | `race` / `my-route` | на цель в сутки |
| `social_invite_registered` | По вашей ссылке зарегистрировались | {имена} | `rider` | в сутки |
| `social_ride_ask` | Как прошёл райд? | «{райд}»: отметьте, что были. | `ride` | на райд |

## 4. Out of Scope

- Привязка событий к intake (кто, когда, аудитория «Свои идут», регламент «Как прошёл райд?») — P7.
- Эндпоинты и экраны `social` (P2–P6), экран «Свои» (P3).
- E-mail группы «Свои» (N4 — только push).
- Удаление id стёртого райдера из чужих `actors` (K10: читается как «Райдер»).

## 5. Architecture Context

Architect, 2026-10-31 (сверено с кодом `origin/develop` в ветке). Статус ревью — **CONCERNS** (блокеров нет; RC-1…RC-14
§8.1 — рекомендации, coder идёт по ним).

- **Приложения и слои.** `packages/contracts` (схема уведомлений) → `packages/api-client` (2 метода) →
  `apps/api/src/modules/notifications` (policy, repository, intake-инфраструктура, fanout, service, settings, push) →
  `apps/app` (экран настроек, `notificationTargetPath`, service worker) → `packages/i18n` (одна строка). Новых пакетов
  и модулей нет; `social` в P1 не трогается.
- **Как устроено сейчас.** Текст — снимок при приёме (`renderDraft` → `writeRecipients` → `writeNotices`); схлопывание
  N7 — условная **замена** документа по `(userId, collapseKey)` и `collapseSeq` (индекс `notifications_collapse_unique`,
  частичный по `collapseKey: string`, миграция `0025`). Push берёт `title/body/target` из документа в момент
  захвата (`claimPush` → `contentOf`): одно — его текст, несколько — сводка без имён.
- **Что меняется.** Третий режим записи — **накопление** (RC-1): документ с `actors` схлопывается не заменой, а
  `$push` нового действующего лица под условием «его ещё нет»; создающее событие (`sourceEventId`) и состояние
  доставки не меняются → повтор в окне push не ставит (п. 8). Для группы `social` `title/body/target` в ответе
  списка и в push собираются из `actors` + `params` + `RIDER_NAMES.publicRiders` (RC-3…RC-5); в документе остаётся
  безымянный запасной текст (N12 для хранения сохраняется).
- **Зависимости.** `NotificationsModule` (HTTP) и `NotificationsWorkerModule` получают Nest-импорт `ProfileCoreModule`
  (порт `RIDER_NAMES`); `NotificationsCoreModule` — без изменений (его импортирует `account`). Импорта `social` в P1
  нет (RC-8): аудитория «Свои идут» и прочие порты `social` — P7. dependency-cruiser: ребро `notifications → profile`
  уже есть (через `profile/index.ts`), циклов нет (`profile` не зависит от `notifications`); правило
  `social-consumers-only` не затрагивается.
- **Данные.** Миграции нет (RC-6): поля `actors?`, `params?` — аддитивные, старые документы без них; уникальность
  окна — существующий `notifications_collapse_unique`, список — `notifications_user_list_idx`.
- **Совместимость.** Справочники — только в конец; старые сборки: вид/группа → `unknown`, цель `rider` → `unknown`
  (без перехода), текст — готовая строка сервера; экран настроек старой сборки «Свои» не видит (по умолчанию включено);
  старый service worker — незнакомая цель → центр. Новая сборка со старым API: `settings/social` → 404 → блока нет
  (`isSettingsResourceMissing`).
- **Безопасность.** Зона — `pokatim-security.md` «Уведомления и push» (N12 получает исключение) → чек-лист обязателен
  (п. 5.2).

## 5.1 Placement & Reuse Gate

- Переиспользуем: `writeNotices`/`isRepeatOrStale` и индекс `notifications_collapse_unique` (не новый индекс);
  `writeRecipients` + `initialDelivery` (одна точка сборки документа для прямого пути и пачки); `planFanout` /
  `FanoutJobData` (аудитория «Свои идут» > 200 — пачки); `eventTimeOf` (`event-time.ts`) + `minskToday`
  (`@pokatim/contracts` `time.ts`) для окна «в сутки»; `RIDER_NAMES.publicRiders` (`PublicRiderCard { name, publicId }` —
  уже фильтрует согласие); подресурс настроек — копия `achievements` (`settingsOnInsert`, `consumeUserLimit`
  `notifications-settings`); `PushOnlyGroup` и `isSettingsResourceMissing` на экране; `RiderPublicId` (контракт) в цели.
- Запрещено: читать `profiles` из `notifications` напрямую; хранить имена в `title/body/params`; хранить `publicId` в
  `target` социального документа (RC-4); второй механизм рендера push (только `contentOf`); новый DI-порт «создать
  социальное уведомление» (RC-9); `$addToSet` без условия на отсутствие лица (RC-1); импорт `social` в P1.
- Новый файл — `apps/api/src/modules/notifications/social-notices.ts` (чистые функции группы: таблица видов, ключ
  окна, сборка черновика, рендер с именами, цель): не раздувает `notification-texts.ts`/`notification-intake.ts`,
  которые P7 тоже правит.

## 5.2 Security checklist

- **AuthN/AuthZ:** `GET|PUT settings/social` — `AuthGuard`, `userId` сессии в фильтре; список — только свои (как
  сейчас). Клиент `actors`/`params`/имена не присылает — сервер их пишет из событий (P7).
- **Входные данные:** `UpdateSocialNotificationSettings` — `strictObject({ push })`; `params` внутри API — zod
  (`SocialNoticeParams`, длина названия ограничена), чтение терпит битое (запасной текст).
- **Данные наружу:** имя и `publicId` — только из `publicRiders` (имя + `showNameInResults`); непубличный и удалённый —
  «Райдер», без ссылки; `userId` действующих лиц в ответ и push не попадает. «и ещё N» раскрывает число действий
  непубличных — принято (K3). Имя в push остаётся на устройстве — принятый риск (K10).
- **Злоупотребления:** длина `actors` ≤ `SOCIAL_ACTORS_MAX` (RC-2) — документ и `$in` имён ограничены; лимит 20 push/ч
  и тумблер — общие.
- **Секреты и логи:** в логах — id и счётчики, без имён (`notifications.push … count=`); имена не логируются.
- **Аудит:** не ведётся (уведомления — не история решений).

## 8. Risks / Assumptions / Open Questions

- Решение автора 2026-10-31: «Вас добавили в свои» и «По вашей ссылке зарегистрировались» ведут на профиль
  человека (`/riders/<publicId>` последнего действующего лица с публичным профилем, разрешается при чтении).
- `[ASSUMPTION]` Push — только при создании уведомления (первое действующее лицо в окне схлопывания); новые лица в
  том же окне обновляют строку центра (непрочитана, наверху) без повторного push — «одно на райд / в сутки» (K10).
- `[ASSUMPTION]` «В сутки» — по календарному дню Europe/Minsk момента события.
- Имя в push остаётся на устройстве — принятый риск (K10).
- Чтение списка — один `publicRiders` на страницу (до 50 уведомлений), не N+1.
- Параллельно идут P2, P3, P6: общие файлы — только добавления в конец списков.

## 8.1 Requirements Consistency (заполняет architect)

Architect, 2026-10-31. Статус — **CONCERNS**: противоречий с инвариантами нет, блокеров нет; ниже — уточнения формы и
поведения, которых спек не задаёт. Рекомендация по каждому пункту принимается по умолчанию (решение автора не нужно),
кроме явно помеченных «на подтверждение».

- **RC-1 (HIGH) — механика схлопывания с накоплением.** Спек: «`$addToSet` в `actors`, снова непрочитано, наверх;
  повтор того же лица ничего не меняет». Голый `$addToSet` + `$set { readAt: null, createdAt }` нарушает второе: `$set`
  применится и при повторе лица (прочитанное снова станет непрочитанным). Текущая замена по `collapseSeq` тоже не
  подходит (она перезаписывает документ). Варианты: (a) **условный upsert**: фильтр `{ userId, collapseKey, actors:
  { $ne: actor }, 'actors.<MAX−1>': { $exists: false } }`, `update = { $push: { actors: actor }, $set: { createdAt:
  now, readAt: null, expireAt, params, title, body }, $setOnInsert: { _id, sourceEventId, kind, group, target, push,
  email } }`, `upsert: true`; дубль любого уникального индекса (`collapse_unique` — гонка первой вставки или лицо уже
  есть; `event_user_unique` — повтор задачи) → один повтор **без upsert** с тем же фильтром (найдёт документ гонщика и
  добавит лицо, либо ничего — лицо уже есть / повтор). (b) pipeline-update с `$setUnion`/`$cond` — атомарно, но без
  `$setOnInsert`, сложнее и в `bulkWrite` с upsert хрупко. (c) документ на лицо + группировка при чтении — ломает
  счётчик непрочитанных, курсор и push. **Рекомендация — (a).** `$push` вместо `$addToSet` (отсутствие гарантирует
  фильтр; порядок = порядок добавления, нужен для «самого свежего»). `sourceEventId` и `push`/`email` — только
  `$setOnInsert`: создающее событие неизменно, поэтому `scheduleEvent(eventId)` второго события ничего не находит —
  повтор в окне без push (п. 8) без отдельного флага. Одно действующее лицо на черновик (`NoticeDraft.actor`).
- **RC-2 (MEDIUM) — длина `actors` не ограничена.** «В сутки» и «на райд» копят без предела; рендер страницы делает
  `$in` по объединению лиц до 50 документов. Варианты: (a) **потолок `SOCIAL_ACTORS_MAX = 100`** (= `RIDE_MAX_PARTICIPANTS`)
  в фильтре (RC-1a): полный документ больше не меняется, «и ещё N» перестаёт расти; (b) отдельный счётчик
  `actorCount` + усечённый список — точное N, но второе поле и `$inc` под тем же условием; (c) без потолка. **Рекомендация
  — (a)**: практические окна (райд ≤ 100 участников, «добавили в свои» за сутки) в него укладываются; `$in` ≤ 5000 id.
- **RC-3 (MEDIUM) — что хранится в `title/body` социального документа.** Спек: «собираются при чтении», но поля
  обязательны в `NotificationDoc`, их читают `ClaimedEmail`/`fanout`. **Рекомендация:** хранить безымянный запасной
  текст той же таблицы с подстановкой «Райдер» без «и ещё N» (`renderNotification` для социального `NoticeText`,
  `$set` при каждом накоплении). Он нужен, только если рендер с именами не смог (битые `params`, вид без правила);
  N12 для хранения соблюдается. Письма группе нет (не в `EMAIL_KINDS`).
- **RC-4 (MEDIUM) — где хранится цель `rider`.** Варианты: (a) **в документе `target: null`, цель выводится по виду**
  (`SOCIAL_NOTICE_KINDS[kind].target === 'rider'`) из того же лица, чьё имя показано: его `publicId` из
  `publicRiders`; нет публичного лица или у него `publicId: null` (профиль до бэкфилла) — `target: null`;
  (b) хранить `{ type: 'rider', publicId }` снимком — `publicId` отзываем (комментарий `riders/[id].tsx`), после стирания
  ссылка вела бы в 404, и «последнее лицо» меняется при накоплении; (c) новый внутренний тип цели `rider-actor` —
  засоряет контрактный `NotificationTarget`. **Рекомендация — (a).** Цели `ride`/`race`/`my-route` хранятся как
  сейчас. Имя и ссылка — всегда одного лица (иначе «Катя» вела бы на Петю).
- **RC-5 (MEDIUM) — push в момент отправки, тихие часы и сводка.** Отложенный push (тихие часы, ретрай) собирается в
  момент реальной отправки — поэтому имена берутся в `PushDelivery`, а не при записи. **Рекомендация:** `claimPush`
  проецирует ещё `kind`, `actors`, `params`; `contentOf` остаётся единственной точкой: несколько — сводка без имён
  (как сейчас, имена не запрашиваются), одно социальное — `renderSocialNotice` с картами `publicRiders([...actors])`
  (один вызов на задачу). Следствие (желательное): лицо, добавленное, пока push ждал конца тихих часов, попадёт в его
  текст («Катя и ещё 1»). Тумблер, тихие часы, лимит 20/ч — без изменений, по `group: 'social'`.
- **RC-6 (LOW) — индекс и миграция.** Новый индекс не нужен: окно — `(userId, collapseKey)` существующего частичного
  `notifications_collapse_unique`; запрос по `actors` не выполняется (условие `$ne` — в документе, найденном по
  уникальному ключу). Поля аддитивные — миграции нет (`pokatim-db.md` дополняется описанием полей).
- **RC-7 (LOW) — окно «в сутки».** Спек: «по календарному дню Europe/Minsk момента события». **Рекомендация:** день —
  `minskToday(eventTimeOf(eventId))` (uuidv7 события outbox), не `CLOCK` приёма: ретрай задачи после полуночи не
  открывает новое окно. Ключи: `social:going:<rideId>`, `social:thanks:<rideId>`, `social:added:<YYYY-MM-DD>`,
  `social:respect:<race|route>:<id>:<YYYY-MM-DD>`, `social:invite:<YYYY-MM-DD>`, `social:ask:<rideId>` — префикс
  `social:` не пересекается с `ride:`/`route:`/`profile:`/`achievement:`.
- **RC-8 (LOW) — зависимость `notifications → social`.** ADR-0027 «Последствия» говорит о Nest-импорте `social` и
  `profile`. В P1 нужен только `profile` (`RIDER_NAMES`); импорт `social` (порт аудитории) — в P7, когда появится
  потребитель (инвариант §4.9 «нет на вырост»). Строку `pokatim-backend.md` «без Nest-импорта `ProfileCoreModule`»
  переписать: импорт есть в `NotificationsModule` и `NotificationsWorkerModule`, не в ядре.
- **RC-9 (MEDIUM) — точка входа для P7.** «Метод/порт» не определён. Intake живёт внутри `notifications`, поэтому
  DI-порт не нужен. **Рекомендация:** P1 даёт (1) `NoticeDraft.actor?: string` и социальный вариант `NoticeText`
  (`{ kind: SocialNoticeKind; object?: string }`); (2) чистый конструктор `socialNoticeDraft({ kind, eventId, actor,
  recipients, object })` в `social-notices.ts` — ключ окна, цель, текст; (3) `RenderedDraft.social` и
  `FanoutJobData.social?: { actor, params }` (необязательное — уже поставленные задачи читаются). P7 только добавляет
  маршруты `social.*` в `notificationsOutboxRoutes`, `case` в `NotificationIntake.drafts` и порт `SOCIAL_NOTICES` в
  `social`. Проверка P1 без P7 — через реальный путь задачи `notifications.fanout` и `writeNotices` (int, §11).
- **RC-10 (LOW) — «Как прошёл райд?» без действующих лиц.** У `social_ride_ask` нет `{имена}` и цель — `ride`.
  **Рекомендация:** обычный снимок без `actors` со схлопыванием `social:ask:<rideId>`, `seq: 1` (существующая замена:
  повтор того же окна — без изменений, второго push нет). Рендер с именами для него не вызывается.
- **RC-11 (LOW) — иконка/подпись группы в строке центра (§3 п. 3).** В `NotificationRow` иконок и подписей групп нет ни у
  одной группы, «Достижения» их не добавляли — образца нет. **Рекомендация:** вычеркнуть из P1 (строка показывает
  текст сервера); иконки групп — отдельная задача для всех групп через дизайн-систему (инвариант 11).
- **RC-12 (LOW) — `params`.** Форма не задана. **Рекомендация:** внутренний zod `SocialNoticeParams =
  z.object({ object: z.string().max(200) }).partial()` — только название объекта (райд, гонка, маршрут), снимок; `$set` при
  накоплении (последнее название). Без id пользователей и свободного JSON; не в contracts (наружу не уходит).
- **RC-13 (LOW) — «самое свежее лицо».** При обработке событий не по порядку (ретрай старшего после младшего) «свежим»
  станет добавленный последним, а не сделавший действие позже. Принять: порядок `actors` — порядок записи; уход лица из
  райда / удаление из своих после уведомления лиц из `actors` не убирает (P7 решает, слать ли событие).
- **RC-14 (LOW) — правило безопасности N12.** `pokatim-security.md` («Тексты push и писем — без чужих ПДн») и
  комментарий `NotificationView` («снимок текста») противоречат K10 после P1. Поправить формулировки в этом PR:
  исключение — группа «Свои», имя только через `RIDER_NAMES.publicRiders`.

Предположения спека (п. 8) подтверждаются кодом: push только при создании следует из RC-1a без доп. состояния;
«один запрос имён на страницу» — объединение `actors` социальных документов страницы → один `publicRiders`.

**Решения оркестратора (2026-10-31):** RC-1…RC-14 — по рекомендациям architect. RC-11: иконка и подпись группы в
строке центра из Scope п. 3 убраны (образца нет ни у одной группы).

## 8.2 Отклонения при реализации (coder, 2026-10-31)

- `SOCIAL_NOTICE_KINDS[kind].target` — `'object' | 'rider'` (не `'ride' | 'race' | 'my-route' | 'rider'`): у
  `social_respect` цель зависит от объекта (гонка → `race`, маршрут → `my-route`), её строит `socialNoticeDraft` по
  `object.type`. В правило вида добавлены `title`, `objectInBody`, `slug` (часть ключа окна).
- `socialNoticeDraft` возвращает структурный `SocialNoticeDraft` (`social-notices.ts`), а не импортирует `NoticeDraft`
  из `notification-intake.ts`: type-импорт дал цикл `notification-intake → notification-texts → social-notices →
  notification-intake` (`no-circular`, `pnpm arch:check`). Совместимость с `NoticeDraft` держит компилятор (int-тест
  передаёт черновик в функцию с параметром `NoticeDraft`).
- Заголовки шести видов и запасной текст — в `social-notices.ts` (`SOCIAL_NOTICE_KINDS[kind].title`,
  `socialFallbackText`); `notification-texts.ts` для социального `NoticeText` делегирует туда, `TITLES` —
  `Exclude<…, 'achievement_granted' | SocialNoticeKind>`. `quoted`/`oneLine` перенесены в `social-notices.ts` и
  импортируются в `notification-texts.ts` (одна копия, без цикла).
- Повтор без upsert после дубля: для документа накопления — на дубль любого уникального индекса (RC-1a), для замены
  по `collapseSeq` — как раньше, только `notifications_collapse_unique`.
- RC-11: иконка и подпись группы в строке центра не делались (решение оркестратора).
- Ревью pass 1 (findings.md, MEDIUM): сбой `publicRiders` в push — `try/catch` в `PushDelivery.socialCards`, при
  сбое уходит запасной текст документа («Райдер», цель `null`), лог `notifications.push_names_failed uid error=<класс>`.
  Перенос запроса до списания лимита не выбран: исключение после `claimPush` всё равно оставило бы документ в
  `sending` до конца аренды; запасной текст (RC-3) доставляет push сразу и лимит не списывается повторно.
- Ревью pass 1 (LOW): `socialParamsOf` сам держит одну строку и потолок 200 (черновик в обход `socialNoticeDraft` не
  ломает пачку `FanoutJobData`).

## 9. Acceptance Criteria

1. Contracts: `social` последней в группах, шесть видов и цель `rider` в конце; старая схема (без них) разбирает
   новый ответ (`unknown`, без перехода) — тест совместимости по образцу achievements.
2. `GET|PUT /v1/notifications/settings/social`: по умолчанию `{ push: true }`, PUT строгий (лишний ключ — 400), только
   свои; выключенный тумблер — push группы не уходит, в центре уведомление есть.
3. Социальное уведомление создаётся с `actors` и `params`; повтор с новым лицом в окне — один документ, `actors`
   без дублей, снова непрочитано и наверху; повтор того же лица — без изменений; новое окно (другой день / райд) —
   новый документ. Гонка двух параллельных повторов — один документ, оба лица (уникальный ключ / upsert).
4. Чтение списка: тексты таблицы v1 с текущими публичными именами; смена имени видна в уже созданном уведомлении;
   непубличный / удалённый — «Райдер»; цель `rider` → `publicId` публичного лица или `null`; один запрос имён на
   страницу.
5. Push: текст собирается на момент отправки с текущими именами; цель `rider` разрешена; тумблер, тихие часы,
   сводка — как у остальных групп; на повтор в окне push нет (п. 8).
6. Приложение: строка «Свои» последней в настройках, переключение пишет `settings/social`; цель `rider` → профиль;
   service worker открывает `/riders/<publicId>`, незнакомое — центр.
7. Стирание аккаунта — без регрессий; уведомление другого с id стёртого читается «Райдер».
8. `pnpm check` зелёный.

## 10. Documentation Impact

`notifications.md` (N3 тексты, N4, N10, «Где в продукте»), ADR-0027 п. 6 (при уточнениях), правила `pokatim-*.md`
по факту, `pr.md`.

Architect — конкретно:
- `docs/product/notifications.md`: N3 — шесть событий «Свои» (кому — ссылка на K10, «повтор в окне — строка снова
  непрочитана, без push»); «Тексты v1» — шесть строк таблицы §3 + правило «{имя} и ещё N» / «Райдер»; N7 — накопление
  вместо замены для «Свои»; N10 — цель `rider` → `/riders/<publicId>` (нет публичного лица — центр); N12 — исключение
  K10 (имена при чтении и в push); «Где в продукте» — «Свои» в настройках последней. N4 уже содержит «Свои» — сверить.
- `docs/adr/0027-social-connections.md` п. 6: условный `$push` вместо `$addToSet` (RC-1), потолок (RC-2), создающее
  событие неизменно → push только при создании, цель `rider` выводится при чтении (RC-4), окно — день события по
  Минску (RC-7); «Последствия» — Nest-импорт `social` в P7, `profile` — в P1 (RC-8).
- `docs/adr/0017-notifications-and-push.md`: строка-отсылка «текст — снимок, кроме группы «Свои» (ADR-0027 п. 6)».
- `.claude/rules/pokatim-backend.md` («Уведомления»): `ProfileCoreModule` в HTTP- и worker-модуле, режим накопления
  `writeNotices`, `social-notices.ts`, рендер в `NotificationsService.list` и `contentOf`, подресурс `settings/social`
  (`push.social`, нет поля — включено), `FanoutJobData.social`.
- `.claude/rules/pokatim-db.md` («Уведомления»): `actors?`, `params?`, `push.social?` — без миграции, окно — тот же
  `notifications_collapse_unique`.
- `.claude/rules/pokatim-contracts.md` («Уведомления»): P1 — группа `social`, шесть видов, цель `rider`
  (`RiderPublicId`), `SocialNotificationSettingsView`/`UpdateSocialNotificationSettings`/
  `DEFAULT_SOCIAL_NOTIFICATION_SETTINGS`, api-client `getSocialNotificationSettings`/`updateSocialNotificationSettings`.
- `.claude/rules/pokatim-security.md` («Уведомления и push»): исключение N12 для «Свои» (RC-14).
- `.claude/rules/pokatim-app.md` — если там перечислены цели `notificationTargetPath`/копия в service worker.

## 11. Implementation Context

Architect, 2026-10-31. Порядок: contracts → api-client → API (policy → social-notices → repository → fanout/intake →
service/settings/controller → push) → app → docs.

### ENTRY POINTS

- `GET /v1/notifications` — `NotificationsService.list` (рендер «Свои» с именами).
- `GET|PUT /v1/notifications/settings/social` — `NotificationsController` → `NotificationSettingsService.getSocial/putSocial`.
- Worker: `NotificationsIntakeProcessor.writeRecipients` (прямой путь и `notifications.fanout`) →
  `NotificationsRepository.writeNotices` (режим накопления); `PushDelivery.deliver` → `contentOf`.
- Для P7: `socialNoticeDraft(...)` (`social-notices.ts`) → `NoticeDraft` из `NotificationIntake.drafts` (в P1 —
  без вызова из intake).

### FILES TO CREATE

- `apps/api/src/modules/notifications/social-notices.ts` — `SOCIAL_NOTICE_KINDS` (вид → `{ target: 'ride' | 'race' |
  'my-route' | 'rider'; window: 'object' | 'day' | 'object-day'; actors: boolean }`, `satisfies Record<SocialNoticeKind,
  …>`), `SOCIAL_ACTORS_MAX = 100`, `SocialNoticeParams` (zod), `socialCollapseKey`, `socialNoticeDraft`,
  `renderSocialNotice`, `socialActorIds(docs)`.
- `apps/api/src/modules/notifications/social-notices.test.ts`.

### FILES TO MODIFY

- `packages/contracts/src/notifications/notification.schema.ts` — в конец: `'social'` в `NOTIFICATION_GROUPS`; шесть
  видов в `NOTIFICATION_KINDS` (порядок таблицы §3); `z.object({ type: z.literal('rider'), publicId: RiderPublicId })`
  последним в `NotificationTarget` (импорт из `../profile/rider-avatar.schema.ts`, проверить отсутствие цикла импорта);
  `SocialNotificationSettingsView = z.object({ push })`, `UpdateSocialNotificationSettings = z.strictObject({ push:
  Toggle })`, `DEFAULT_SOCIAL_NOTIFICATION_SETTINGS = { push: true }`; комментарий `NotificationView` (RC-14).
- `packages/contracts/src/notifications/notification.schema.test.ts`; `packages/contracts/src/index.ts` — только если
  экспорт не через `export *` (добавления — в конец).
- `packages/api-client/src/index.ts` (+ `notifications.test.ts`) — `getSocialNotificationSettings`,
  `updateSocialNotificationSettings` (копия achievements, в конец блока уведомлений).
- `apps/api/src/modules/notifications/notifications.policy.ts` — `SOCIAL` в деструктуризации групп, шесть видов в
  `KIND_GROUPS`, `DEFAULT_DELIVERY_SETTINGS.push.social`, `DeliverySettings.email` — `Exclude<…, 'social'>`,
  `initialDelivery` — `group === SOCIAL` → `email: null`.
- `apps/api/src/modules/notifications/notifications.collection.ts` — `NotificationDoc.actors?: string[]`, `params?:
  SocialNoticeParams`; `NotificationSettingsDoc.push.social?: boolean`; комментарии.
- `apps/api/src/modules/notifications/notifications.repository.ts` — `deliverySettingsOf`: `social: doc.push.social ??
  true`; `saveSocialSettings`; `list` и `claimPush` проецируют `kind`, `actors`, `params`; `ClaimedPush` += `kind`,
  `actors`, `params`; `writeNotices` — ветка накопления (RC-1a) для документов с `actors`.
- `apps/api/src/modules/notifications/notification-texts.ts` — социальный вариант `NoticeText`, `TITLES` для шести
  видов (`Record<Exclude<NotificationKind, 'achievement_granted'>, string>` иначе не соберётся), `bodyOf` — запасной
  текст (RC-3); общий хелпер `quoted` переиспользовать из `social-notices.ts` (экспорт, не копия).
- `apps/api/src/modules/notifications/notification-intake.ts` — только тип: `NoticeDraft.actor?: string`. Новых `case` нет.
- `apps/api/src/modules/notifications/notification-fanout.ts` — `RenderedDraft.social?: { actor: string; params:
  SocialNoticeParams }`, перенос в `planFanout`.
- `apps/api/src/modules/notifications/notifications.events.ts` — `FanoutJobData.social: z.object({ actor: z.uuid(),
  params: SocialNoticeParams }).optional()`.
- `apps/api/src/modules/notifications/notifications-intake.processor.ts` — `processChunk` переносит `social`;
  `writeRecipients` пишет `actors: [actor]`, `params` (без `collapseSeq`).
- `apps/api/src/modules/notifications/notifications.service.ts` — `@Inject(RIDER_NAMES)`; `list`: один
  `publicRiders(socialActorIds(page))` (пусто — без запроса), `viewOf(doc, cards)`.
- `apps/api/src/modules/notifications/push-delivery.ts` — `@Inject(RIDER_NAMES)`; `contentOf` для одного социального
  документа — `renderSocialNotice`.
- `apps/api/src/modules/notifications/notification-settings.service.ts`, `notifications.controller.ts` — подресурс
  `settings/social` (объявить до `:id/read`, `no-store`, `ZodValidationPipe(UpdateSocialNotificationSettings)`).
- `apps/api/src/modules/notifications/notifications.module.ts` — `ProfileCoreModule` в `imports` `NotificationsModule` и
  `NotificationsWorkerModule` (не в `NotificationsCoreModule`); комментарии.
- `packages/i18n/src/ru.ts` — `'notifications.settings.group.social': 'Свои'` (в конец).
- `apps/app/src/features/notifications/queries.ts` — `useSocialNotificationSettings`, `useUpdateSocialNotificationSettings`
  (ключ `['notifications', 'settings', 'social']`).
- `apps/app/src/app/settings/notifications.tsx` — `SocialGroup` (через `PushOnlyGroup`) после `AchievementsGroup`.
- `apps/app/src/features/notifications/notification-target.ts` — `case 'rider': return \`/riders/${value.publicId}\``.
- `apps/app/scripts/service-worker.ts` — `case 'rider'`: `typeof target.publicId === 'string' &&
  /^[A-Za-z0-9_-]{43}$/.test(...)` → `'/riders/' + publicId` (копия `OpaqueToken`, паритет — тест).
- Документы и правила — §10.

### FILES TO READ

- `apps/api/src/modules/notifications/{notifications.repository.ts,notifications-intake.processor.ts,
  notification-fanout.ts,push-delivery.ts,notifications.service.ts,notifications.policy.ts,event-time.ts}`.
- `apps/api/src/modules/profile/{rider-names.port.ts,rider-names.ts}`, `profile.repository.ts` `findPublicRiders`.
- `apps/api/src/db/migrations/0025_notifications.ts` (индексы), `packages/contracts/src/time.ts` (`minskToday`).
- Образец: `docs/tasks/2026-10-31-achievements-push/task.md`, `notifications.int.test.ts` (settings/achievements),
  `notifications-delivery.int.test.ts`, `notifications-intake.int.test.ts` (fanout), `notification.schema.test.ts`
  (совместимость старой схемы), `apps/app/src/__tests__/notifications.test.tsx`, `notification-target.test.ts`.
- `.claude/rules/{pokatim-backend,pokatim-db,pokatim-contracts,pokatim-security,pokatim-tests,pokatim-app}.md`.

### TYPES & SCHEMAS

```ts
// contracts
NOTIFICATION_GROUPS += 'social'
NOTIFICATION_KINDS  += 'social_riders_going','social_thanks','social_added','social_respect',
                       'social_invite_registered','social_ride_ask'
NotificationTarget  += { type: 'rider'; publicId: RiderPublicId }
SocialNotificationSettingsView = z.object({ push: z.boolean() })
UpdateSocialNotificationSettings = z.strictObject({ push: Toggle })
DEFAULT_SOCIAL_NOTIFICATION_SETTINGS = { push: true }

// api (внутренние)
type SocialNoticeKind = Extract<NotificationKind, `social_${string}`>
SocialNoticeParams = z.object({ object: z.string().max(200) }).partial()
NotificationDoc += { actors?: string[]; params?: SocialNoticeParams }
NotificationSettingsDoc.push += { social?: boolean }
NoticeText += { kind: SocialNoticeKind; object?: string }
NoticeDraft += { actor?: string }
RenderedDraft += { social?: { actor: string; params: SocialNoticeParams } }
FanoutJobData += { social?: { actor: uuid; params: SocialNoticeParams } }
socialCollapseKey(kind, object: { type: 'ride'|'race'|'route'; id } | null, eventAt: Date): string
socialNoticeDraft(input: { kind; eventId; actor: string | null; recipients; object: { type; id; title } | null }): NoticeDraft
renderSocialNotice(doc: Pick<NotificationDoc,'kind'|'actors'|'params'|'target'|'title'|'body'>,
                   cards: ReadonlyMap<string, PublicRiderCard>): { title; body; target: NotificationTarget | null }
```

### Алгоритмы

- **Рендер** (`renderSocialNotice`): вид без правила или `params` не разбираются — сохранённые `title/body/target`.
  Лицо имени — последнее в `actors` с карточкой в `cards`; имя — `card.name` (одна строка, без сокращений, K10), нет —
  «Райдер». `others = actors.length − 1`; `others > 0` → «{имя} и ещё {others}». Тело — по таблице §3 (` · «{object}»`
  для ride/race/route-видов). Цель: `rider`-виды — `{ type: 'rider', publicId }` того же лица, если `card.publicId`,
  иначе `null`; прочие — сохранённая. `social_ride_ask` — сохранённые (RC-10).
- **Накопление** (`writeNotices`, документ с `actors`): RC-1a; возвращает `upserted + modified` (+ результат повтора).
  Смешанная пачка (обычные + накопление) — один `bulkWrite` `ordered: false`, повтор — по индексу операции, как сейчас.
- **Окно** — RC-7; `socialNoticeDraft` для `social_ride_ask` даёт `collapse: { key, seq: 1 }` без `actor`, прочим —
  `collapse: { key }` + `actor`.
- **Список**: `socialActorIds(page)` — объединение `actors` документов группы `social`; `publicRiders` один раз.
- **Push**: `contentOf(due, cards)` — если `due.length === 1` и документ социальный — запрос карт только его лиц.

### TESTS

- **contracts (unit)** `notification.schema.test.ts`: `social` последняя в группах, шесть видов в конце; цель `rider`
  валидна с 43-символьным `publicId`, невалидна с коротким/`/`; старая схема (группы/виды/цели без новых) разбирает
  ответ → `unknown` у вида, группы и цели; `SocialNotificationSettingsView` терпит лишний ключ, `Update…` — нет.
- **api-client (unit)** `notifications.test.ts` — два метода: путь, метод, тело, разбор.
- **api unit** `social-notices.test.ts`: ключи окон (граница суток по Минску: `20:59Z`/`21:00Z`), таблица текстов
  (одно публичное лицо; публичное + непубличное → «и ещё 1»; ни одного → «Райдер»; три непубличных → «Райдер и ещё 2»;
  самое свежее публичное выбирается с конца; перевод строки в названии схлопывается); цель `rider` / `publicId: null`
  → `null`; битые `params` → запасной текст. `notifications.policy.test.ts`: группа шести видов, `initialDelivery` —
  push по `push.social`, `email: null`. `notification-fanout.test.ts`: `social` переносится в пачку.
  `notification-texts.test.ts`: запасные тексты шести видов.
- **int (реальная Mongo, своя БД)**:
  - `notifications.int.test.ts`: `GET settings/social` по умолчанию `{ push: true }`; `PUT` сохраняет, лишний ключ —
    400, без входа — 401, у другого пользователя своё; `GET /settings` — прежние ключи. Список: тексты таблицы с
    текущими именами; смена `publicName` видна в созданном уведомлении; отзыв согласия и стёртый профиль — «Райдер»;
    цель `rider` → `publicId` или `null`; старый документ без `actors` отдаётся как раньше; один вызов `publicRiders` на
    страницу (шпион порта или счётчик запросов к `profiles`).
  - репозиторий (`notifications-intake.int.test.ts` или новый блок): AC3 — накопление (`actors` без дублей, снова
    непрочитано, `createdAt` новый, `sourceEventId`/`push` прежние); повтор того же лица — документ без изменений
    (включая `readAt` после прочтения); другой день / другой райд — новый документ; гонка: `Promise.all` двух записей
    с разными лицами в пустое окно — один документ, оба лица; повтор задачи того же события — без изменений; потолок
    `SOCIAL_ACTORS_MAX`. Путь задачи `notifications.fanout` с `social` пишет документ с `actors`/`params`.
  - `notifications-delivery.int.test.ts`: push одного социального — текст с текущим именем на момент отправки
    (переименование между записью и отправкой); тихие часы → накопление → после конца интервала один push «… и ещё
    1»; накопление не ставит задачу push; `push.social: false` → `skipped/disabled`, в центре есть; два отложенных —
    сводка без имён; Web Push payload с целью `rider`.
  - стирание: аккаунт действующего лица стёрт (`AccountErasure` / `ProfileErasure` + `NotificationErasure`) →
    уведомление получателя читается «Райдер», цель `null`; уведомления самого стёртого удалены (без регрессий).
- **app**: `notification-target.test.ts` — `rider` → `/riders/<publicId>`, битый `publicId` → `null`, паритет копии
  service worker (`targetPath` из `serviceWorkerSource`) для `rider`; `__tests__/notifications.test.tsx` — строка «Свои»
  последней, переключение шлёт `PUT settings/social`, 404 — блока нет; `notification-settings-no-push.test.tsx` — без
  push блока нет.
- **arch**: `pnpm arch:check` (ребро `notifications → profile`, нет `notifications → social`).

### OUT OF SCOPE

- Маршруты `social.*` в `notificationsOutboxRoutes`, `case` в `NotificationIntake.drafts`, порт `SOCIAL_NOTICES`,
  импорт `SocialCoreModule`, аудитория «Свои идут», регламент «Как прошёл райд?», антиспам K11 повторного уведомления — P7.
- Иконки/подписи групп в строке центра (RC-11); e-mail группы; удаление id стёртого из чужих `actors`; миграции.

## 12. Outcome

Coder, 2026-10-31. Отклонения — §8.2.

**Сделано**

- Contracts: группа `social`, шесть видов, цель `rider` (`RiderPublicId`) — в конец; `SocialNotificationSettingsView`,
  `UpdateSocialNotificationSettings`, `DEFAULT_SOCIAL_NOTIFICATION_SETTINGS`; комментарий `NotificationView` (RC-14).
  api-client — `getSocialNotificationSettings`, `updateSocialNotificationSettings`.
- API `notifications`: `social-notices.ts` (таблица видов, `SOCIAL_ACTORS_MAX = 100`, `SocialNoticeParams`,
  `socialCollapseKey` по дню события в Минске, `socialNoticeDraft` — точка входа P7, `renderSocialNotice`,
  `socialActorIds`, запасной текст); policy (`SOCIAL`, `push.social`, `email: null`); `NotificationDoc.actors?/params?`,
  `push.social?`; `NoticeDraft.actor`, `RenderedDraft.social`, `FanoutJobData.social?`; `writeRecipients` пишет
  `actors: [лицо]` и `params`; `writeNotices` — режим накопления RC-1a; `list`/`claimPush` проецируют `kind`,
  `actors`, `params`; рендер с именами — `NotificationsService.list` (один `publicRiders` на страницу, пустая — без
  запроса) и `contentOf` push (одно социальное — имена на момент отправки, сводка — без имён); подресурс
  `GET|PUT settings/social`; `ProfileCoreModule` в `NotificationsModule` и `NotificationsWorkerModule`.
- Приложение: группа «Свои» последней (`SocialGroup` → `PushOnlyGroup`, ключ `['notifications','settings','social']`),
  цель `rider` → `/riders/<publicId>` в `notificationTargetPath` и в service worker (проверка 43 символа base64url),
  i18n `notifications.settings.group.social` (в конец).
- Документы: `notifications.md` (N3, N7, N10, N11, N12, тексты v1, «Где в продукте»), ADR-0027 п. 6 и «Последствия»,
  ADR-0017 п. 3, правила `pokatim-backend.md`, `pokatim-db.md`, `pokatim-contracts.md`, `pokatim-security.md`,
  `pokatim-app.md`.

**Тесты**

- contracts `notification.schema.test.ts` — порядок справочников, цель `rider`, старая схема → `unknown`, подресурс.
- api-client `notifications.test.ts` — два метода.
- api unit: `social-notices.test.ts` (19), `notifications.policy.test.ts`, `notification-fanout.test.ts`,
  `notification-texts.test.ts`.
- api int `notifications-social.int.test.ts` (20): подресурс (умолчание, PUT, 400, 401, лимит, чужое), запись и
  накопление (снова непрочитано и наверху, `sourceEventId`/push прежние, задачи push нет; повтор того же лица и
  повтор задачи — без изменений; новое окно — райд и сутки 20:59Z/21:00Z; гонка 10 окон × 2 лица; потолок; «Как
  прошёл райд?»), список (имена, «и ещё N», цель `rider`, переименование, отзыв согласия, старый документ, один
  `publicRiders`), push (имя на момент отправки и цель `rider` в payload Expo, тихие часы → «Петя и ещё 1», тумблер,
  сводка без запроса имён), стирание (`ProfileErasure` + `NotificationErasure`: «Райдер», цель `null`, свои удалены).
- Отрицательные доказательства: без `actors: { $ne }` в фильтре — красный «повтор того же лица»; без повтора после
  дубля — красная гонка (3 из 3 прогонов), с ним — зелёная (3 из 3).
- app: `notification-target.test.ts` (rider + паритет SW), `__tests__/notifications.test.tsx` («Свои» последней,
  PUT `settings/social`, 404 — блока нет, переход на `/riders/<publicId>`), `notification-settings-no-push.test.tsx`.

**Проверки** (своя изоляция: `MONGO_URL_TEST=…/pokatim_social_p1_test`, `REDIS_URL_TEST=…:6479/8`)

- `vitest --project integration src/modules/notifications src/modules/account` → 9 файлов, 221 тест — pass.
- `vitest --project unit` (api, весь) → 104 файла, 970 тестов — pass; после рефакторинга цикла —
  `src/modules/notifications` unit 156 pass, int social + intake 71 pass.
- `vitest run` contracts 499, api-client 176, i18n 16 — pass.
- `jest` app: три файла, 95 тестов — pass.
- `typecheck` contracts, api-client, i18n, api, app, admin — exit 0.
- `eslint --max-warnings=0` по изменённым файлам — exit 0; `prettier --check` — pass.
- `pnpm arch:check` — no dependency violations.
- Полный `pnpm check` — не запускался (по поручению — его прогоняет оркестратор).

**Не проверено**

- Web Push payload с целью `rider` отдельным int-тестом: тот же `contentOf` идёт в Expo и Web Push, проверен payload
  Expo (`data.target`).
- Стирание — через порты `ProfileErasure` и `NotificationErasure`, не полным проходом `AccountErasure`
  (account int-тесты зелёные без изменений).

**Исправления ревью pass 1** (отдельный коммит): MEDIUM — int-тест «сбой запроса имён — push уходит запасным текстом,
документ не застревает в sending» (сначала красный: исключение выходило из `deliver`), затем `socialCards` с
`try/catch`; LOW — unit-тест `socialParamsOf` (потолок 200, одна строка), затем обрезка. Прогоны: int
`notifications-social` + `notifications-delivery` → 2 файла, 53 теста, pass; unit `src/modules/notifications` → 10
файлов, 157 тестов, pass; api `tsc --noEmit` — exit 0; eslint по затронутым файлам — exit 0. Web Push payload с целью
`rider` и полный `AccountErasure` (LOW, пробелы тестов) — без изменений, как в «Не проверено».
