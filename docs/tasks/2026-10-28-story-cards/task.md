# 1. Title

Карточки для сторис (экран 12): «Поделиться в сторис» из своего результата гонки — PNG 1080×1920 в теме
приложения, серверный рендер в воркере, системный шаринг на native и web.

# 2. Goal

Райдер делится своим результатом гонки картинкой 9:16 для сторис (Instagram и любые приложения): трек, время,
место, группа, название гонки, бренд «Покатим». Карточка следует активной теме приложения (7 тем, радиус 0).

Источники: прототип «Кофе-райды», раздел (d) «Карточка-приглашение · Stories 9:16 · превью 360×640 = ⅓ экспорта
1080×1920» и общий компонент прототипа «27. Share / invite card 9:16» (раскладки **3a** — карточка с мастхедом и
нижним блоком, **3b** — «карточка-линия» в три яруса с колонтитулом; `card-time`, `card-stats`, `card-maptile`);
прототип «Результат после загрузки» — «Поделиться» в блоке своего результата (OQ56 «доступно сразу»);
`docs/proposal-stack-architecture.md` — «карточки для шеринга 1080×1920 и OG — серверный рендер в очереди»;
ADR-0016 (темы — глобальные, сервер знает активную), ADR-0012 (результаты), `docs/product/profile.md` (имя —
только с согласием `showNameInResults`). Код сверен по `origin/develop` @ `c7ace06`.

# 3. Scope

Один PR в `develop` (contracts + api-client + i18n + design-tokens + api + app + ADR).

## 3.1 Решения (brainstorming, автор сессии; продуктовые — отмечены [ASSUMPTION])

- **R1. Где рендерить — сервер, воркер BullMQ: satori (разметка → SVG, реальная вёрстка текста со шрифтами) +
  `@resvg/resvg-js` (SVG → PNG).** Замер на dev-машине: satori ≈ 45 мс, resvg ≈ 170 мс (холодный — 1.7 с) → по
  §4.5 это тяжёлое → задача очереди. Альтернативы и почему нет — в ADR-0018 (клиентский `react-native-view-shot` /
  `Svg.toDataURL` + canvas на web: три разных растеризатора, шрифты в SVG на web только base64-встраиванием, нет
  переноса строк, приватность — на клиенте; satori/resvg в бандле приложения — +2–5 МБ wasm на web).
- **R2. Шаблоны — два**, по раскладкам прототипа без фото (фото/медиа — модуль `media`, вне scope):
  - `line` «Линия» (3b): светлая схема темы — фон, три яруса (метка с accent-подчёркиванием «Гонка · <группа>»,
    название гонки, дата; крупная линия трека; время + пара «место · группа»), колонтитул «ПОКАТИМ»;
  - `night` «Ночь» (3a без фото): тёмная схема темы — мастхед «ПОКАТИМ» сверху, нижний блок: метка, название,
    дата, плитка трека, крупное время, пара «место · группа».
  У тем «всегда тёмная» (`chrono`, `navigation`) обе схемы совпадают — шаблоны различаются раскладкой.
  Прототип говорит «карточка рисуется только card-* и не следует теме (светлая/тёмная)»; задача требует цвета и
  шрифты темы → трактовка: **карточка следует выбранной в «Протоколе» теме, но не системной схеме устройства**
  (схему задаёт шаблон).
- **R3. Цвета и шрифты — роли и гарнитуры активной темы** (`appThemes[id].schemes.light|dark`, `fonts.display|text`)
  с сервера (модуль `appearance`). Геометрия карточки (отступы, кегли, толщины — значения прототипа ×3) — токены
  `storyCard` в `@pokatim/design-tokens`, не литералы в API. Радиус 0 (прямоугольники без скругления; точка старта —
  круг по смыслу, ADR-0016).
- **R4. Данные карточки — только своя заявка** (владелец; чужой результат карточкой не делится): название гонки,
  дата гонки (Europe/Minsk), время `elapsedSec`, место (`place`, «=N» при ничьей) из `ranked`, группа зачёта
  (`group`, подпись — i18n групп), статус «Предварительный» до финального протокола, имя райдера — **только если
  есть имя и согласие `showNameInResults`** (порт `RIDER_NAMES`, как таблица результатов), бренд «Покатим».
  Места нет (`unranked`/ещё не проверено) — пара «место · группа» показывает только группу; времени нет, DQ,
  отозвана — карточки нет (409 `STORY_CARD_UNAVAILABLE`, кнопки нет).
- **R5. Линия на карточке — приватность.** Своя засчитанная попытка: **только отрезок между воротами старта и
  финиша гонки** (`trackMap.segment` на сохранённой линии — те же данные, что `GET …/attempts/:id/track`), разметка
  не готова/нет — **линия маршрута гонки** (`RouteGeometry.displayGeometry`, публичная), нет и её — без линии.
  Точка до ворот старта (дом, подъезд к старту) на карточку не попадает никогда. Отдельной «обрезки дома» в проекте
  нет — переиспользуем ворота коридора.
- **R6. Доставка картинки:** `GET /v1/races/:raceId/entry/story-card?template=line|night` (вход обязателен) →
  `{status:'pending'}` или `{status:'ready', url}`; клиент опрашивает (как серии спора 06b). `url` —
  `/v1/story-cards/<token>.png`: случайный 128-битный токен → PNG в Redis (TTL 24 ч), без авторизации
  (capability-URL: так картинку берут `<img>`, `fetch`, `File.downloadFileAsync` без заголовков). Кэш по хэшу
  входов (заявка, попытка и её ревизия проверки, место, ranked, группа, статус, имя, тема, шаблон, версия
  рендера): повторный запрос — тот же токен, смена темы/имени/места — новая картинка.
- **R7. Шаринг.** Native: PNG скачивается в кэш (`expo-file-system`, уже в сборке как зависимость `expo`) →
  `expo-sharing` `shareAsync(file, {mimeType:'image/png', UTI:'public.png'})` — системный лист (сохранить в
  «Фото», Instagram Stories через лист Instagram — без SDK-ключей). **Новый нативный модуль `expo-sharing` —
  нужна новая dev-сборка.** Web: `navigator.canShare({files:[png]})` → `navigator.share`, иначе «Скачать PNG»
  (`<a download>` по blob). Развилка — файлами `share-story.native.ts` / `share-story.web.ts`.
- **R8. Входы [ASSUMPTION]:** (1) блок «Ваше участие» на карточке гонки (как «Поделиться» в прототипе
  результата) — secondary «Поделиться в сторис», когда есть время и заявка не снята/не DQ; (2) экран
  `races/result/[id]/[entryId]` для **своей** заявки — своя строка таблицы становится нажимаемой и ведёт туда же,
  экран показывает результат и «Поделиться в сторис» (подачи спора на себя нет). Таблица сезона — в прототипе
  шаринга нет → вне scope.
- **R9. Экран карточки** `races/story/[id]` (внутри `Stack.Protected`, без таб-бара): заголовок «Карточка для
  сторис», переключатель шаблонов (чипы «Линия» / «Ночь»), превью 9:16 (скелетон того же размера, пока pending;
  ошибка — «Не удалось загрузить» с повтором; 409 — пустое состояние «Карточки пока нет» + «К гонке»), primary
  «Поделиться» (на web без `canShare` файлов — «Скачать PNG»), строка-подсказка «Имя на карточке — только с вашим
  согласием в профиле» [ASSUMPTION copy].

## 3.2 Слои

- **contracts:** `STORY_CARD_TEMPLATES`, `StoryCardQuery`, `StoryCardStatus` (discriminated `pending|ready`), код
  ошибки `STORY_CARD_UNAVAILABLE`.
- **api-client:** метод запроса статуса карточки.
- **i18n:** строки экрана, кнопок, карточки («Гонка», «Место», «Группа», «Предварительный», бренд «ПОКАТИМ»).
- **design-tokens:** `storyCard` (размер 1080×1920, отступы, кегли/интерлиньяж/трекинг ролей карточки, толщины
  линий, размер точки старта) — из прототипа ×3.
- **api:** модуль `sharing` (controller + service + cache + processor в worker + чистый `story-card.render.ts`),
  данные заявки — через порт модуля `results` (index.ts), тема — через `appearance`, имя — `RIDER_NAMES`; новые
  зависимости `satori`, `@resvg/resvg-js`, шрифты `@expo-google-fonts/*` (TTF) — в `apps/api/package.json`.
- **app:** экран `races/story/[id]`, запрос статуса с опросом, `share-story.{native,web}.ts`, кнопки во входах R8;
  `expo-sharing` в `apps/app/package.json` и `app.json` plugins (если нужен).

# 4. Out of Scope

- Фото на карточке («Добавить своё фото», модуль `media`), видео-карточки, OG 1200×630.
- Карточка-приглашение кофе-райда (4a/4b) и «Кофе-райд» прошедшего райда (D-65) — следующий слайс на том же
  рендере.
- Карточка сезона / из таблицы сезона (в прототипе нет).
- Отзыв выданных карточек при DQ/пересчёте (прототип панели «карточка отзывается») — картинка живёт ≤ 24 ч в
  Redis, новая не выдаётся; уже скачанные файлы отозвать нельзя.
- Прямой Instagram Stories intent / Facebook App ID.

# 5. Architecture Context

- api: новый модуль `sharing` (HTTP-часть в `main`, processor — в `worker`); `results` отдаёт порт данных своей
  заявки; `appearance` — активная тема; `profile` — `RIDER_NAMES`.
- Очередь BullMQ `story-card` (jobId = хэш входов → идемпотентно), Redis: PNG по токену, ключ хэш → токен,
  pending-метка. Миграций нет, outbox нет.
- contracts: только новые схемы — старые клиенты не затронуты.
- app: новый экран, новый нативный модуль `expo-sharing`.

## 5.1 Placement & Reuse Gate

- Переиспользуем: паттерн кэш/pending/processor серий спора (`disputes/dispute-series.*`), линия трека и отрезок
  ворот (`results` + `tracks.trackLine`, `trackMapOf`), линия маршрута (`RouteGeometry.displayGeometry`), имена
  (`RIDER_NAMES`), реестр тем (`appThemes`, `@pokatim/design-tokens`), подписи групп и формат времени/места
  (i18n и форматтеры, что уже есть у таблицы результатов — общий код вынести, не копировать), `AsyncContent` /
  скелетоны / `Chip` / `Button` / `EmptyState` из `@rkarakulov/ui`.
- Запрещены дубли: своя копия формата времени «Ч:ММ:СС» и места «=N», своя таблица цветов тем, хардкод hex/px.
- Тонкий controller; рендер — чистая функция `(данные, тема, шаблон, токены) → дерево satori` + обёртка PNG.

# 6. Relevant Files

- `apps/api/src/modules/disputes/dispute-series.{cache,processor,service}.ts` — образец очереди + Redis-кэша.
- `apps/api/src/modules/results/*` — своя заявка, место, группа, попытка и её `trackMap`.
- `apps/api/src/modules/appearance/*` — активная тема.
- `packages/design-tokens/src/{app-themes,brand}.ts` — роли и гарнитуры тем.
- `apps/app/src/theme/fonts.ts` — соответствие гарнитура → начертания (для TTF на сервере).
- `apps/app/src/features/races/participation/entry-result.tsx` — вход 1.
- `apps/app/src/features/races/results-table.tsx`, `disputes/rival-card.tsx` — вход 2.
- `packages/contracts/src/results/results.schema.ts` — `MyRaceEntry`.
- `infra/docker/Dockerfile` — образ api (bookworm-slim, amd64: prebuilt `@resvg/resvg-js-linux-x64-gnu`).

# 7. Implementation Notes

- satori требует TTF/OTF/WOFF (не WOFF2): брать `.ttf` из `@expo-google-fonts/<семейство>/<вес>/` через
  `require.resolve`, грузить один раз на процесс воркера, только нужные начертания.
- satori: только flex-раскладка, `<svg>` внутри разрешён (polyline трека).
- Линия: проекция Web Mercator → вписать в прямоугольник яруса с сохранением пропорций; упростить до ≤ 500 точек.
- Длинные названия гонки: перенос satori, не больше 3 строк (`lineClamp`), время — ступени кегля как
  `card-time.step-60/52` прототипа при длинном времени (> 9:59:59 не бывает, но «10:00:00» — шире).
- Опрос на клиенте: каждые 1 с, до 30 с, затем ошибка с повтором.

# 8. Risks / Assumptions / Open Questions

- [ASSUMPTION] Входы R8, тексты экрана, два шаблона без фото, TTL 24 ч.
- Риск: `@resvg/resvg-js` — нативный бинарь; в образе amd64 glibc есть prebuilt; на arm64 Mac — тоже.
- Риск: capability-URL картинки — кто получил ссылку, видит картинку 24 ч; содержимое = публичные данные таблицы
  результатов + имя с согласием → допустимо.
- Риск: Instagram на Android может не показать «Stories» в листе для PNG из кэша — проверка на устройстве.

## 8.1 Requirements Consistency (заполняет architect)

Architect, сверено по коду `c7ace06`. Решения R1–R9 не пересматриваются; ниже — недоопределённости и конфликты с
кодом/правилами. Блокеров нет: по каждому пункту есть рекомендация, по которой coder работает, если человек не решит
иначе (пункты с [ASSUMPTION] — вынести в pr.md как допущения).

- **RC-1. Права кнопки — с сервера, а не вычислением в клиенте.** R8 «когда есть время и заявка не снята/не DQ» в
  клиенте — это правило «можно ли», а `pokatim-app.md` требует «права и статусы — только `actions` / `result`
  сервера». Варианты: (a) клиент решает по `result.status`/`elapsedSec`; (b) **новое поле `MyRaceEntry.actions.
  canShareStory: z.boolean().default(false)`**, сервер считает той же чистой функцией, что и эндпоинт карточки;
  (c) отдельный запрос статуса до показа кнопки. **Рекомендация — (b):** один предикат `storyCardEligible`
  (`results.policy.ts`) для `actions` и для 409; новая сборка со старым API получает `false` — кнопки нет (эндпоинта
  у старого API и так нет). Это правка существующей схемы (обратно совместимая, `.default(false)`), а не только
  новые схемы, как в §3.2/§5 — см. §8.2.
- **RC-2. Чей результат и какая попытка после публикации.** «Время, место» берутся как в «моём участии»
  (`ResultsReadService.entryResult`): до публикации — живой расчёт, после — строка текущей ревизии протокола.
  Попытка для линии: опубликован протокол и строка есть — **`row.attemptId`** (пересчёт мог сменить лучшую), иначе
  `entry.best.attemptId`. Предикат «карточка есть»: заявка `active`, `elapsedSec !== null`, статус ∈
  `provisional | finisher | final | revised`; `dq`, `withdrawn`, `pending`, `not_counted`, `dns`, `none` — 409.
  `EntryResult` не расширять полем `attemptId`: `myEntry` раскладывает его `...result` в ответ (утечка поля мимо
  явного списка) — попытку порт берёт отдельным чтением в той же snapshot-сессии.
- **RC-3. Где на карточке имя, статус «Предварительный» и дата** — прототип слотов не даёт. [ASSUMPTION]
  Рекомендация: (1) метка (kicker) — «Гонка» или «Гонка · Предварительный» (до финального протокола; группа в метке не
  дублируется — она есть в паре «место · группа», R2 давал её дважды); (2) имя райдера — отдельная строка стилем
  `date` **над** датой (`storyCard.text.date`), нет имени/согласия — строки нет (без «Участник»); (3) дата — **окно
  гонки по Минску с годом** («4–12 октября 2026», общий `formatLocalRange(…, now = null)`), а не дата своего заезда:
  дата заезда в публичной таблице не раскрывается (там нет времени старта). Альтернатива — дата заезда; не
  рекомендую по той же причине.
- **RC-4. Финальный провал задачи невидим в контракте R6** (`pending|ready` — клиент крутит 30 с и получает «ошибку»
  по таймауту), а `backend.md` требует видимого состояния. Рекомендация: третий вариант **`{ status: 'failed' }`**;
  ключ провала Redis читается `GETDEL` — отказ сообщается один раз, «Повторить» на клиенте ставит задачу заново
  (лимит постановок ограничивает петлю). Альтернатива (без `failed`, только таймаут клиента) — «тишина», не
  рекомендую.
- **RC-5. Форма `url` в ответе.** Сервер не знает свой публичный origin (за прокси, env его нет), относительный путь
  RN `File.downloadFileAsync` не примет. Рекомендация: ответ `{ status: 'ready', token }`, абсолютный адрес строит
  api-client `storyCardImageUrl(token)` — как `catalogRouteGpxUrl` (`${baseUrl}/v1/story-cards/<token>.png`). Путь
  картинки R6 не меняется. См. §8.2.
- **RC-6. Дубли форматтеров уже есть** (`formatElapsed` — в `apps/app/src/features/races/format.ts` и
  `apps/admin/src/format.ts`; «=N» — в `participation-format.ts` и `standings-format.ts`; диапазон дат —
  `apps/app/src/lib/minsk-format.ts`). API станет третьим потребителем — §5.1 запрещает копию. Варианты: (a) вынести
  в `@pokatim/i18n` (`src/format.ts`: `formatElapsed`, `formatPlace`, `formatLocalRange`, `heroDateText` — чистые, на
  `t`), приложение и панель импортируют оттуда; (b) серверная копия в `sharing` — запрещено; (c) вынести в
  `@pokatim/contracts` — нет, контракты описывают форму, не показ. **Рекомендация — (a)**; app-модули
  реэкспортируют, чтобы не трогать места вызова. Тексты карточки и подписи групп — тот же `@pokatim/i18n`
  (`results.group.*`); прецедент `notification-texts.ts` (снимок сервера вне i18n) здесь не применим: карточка не
  хранится дольше 24 ч, а смена текстов поднимает `STORY_CARD_RENDER_VERSION`.
- **RC-7. Геометрия линии — тоже дубль.** Разрез линии по дробным позициям (`pointAt`/`slice`) живёт в
  `apps/app/src/features/maps/track-style.ts`, вписывание линии в прямоугольник — `contourPath`
  (`apps/app/src/features/routes/route-contour-path.ts`, локальная проекция `localProjection`, север вверху).
  Рекомендация: перенести в `@pokatim/route-view` (`src/line-geometry.ts`: `pointAt`, `sliceLine`, `contourPath`,
  `ContourView`) — пакет «отображение маршрута без React», им уже пользуются app и admin; API — третий потребитель.
  Проекция — локальная равнопромежуточная, как у контура Главной, а не Web Mercator из §7 (на масштабе гонки
  различие < 1 %; одинаковый вид с героем Главной важнее). См. §8.2.
- **RC-8. Гарнитура → файл — таблица `FACES` только в приложении.** Серверу нужны те же начертания (display 600 у
  Manrope и Roboto Condensed — файл 700). Рекомендация: таблицу «гарнитура → роль → вес → id файла»
  (`appFontFaces`, id вида `Manrope_700Bold`) перенести в `@pokatim/design-tokens` (данные, без ассетов);
  `apps/app/src/theme/fonts.ts` строит `fontAssets`/`themeFonts` по ней (импорты `@expo-google-fonts/*` остаются в
  app — Metro нужны статические `require`), API резолвит id в `.ttf`. Своя таблица на сервере — дубль.
- **RC-9. Тема в API доступна только как HTTP-модуль.** `appearance/index.ts` экспортирует лишь `AppearanceModule`
  (контроллеры + `PanelModule`), порта нет; worker'у контроллеры и панель не нужны. Рекомендация: `AppearanceCoreModule`
  (репозиторий + порт `APP_APPEARANCE` `{ activeThemeId(): Promise<AppThemeId> }`), его импортируют `AppearanceModule`,
  `SharingModule` и `SharingWorkerModule`. Правило `pokatim-backend.md` «appearance импортирует только panel» не
  нарушается (зависимость обратная: `sharing → appearance`).
- **RC-10. Размер точки старта, отступ мастхеда до линии, ширина плитки трека** — в значениях прототипа нет.
  [ASSUMPTION] точка старта Ø 8 px превью (24 экспорт), обводка цветом фона 2 px (6); мастхед — `padding-bottom` 8 px
  (24); плитка `night` — на всю ширину контента (960). Сверить с прототипом на ревью PNG (AC8), расхождение — вопрос
  человеку (`AGENTS.md` §4.11).
- **RC-11. Цифры времени не табличные.** satori не поддерживает `font-variant-numeric`/`font-feature-settings` —
  `tabular` прототипа на PNG не воспроизводится (на статичной картинке цифры не «прыгают», риск только в ширине).
  Ступени кегля выбираются по длине строки времени (≤ 7 символов — 216, 8 — 180, ≥ 9 — 156), а не по измерению.
  Принять; отметить в ADR-0018.
- **RC-12. Native без модуля `expo-sharing`** (старый dev-клиент, Expo Go): статический импорт `expo-sharing`
  бросает при загрузке модуля (как MapLibre). Рекомендация: импорт только ленивый внутри `share-story.ts`, проверка
  `requireOptionalNativeModule('ExpoSharing')`; нет модуля — режим «Скачать PNG» через существующий
  `downloadFile(url)` (системный браузер). Без этого экран падает на текущих сборках тестеров.
- **RC-13. Web Share после `await fetch` теряет жест пользователя** (Safari требует `navigator.share` в пределах
  активации). Рекомендация: PNG скачивается в `File` **заранее**, как только статус `ready` (запрос
  `['races','story',raceId,template,'file',token]`), кнопка «Поделиться» активна после этого и вызывает `share`
  синхронно в обработчике; `canShare({ files })` — по готовому файлу.
- **RC-14. Капабилити-токен в пути попадёт в access-лог nginx dev-стенда** (формат `pokatim_noquery` убирает только
  query). Содержимое картинки — публичные данные таблицы + имя с согласием, TTL 24 ч; ссылки `auth/verify/<token>`
  уже логируются так же. Принять (R6 без изменений), записать в ADR-0018 и §8.3; альтернатива `?token=` — только
  если человек сочтёт иначе.
- **RC-15. Лимиты.** §8.3 требует лимит запросов статуса на пользователя; опрос 1/с × 30 с × 2 шаблона — до 60
  запросов на экран. Рекомендация (`RateLimiter` базы): чтение `story-card-read:<uid>` 120/мин (как
  `notifications-read`), постановка рендера `story-card-render:<uid>` 30/ч — списывается **только** при захвате
  ключа постановки (как `dispute-series-user`), картинка — IP-лимит `story-card-image` 120/мин
  (`IpRateLimitGuard` + `@IpRateLimit`, как `route-gpx`).

Конфликтов с инвариантами `AGENTS.md` §4 нет: рендер — в worker (§4.5), данные — только сервер (§4.1), контракт
сначала (§4.2), границы модулей — через `index.ts` (§4.3), общий код — в `packages/*` с ≥ 2 потребителями (§4.4),
оформление карточки — токены и роли темы (§4.11), обе платформы (§4.13).

## 8.2 Deviations from spec

Architect (уточнения спеки по коду; coder дополняет своими):

- D1 (RC-1): меняется существующая схема — `MyRaceEntry.actions.canShareStory` (`.default(false)`); §3.2/§5 «только
  новые схемы» — неточно.
- D2 (RC-4): `StoryCardStatus` — `pending | ready | failed`, не два состояния.
- D3 (RC-5): `ready` несёт `token`, не `url`; адрес строит api-client (`storyCardImageUrl`). AC2 «ready + url» —
  читать как «ready + token → url клиента».
- D4 (RC-7): проекция — `contourPath` (локальная, как контур Главной), не Web Mercator (§7); прореживание до 500 точек
  не обязательно (линии уже ≤ 1000) — `simplifyTrack` только при > `storyCard.trackMaxPoints`.
- D5: файлы развилки шаринга — `apps/app/src/lib/share-story.ts` (native) + `share-story.web.ts`, по образцу
  `share-link(.web).ts` (без базового файла `.native.ts` typecheck не резолвит импорт без расширения — `moduleSuffixes`
  в проекте не настроен).
- D6 (RC-6, RC-7, RC-8): общий код переезжает в пакеты: форматтеры → `@pokatim/i18n`, геометрия линии →
  `@pokatim/route-view`, таблица начертаний → `@pokatim/design-tokens`. API получает зависимости `@pokatim/i18n`,
  `@pokatim/design-tokens`, `@pokatim/route-view`.
- D7 (RC-9): `appearance` получает `AppearanceCoreModule` и порт `APP_APPEARANCE`.
- D8: `expo-file-system` добавить явной зависимостью `apps/app/package.json` (`~58.0.10`, уже в сборке как зависимость
  `expo` — новой сборки не требует); `app.json` не меняется (плагин `expo-sharing` для отправки не нужен).

Coder (отклонения и уточнения при реализации):

- D9 (RC-6): `@pokatim/i18n` — `index.ts` разделён на `core.ts` (словарь, `t`) и `format.ts` (иначе цикл
  `index ↔ format`); пакет получил зависимость `@pokatim/contracts` (`minskToday`, `utcToMinskWallTime`). В пакет
  переехал и `minskDateTime` (общие помощники дат с `formatLocalRange`); `apps/app/src/lib/minsk-format.ts`
  реэкспортирует. Панель: `formatElapsed` — из пакета; её «=N» (`admin.results.tiePlace`, свой ключ) не тронут.
- D10 (RC-7): `contourPath` возвращает ещё `points` (координаты пути) — ломаная satori строится по ним; путь `d` для
  приложения прежний.
- D11: ярус 2 шаблона `line` — гибкий (всё место между ярусами 1 и 3, линия вписана с пропорцией), а не фиксированный
  `tier2Top`/`tier2Height`: 3 строки названия + имя иначе выталкивали колонтитул за край (видно на PNG). Токены
  прототипа (`tier2Top`, `tier2Height`) оставлены как значения прототипа; плитка `night` — без фона, только линия
  (радиус 0).
- D12: композиция рендера (`storyCardRenderInput`, `storyCardTrack`, `renderStoryCard`) — в `story-card.png.ts`; ступени
  времени — токен `STORY_CARD_TIME_STEPS` (8 / 9 символов) в `@pokatim/design-tokens`.
- D13 (RC-12): ленивый импорт `expo-sharing` — отдельным модулем `src/lib/load-expo-sharing.ts` (точка подмены в jest:
  `import()` в jest без `--experimental-vm-modules` не работает), как `load-maplibre-native.ts`.
- D14: кнопка — общий компонент `features/races/story/share-story-button.tsx` (участие и своя карточка); своя строка
  таблицы ведёт в `rivalPath` своей заявки, `RivalResult` показывает место, имя по согласию / «Участник», время.
- D15: отрицательное доказательство NX (б): BullMQ сам отбрасывает дубль по `jobId`, поэтому доказательство — по
  числу постановок (`queue.add` дважды без ключа NX), а не по числу задач в очереди.
- D16: превью на синтетике — скрипт `apps/api/scripts/story-card-preview.ts` (`pnpm --filter @pokatim/api
  preview:story-cards <каталог>`), в CI не запускается.
- D17: `appearance.service.ts` не менялся — порт реализует отдельный `AppAppearanceService`.
- D18: `expo-sharing` в `package.json` — `~58.0.19` (bundledNativeModules), установилась 58.0.20 (в пределах `~`).

## 8.3 Security checklist

AuthN — статус карточки только вошедшему, своя заявка (чужой `raceId` без заявки → 409/404 без утечки).
Данные наружу — без e-mail, userId, координат до ворот; имя — только с согласием. Злоупотребления — лимит запросов
статуса (на пользователя), размер PNG ограничен, очередь идемпотентна по хэшу. Секретов нет. Аудит не нужен
(чтение своих данных).

# 9. Acceptance Criteria

1. Вошедший райдер с временем в гонке видит «Поделиться в сторис» в «Ваше участие» и на экране своей строки
   таблицы; без времени / DQ / снятая заявка — кнопки нет, API — 409 `STORY_CARD_UNAVAILABLE`.
2. `GET …/story-card?template=line` первый раз → `pending`, после обработки задачи → `ready` + `url`; PNG по `url`
   1080×1920, `image/png`.
3. Картинка содержит название гонки, дату, время, место (если есть) и группу, «ПОКАТИМ»; имя — только при
   согласии; линия — отрезок своей попытки между воротами или линия маршрута.
4. Цвета и гарнитуры — активной темы (`line` — светлая схема, `night` — тёмная); смена темы → новый токен.
5. Негатив: чужая гонка без заявки, гость (401), неизвестный шаблон (400), неизвестный токен (404).
6. Приватность: точки трека до ворот старта и после финиша не попадают в SVG (unit-тест на рендер).
7. Native — системный лист с PNG; web — `navigator.share` с файлом или скачивание PNG.
8. `pnpm check` зелёный; PNG трёх тем приложены к отчёту.

# 10. Documentation Impact

- ADR-0018 «Карточки для сторис: серверный рендер satori + resvg в воркере» + индекс `docs/adr/README.md`.
- `docs/product/races-and-seasons.md` — карточка для сторис из результата.
- `docs/runbooks/` — новая dev-сборка из-за `expo-sharing` (если есть раздел о нативных модулях).

# 11. Implementation Context (заполняет architect)

Architect, `c7ace06`. Уровень — task3 (контракты, несколько модулей, новый нативный модуль, инфраструктура образа).

## Architecture Review — story-cards
Status: **CONCERNS** (без блокеров: недоопределённости RC-1…RC-15 §8.1 закрыты рекомендациями; coder идёт по ним)

### Placement

- **contracts** `packages/contracts/src/sharing/story-card.schema.ts` + экспорт `src/index.ts`; код ошибки — в конец
  `ErrorCode` (`common.ts`); `MyRaceEntry.actions.canShareStory` — `src/results/results.schema.ts`.
- **api-client** `packages/api-client/src/index.ts`: `getStoryCard`, `storyCardImageUrl`.
- **i18n** `packages/i18n/src/format.ts` (новый, экспорт из `index.ts`) + строки в `ru.ts`.
- **design-tokens** `packages/design-tokens/src/story-card.ts` (геометрия, роли, начертания) + `app-fonts.ts`
  (`appFontFaces`, перенос из app) + экспорт в `index.ts`.
- **route-view** `packages/route-view/src/line-geometry.ts` (`pointAt`, `sliceLine`, `contourPath`, `ContourView`).
- **api** новый модуль `apps/api/src/modules/sharing/` (HTTP — `SharingModule` в `AppModule`; worker —
  `SharingWorkerModule` в `WorkerModule`); порт данных — `results`; тема — новый `AppearanceCoreModule`; имя —
  `ProfileCoreModule` (`RIDER_NAMES`).
- **app** экран `src/app/races/story/[id].tsx` → `src/features/races/story/*`; шаринг — `src/lib/share-story(.web).ts`;
  входы — `participation/race-participation.tsx`, `results-table.tsx`, `race-detail.tsx`, `disputes/rival-card.tsx`.
- Новых пакетов нет; общее — только расширения существующих пакетов с ≥ 2 потребителями (app, admin, api).

### Reuse points / запрещённые дубли

| Нужно | Брать | Не делать |
|---|---|---|
| статус, время, место, группа своей заявки | `ResultsReadService.entryResult` (через новый порт `results`) | второй расчёт мест в `sharing` |
| попытка и её разметка | `RaceAttemptDoc.trackMap` + `ActivitySource.trackLine` (как `myAttemptTrack`) | чтение `race_attempts`/`activity_tracks` из `sharing` |
| линия маршрута | `RouteGeometry.displayGeometry(race.corridor.routeId)` (кэш LRU уже есть) | — |
| имя | `RIDER_NAMES.publicNames([userId])` (согласие в фильтре порта) | чтение `profiles` |
| тема | `appThemes[themeId].schemes.light|dark`, `.fonts` | своя таблица цветов |
| кэш/постановка/процессор | `disputes/dispute-series.{cache,service,processor}.ts` (NX-ключ, `finalAttempt`, `skipped`) | jobId как единственная дедупликация |
| файл-ответ | `routes-public.controller.ts` `gpx` (заголовки через `HttpAdapterHost` после чтения) | `@Header` с типом файла |
| IP-лимит | `IpRateLimitGuard` + `@IpRateLimit` (`src/public-read.guard.ts`) | свой гард |
| токен | `randomToken` (`modules/identity/index.ts`) или `randomBytes(16).toString('base64url')` | предсказуемые ключи |
| время/место/дата | `@pokatim/i18n` `formatElapsed`, `formatPlace`, `formatLocalRange`, `heroDateText` (RC-6) | копии в `sharing` |
| разрез и вписывание линии | `@pokatim/route-view` `sliceLine`, `contourPath` (RC-7) | копия `slice` из `track-style.ts` |
| UI | `AsyncContent`, `Skeleton`, `Chip`, `Button`, `EmptyState`, `Banner` (`@rkarakulov/ui`); `DetailHeader`/оболочка как у `DisputeScreenShell` | спиннер, `Platform.OS` в экране |
| шаринг | `src/lib/share-story(.web).ts` рядом с `share-link`; фолбэк native — `downloadFile` | `Share`/`navigator.share` в экране |

### Contracts & compatibility

Все новые ответы приложения — новые схемы; старые клиенты не затронуты. `canShareStory` — `.default(false)`: новая
сборка со старым API — без кнопки. Запрос — `strictObject` (лишние ключи — 400). Ответ — `discriminatedUnion` по
`status`; незнакомый статус будущего сервера клиент разбирает как ошибку (экран — «Не удалось загрузить» с повтором).

### Data & migrations

Миграций нет, коллекций нет, outbox нет. Состояние — только Redis с TTL (ключи ниже). Стирание аккаунта: данных
пользователя в MongoDB модуль не хранит; PNG с именем живёт ≤ 24 ч — порт стирания не нужен (отметить в ADR-0018).

### Jobs & events

Очередь `story-card` (`QUEUE.storyCard`), задача `story-card.render`, процессор `StoryCardProcessor` (`concurrency: 1`)
в `SharingWorkerModule`. Дедупликация — NX-ключ постановки; `jobId` = `story-card-<hash>` (без `:`) — вторая линия.
`attempts: 2`, `backoff: exponential 2000`, `removeOnComplete/removeOnFail: true`. Задача перечитывает входы и
сверяет хэш: не совпал — `skipped` (ключ снят, PNG не пишется). Провал на последней попытке — ключ `failed` →
`{ status: 'failed' }` один раз. Событий нет.

### Security (checklist нужен: **да** — публичная ссылка, персональные данные (имя), зависимости, инфраструктура образа)

Дополнить §8.3 coder'ом по пунктам: AuthN — `AuthGuard`, `userId` только из access, заявка по `(raceId, userId)`;
входы — `Uuid`, `StoryCardQuery` strict, токен — regex до Redis (кривой — 404); наружу — PNG без e-mail, `userId`,
времени суток, координат вне сегмента; имя только через `RIDER_NAMES`; лимиты RC-15; PNG ≤ 2 МБ; логи — `entryId`,
шаблон, итог, байты, мс (без `userId`, имени, токена); аудит не нужен; новые зависимости `satori`, `@resvg/resvg-js`,
`@expo-google-fonts/*` (API), `expo-sharing`, `expo-file-system` (app) — `minimumReleaseAge` без исключений; RC-14.

### Requirements Consistency

§8.1: RC-1…RC-15, блокеров нет.

### Test matrix

См. «TESTS» ниже.

### Implementation Context

#### ENTRY POINTS

- API: `GET /v1/races/:raceId/entry/story-card?template=line|night` → `StoryCardController.status` →
  `StoryCardService.status(userId, raceId, template)`; `GET /v1/story-cards/:file` (`<token>.png`) →
  `StoryCardImageController.image` → `StoryCardCache.png(token)`; worker: `StoryCardProcessor.process` →
  `build(job, { finalAttempt })`.
- App: кнопка «Поделиться в сторис» в «Ваше участие» (`race-participation.tsx` после `<EntryResult>`), своя строка
  таблицы → `races/result/[id]/[entryId]` (своя ветка `RivalCardScreen`) → `router.push(storyPath(raceId))` →
  `src/app/races/story/[id].tsx`.

#### TYPES & SCHEMAS

`packages/contracts/src/sharing/story-card.schema.ts`:

```ts
/** Шаблоны карточки (только в конец): `line` — светлая схема темы, «карточка-линия»; `night` — тёмная, мастхед. */
export const STORY_CARD_TEMPLATES = ['line', 'night'] as const;
export const StoryCardTemplate = z.enum(STORY_CARD_TEMPLATES, { error: fieldError('INVALID') });
export type StoryCardTemplate = z.infer<typeof StoryCardTemplate>;

/** `GET /v1/races/:raceId/entry/story-card` — query; лишние ключи и незнакомый шаблон — 400. */
export const StoryCardQuery = z.strictObject({ template: StoryCardTemplate });
export type StoryCardQuery = z.infer<typeof StoryCardQuery>;

/** Капабилити-токен картинки: 128 бит, base64url без `=`. */
export const StoryCardToken = z.string().regex(/^[A-Za-z0-9_-]{22}$/);

/** Статус карточки: рендер в очереди / готово (токен → `storyCardImageUrl`) / последний рендер не удался (один раз). */
export const StoryCardStatus = z.discriminatedUnion('status', [
  z.object({ status: z.literal('pending') }),
  z.object({ status: z.literal('ready'), token: StoryCardToken }),
  z.object({ status: z.literal('failed') }),
]);
export type StoryCardStatus = z.infer<typeof StoryCardStatus>;

/** Экспорт PNG, px (геометрия — `storyCard` в `@pokatim/design-tokens`; здесь — для теста размера ответа). */
export const STORY_CARD_SIZE = { width: 1080, height: 1920 } as const;
```

`common.ts`: в конец `ErrorCode` — `// story-cards: карточки нет (нет заявки, времени, снята, DQ)` `'STORY_CARD_UNAVAILABLE'`
(409; текст — `apps/api/src/error-messages.ts`: «Карточки для этой гонки пока нет»).
`results.schema.ts` `MyRaceEntry.actions`: `canShareStory: z.boolean().default(false)` (комментарий: «карточка для
сторис доступна — `storyCardEligible` сервера»).

api-client:
`getStoryCard(accessToken, raceId, { template })` → `GET /v1/races/<id>/entry/story-card?template=…` (`authorized`,
`withCredentials`, `StoryCardStatus`); `storyCardImageUrl(token)` → `` `${baseUrl}/v1/story-cards/${encodeURIComponent(token)}.png` `` (без запроса).

Порт `results` — `apps/api/src/modules/results/results-for-sharing.port.ts` (экспорт через `results/index.ts`):

```ts
export const RESULTS_FOR_SHARING = Symbol('RESULTS_FOR_SHARING');
export interface StoryCardFacts {
  entryId: string;
  race: { title: string; windowStartsAt: Date; windowEndsAt: Date; routeId: string | null };
  status: 'provisional' | 'finisher' | 'final' | 'revised';
  elapsedSec: number;
  place: number | null;   // null — без места (finisher)
  tied: boolean;
  group: ResultGroupKey;
  /** попытка результата: строка протокола (опубликован) или `best`; разметка — для ключа кэша, без координат */
  attempt: { id: string; checkRevision: number; segment: [number, number] | null; linePoints: number | null };
}
export interface ResultsForSharing {
  /** Гонки нет (черновик, неизвестна) — 404 `NOT_FOUND`; заявки нет или `!storyCardEligible` — `null`. Snapshot. */
  storyCardFacts(userId: string, raceId: string): Promise<StoryCardFacts | null>;
  /**
   * Линия карточки (только worker): попытка `counted`, `trackMap.segment` есть и `linePoints === trackLine.length` —
   * `{ kind: 'attempt', line: sliceLine(line, from, to) }` (точек до ворот старта и после финиша нет); иначе линия
   * показа маршрута гонки (`kind: 'route'`); нет и её — `null`. Сырую линию активности наружу не отдаёт никогда.
   */
  storyCardLine(userId: string, facts: StoryCardFacts): Promise<{ kind: 'attempt' | 'route'; line: LonLat[] } | null>;
}
```

`results.policy.ts`: `storyCardEligible(entry: RaceEntryDoc | null, result: EntryResult): boolean` — тот же предикат
для `actions.canShareStory` в `myEntry` и для порта.

Порт `appearance` — `apps/api/src/modules/appearance/app-appearance.port.ts`: `APP_APPEARANCE`,
`interface AppAppearanceSource { activeThemeId(): Promise<AppThemeId> }` (`AppThemeId` из contracts; документа нет —
`DEFAULT_APP_THEME_ID`); `AppearanceCoreModule` (провайдеры `AppearanceRepository`, `AppAppearanceService`,
экспорт `AppearanceRepository`, `APP_APPEARANCE`), `AppearanceModule` импортирует его.

`sharing` — внутренние типы:

```ts
// story-card.inputs.ts
export interface StoryCardInput {
  template: StoryCardTemplate;
  themeId: AppThemeId;
  facts: StoryCardFacts;
  riderName: string | null;
}
/** sha256 hex канонического JSON: render-версия, шаблон, тема, имя, entryId, статус, время, место, ничья, группа,
 *  название и окно гонки, routeId, attempt.{id, checkRevision, segment, linePoints}. */
export function storyCardHash(input: StoryCardInput): string;
// story-card.cache.ts
export const STORY_CARD_RENDER_JOB = 'story-card.render';
export const StoryCardJob = z.object({ userId: z.string(), raceId: z.string(), template: StoryCardTemplate, hash: z.string() });
```

Ключи Redis (`STORY_CARD_POLICY` в `sharing.policy.ts`):

| Ключ | Значение | TTL |
|---|---|---|
| `story-card:token:<hash>` | токен | `pngTtlSec` = 86 400 |
| `story-card:png:<token>` | PNG (Buffer, `getBuffer`) | 86 400 (ставится в том же `MULTI`, что и ключ хэша; PNG — первым) |
| `story-card:pending:<hash>` | `1`, `SET NX` | `pendingTtlSec` = 120 |
| `story-card:failed:<hash>` | `1`, читается `GETDEL` | `failedTtlSec` = 600 |

`STORY_CARD_POLICY = { renderVersion: 1, pngTtlSec, pendingTtlSec, failedTtlSec, maxPngBytes: 2_000_000,
readLimit: { limit: 120, windowSec: 60 }, renderLimit: { limit: 30, windowSec: 3600 },
imageIpLimit: { limit: 120, windowSec: 60 }, jobAttempts: 2, jobBackoffMs: 2_000 }`. **Изменил разметку, тексты
или токены карточки — подними `renderVersion`** (иначе 24 ч отдаётся старая картинка).

Алгоритм `StoryCardService.status`: лимит чтения → `facts` (404/409) → тема, имя → хэш → `token:<hash>` есть и
`png:<token>` жив — `ready` → `GETDEL failed:<hash>` — `failed` → `claim` NX: захватил — лимит рендера (429 —
`release`), `queue.add` (сбой — `release`, исключение) → `pending`.

`design-tokens` — `src/story-card.ts` (px экспорта = прототип 360×640 × 3; `tracking` — em):

```ts
export interface StoryCardText {
  role: FontRole;             // 'display' | 'text'
  weight: 500 | 600;
  size: number; lineHeight: number;
  tracking?: number;          // em
  uppercase?: boolean;
}
export const storyCard = {
  size: { width: 1080, height: 1920 },
  insetX: 60,
  rule: 3,                    // 1 px превью: линии мастхеда, колонтитула, сетки, разделитель, подчёркивание
  titleMaxLines: 3,
  trackMaxPoints: 500,
  text: {
    masthead:  { role: 'display', weight: 600, size: 45, lineHeight: 54, tracking: 0.2, uppercase: true },
    colophon:  { role: 'display', weight: 600, size: 45, lineHeight: 54, tracking: 0.2, uppercase: true },
    kicker:    { role: 'text', weight: 600, size: 33, lineHeight: 42, tracking: 0.18, uppercase: true },
    kickerNight: { role: 'text', weight: 600, size: 39, lineHeight: 48, tracking: 0.12, uppercase: true },
    title:     { role: 'display', weight: 500, size: 75, lineHeight: 87 },
    date:      { role: 'text', weight: 500, size: 37.5, lineHeight: 51 },
    dateNight: { role: 'text', weight: 600, size: 39, lineHeight: 51 },
    time:      { role: 'display', weight: 600, size: 216, lineHeight: 222 },
    timeStep8: { role: 'display', weight: 600, size: 180, lineHeight: 192 },
    timeStep9: { role: 'display', weight: 600, size: 156, lineHeight: 168 },
    statValue: { role: 'display', weight: 600, size: 66, lineHeight: 78 },
    statLabel: { role: 'text', weight: 600, size: 33, lineHeight: 42, tracking: 0.14, uppercase: true },
  },
  night: {
    mastheadTop: 48, mastheadPadBottom: 24 /* [ASSUMPTION] RC-10 */, copyBottom: 66,
    titleGap: 24, dateGap: 12, tileGap: 30, tileHeight: 360, tileStroke: 7.2,
    statsGap: 24, statPadTop: 24, statDividerPad: 36,
  },
  line: {
    tier1Top: 72, kickerUnderlineGap: 6 /* [ASSUMPTION] */, titleGap: 24, dateGap: 12,
    tier2Top: 408, tier2Height: 900, tier2Width: 960, trackStroke: 9,
    startDot: 24, startRing: 6 /* [ASSUMPTION] RC-10 */,
    tier3Bottom: 168, tier3PadTop: 18, statPadTop: 24, statDividerPad: 36,
    colophonBottom: 48, colophonPadTop: 21,
  },
} as const;

/** Роли карточки из схемы темы (без hex): фон, текст, вторичный, акцент, линии; трек — `text.primary`, старт — `text.accent`. */
export function storyCardColors(scheme: AppTheme): {
  background: string; ink: string; muted: string; accent: string; rule: string; track: string; start: string;
};
// background = surface.default, ink = text.primary, muted = text.secondary, accent = text.accent,
// rule = border.strong (ярус 3 `line` — ink), track = text.primary, start = text.accent (кольцо — background)
```

`app-fonts.ts`: `appFontFaces: Readonly<Record<string, { display?: Record<500 | 600, FontFileId>; text?:
Record<400 | 500 | 600 | 700, FontFileId> }>>` — ровно нынешняя `FACES` из `apps/app/src/theme/fonts.ts`
(`FontFileId` — строковый литерал `'Manrope_700Bold'` и т. п.). Тест пакета: у каждой темы `appThemes` есть display
500/600 и text 500/600.

Гарнитура → TTF на сервере (`sharing/story-card.fonts.ts`): id `Family_WeightName` → пакет по префиксу
(`FONT_PACKAGES: { GolosText: 'golos-text', Inter: 'inter', InterTight: 'inter-tight', Manrope: 'manrope', Onest:
'onest', Oswald: 'oswald', PlayfairDisplay: 'playfair-display', RobotoCondensed: 'roboto-condensed' }`) →
`require.resolve('@expo-google-fonts/<pkg>/<WeightName>/<id>.ttf')` (у пакетов нет `exports` — глубокий путь
резолвится; файлы — `node_modules/@expo-google-fonts/manrope/700Bold/Manrope_700Bold.ttf`). Нужны 4 начертания на
тему: display 500/600, text 500/600. Грузить лениво по теме, кэш `Map<id, Buffer>` на процесс. В satori — имена
семейств по роли (`'display'`, `'text'`), не по гарнитуре (Manrope в обеих ролях с разными файлами для 600).

Итог по темам (display 500 / 600; text 500 / 600):
classic — PlayfairDisplay_500Medium / PlayfairDisplay_600SemiBold; Inter_500Medium / Inter_600SemiBold ·
atlas — Manrope_500Medium / Manrope_700Bold; Manrope_500Medium / Manrope_600SemiBold ·
chrono — RobotoCondensed_500Medium / RobotoCondensed_700Bold; Inter 500/600 ·
planner — Onest_500Medium / Onest_600SemiBold; Onest 500/600 ·
journal — GolosText_500Medium / GolosText_600SemiBold; GolosText 500/600 ·
navigation — InterTight_500Medium / InterTight_600SemiBold; Inter 500/600 ·
typography — Oswald_500Medium / Oswald_600SemiBold; Inter 500/600.

Рендер:
- `story-card.render.ts` — чистая `storyCardTree(input: StoryCardRenderInput): SatoriNode`, где
  `StoryCardRenderInput = { template; colors: ReturnType<typeof storyCardColors>; texts: { kicker; title; riderName |
  null; date; time; place | null; placeLabel; group; groupLabel; brand }; track: { points: [number, number][] /* уже в
  координатах яруса */; start: [number, number] } | null }`. Без IO, без React: узлы `{ type: 'div', props: { style,
  children } }` (тип satori — приведение в одном месте). Только flex; трек — `<svg viewBox>` + `<polyline>`/`<circle>`
  (радиус 0 — прямоугольники без скругления, точка старта — круг). Название — `lineClamp: titleMaxLines`; время — ступень
  по длине строки (RC-11).
- `story-card.texts.ts` — тексты из `facts` и имени через `@pokatim/i18n` (`formatElapsed`, `formatPlace`,
  `formatLocalRange` по `utcToMinskWallTime(...).slice(0, 10)` и `now = null`, `results.group.<key>`).
- `story-card.png.ts` — `renderStoryCardSvg(input, fonts)` (satori, `width/height` из `storyCard.size`) и
  `renderStoryCardPng(svg)` (`new Resvg(svg, { fitTo: { mode: 'width', value: 1080 }, font: { loadSystemFonts: false } })`
  — текст satori уже в путях); PNG > `maxPngBytes` — ошибка рендера (→ `failed`).
- Импорт из CJS: `require('satori').default` (проверено автором); `@resvg/resvg-js` — CJS. В `apps/api/package.json`
  — `satori`, `@resvg/resvg-js`, 8 пакетов `@expo-google-fonts/*` `^0.4.2` (как в app), `@pokatim/design-tokens`,
  `@pokatim/i18n`, `@pokatim/route-view` (`workspace:*`).

#### Модули и порты API

```
SharingModule (AppModule):
  imports: IdentityModule, ResultsCoreModule, ProfileCoreModule, AppearanceCoreModule,
           BullModule.registerQueue({ name: QUEUE.storyCard })
  controllers: StoryCardController (@Controller('races'), AuthGuard, `:raceId/entry/story-card`, no-store),
               StoryCardImageController (@Controller('story-cards'), `:file`, IpRateLimitGuard)
  providers: StoryCardService, StoryCardInputs, StoryCardCache, IpRateLimitGuard
SharingWorkerModule (WorkerModule):
  imports: ResultsCoreModule, ProfileCoreModule, AppearanceCoreModule, BullModule.registerQueue(...)
  providers: StoryCardInputs, StoryCardCache, StoryCardProcessor
```

`sharing → results | profile | appearance | identity` — только `index.ts`; на `sharing` не ссылается никто (циклов
нет). `ResultsCoreModule` требует `RESULT_DISPUTE_GATE` — его даёт `@Global DisputesCoreModule`, уже в обоих корнях.
`QUEUE.storyCard: 'story-card'` — `src/queues.ts` с комментарием (дедупликация — NX-ключ, итог — Redis с TTL).
`StoryCardInputs.resolve(userId, raceId, template)` — `facts` (порт) + `activeThemeId` + `publicNames` → `StoryCardInput`
и хэш; одна реализация для HTTP и worker (сверка «устарело»).

Ответ картинки: `Content-Type: image/png`, `Cache-Control: private, max-age=86400, immutable`,
`X-Content-Type-Options: nosniff`, `Content-Security-Policy: default-src 'none'; sandbox`, `Referrer-Policy:
no-referrer`, `Content-Disposition: inline; filename="pokatim-story.png"` — заголовки после чтения (образец `gpx`);
`:file` не по regex `^[A-Za-z0-9_-]{22}\.png$` или нет в Redis — один `404 NOT_FOUND` (JSON).

#### Образ api (Dockerfile / runtime-deps)

`infra/docker/Dockerfile` не меняется: `runtime-deps.mjs ./apps/api` копирует `dependencies` + **установленные**
`optionalDependencies` — у `@resvg/resvg-js` это платформенный бинарь; сборка `--platform linux/amd64` на
bookworm (glibc) ставит `@resvg/resvg-js-linux-x64-gnu`. `satori` — чистый JS + wasm yoga внутри пакета.
`@expo-google-fonts/*` в `dependencies` API → копируются целиком (~29 МБ на 8 пакетов; принять, отметить в pr.md).
Workspace-пакеты (`design-tokens`, `i18n`, `route-view`) — `dist` собирает `turbo run build --filter=@pokatim/api`
(зависимости `^build`). Проверка: `docker build --target api` + `node -e "require('@resvg/resvg-js')"` в образе — в
pr.md (или NOT VERIFIED). `allowBuilds` не нужен (у `@resvg/resvg-js` нет postinstall). `pnpm-lock.yaml` обновится.

#### Приложение

- Маршрут `src/app/races/story/[id].tsx` (тонкий: `useLocalSearchParams` → `StoryCardScreen raceId`), регистрация
  `<Stack.Screen name="races/story/[id]" />` **внутри первого `Stack.Protected`** рядом с `races/result/[id]/[entryId]`
  (гость → вход, без таб-бара); в `__tests__/app-routes.ts`. Без `loader`, SSR-меты, OG (экран за входом).
- `features/races/story/queries.ts`: `storyCardKey(raceId, template) = ['races','story',raceId,template]`;
  `useStoryCard(raceId, template)` — `withAccessToken((t) => api.getStoryCard(t, raceId, { template }))`,
  `refetchInterval: (q) => q.state.data?.status === 'pending' && !expired ? 1000 : false` (`STORY_POLL_MS = 1000`,
  `STORY_POLL_LIMIT_MS = 30_000`, отсчёт от первого `pending` ключа — ref; истекло — состояние ошибки с повтором,
  повтор сбрасывает отсчёт и `refetch`), `staleTime: DEFAULT_STALE_MS`; ошибка `STORY_CARD_UNAVAILABLE` — не ретраить
  (`retry` по коду). `useStoryFile(token)` — ключ `[...storyCardKey, 'file', token]`, `queryFn: prepareStory(api.
  storyCardImageUrl(token))`, `staleTime: Infinity`, `gcTime` 5 мин, только при `ready`.
- `features/races/story/story-card-screen.tsx`: оболочка как `DisputeScreenShell` (заголовок «Карточка для сторис»,
  назад к гонке), чипы шаблонов `Chip` (радиогруппа, a11y), превью 9:16 (`expo-image` `Image`, ширина — колонка,
  `aspectRatio` 9/16 — раскладка, не px), скелетон той же пропорции на `pending`/первой загрузке, `failed`/таймаут/сеть —
  `AsyncContent`-ошибки («Нет соединения» / «Не удалось загрузить» + повтор), 409 — `EmptyState` «Карточки пока нет» +
  «К гонке» (`dismissTo` `/races/<id>`), primary — «Поделиться» (`shareMode === 'share'`) или «Скачать PNG»
  (disabled, пока файл не готов; индикатор в кнопке), подсказка про имя — `textStyle('meta')`. Ошибка шаринга —
  `Banner` над кнопкой; `dismissed` — без сообщения.
- `src/lib/share-story.ts` (native): `prepareStory(url) → { uri }` — `File.downloadFileAsync(url, new File(Paths.cache,
  'story-<token>.png'), { idempotent: true })` (`expo-file-system`); `storyShareMode(file)` — `'share'` если
  `requireOptionalNativeModule('ExpoSharing')` (реэкспорт `expo`) не `null`, иначе `'download'`;
  `shareStory(file)` — ленивый `await import('expo-sharing')` → `shareAsync(file.uri, { mimeType: 'image/png', UTI:
  'public.png', dialogTitle })` → `'shared'`; `'download'` — `downloadFile(url)`. Версия `expo-sharing` —
  **`~58.0.19`** (`node_modules/expo/bundledNativeModules.json`; ставить `pnpm --filter @pokatim/app exec expo install
  expo-sharing`), плагина в `app.json` не нужно.
- `src/lib/share-story.web.ts`: `prepareStory(url) → File` (`fetch` → `blob` → `new File([blob], 'pokatim-story.png',
  { type: 'image/png' })`); `storyShareMode(file)` — `navigator.canShare?.({ files: [file] }) ? 'share' : 'download'`;
  `shareStory(file)` — `navigator.share({ files: [file] })` синхронно в обработчике (RC-13), `AbortError` →
  `'dismissed'`; `'download'` — `URL.createObjectURL` + `<a download="pokatim-story.png">` + `revokeObjectURL`.
  Типы итога — общие с `share-link` (`ShareOutcome` + `'downloaded'`).
- Вход 1: `race-participation.tsx` — `Button variant="secondary"` «Поделиться в сторис» после `<EntryResult>`, только
  `entry.actions.canShareStory`.
- Вход 2: `results-table.tsx` — новый проп `ownRowAction?: (() => void) | null`; своя строка: `onPress={own ?
  (ownRowAction ?? null) : …}`. `race-detail.tsx` передаёт `ownRowAction` при `signedIn &&
  entry.data?.actions.canShareStory` → `router.push(rivalPath(race.id, ownEntryId, group))`. `rival-card.tsx`: своя
  заявка (`entry.data?.entry?.id === entryId`) — заголовок «Ваш результат», `RivalResult` + кнопка «Поделиться в
  сторис» (по `canShareStory`), без `RivalAction`/подачи; путь `storyPath(raceId)` — `features/races/story/paths.ts`.
- i18n (`ru.ts`): `races.result.shareStory` «Поделиться в сторис»; `races.result.ownTitle` «Ваш результат»;
  `story.title` «Карточка для сторис»; `story.template.line` «Линия»; `story.template.night` «Ночь»;
  `story.templates` (подпись группы чипов); `story.share` «Поделиться»; `story.download` «Скачать PNG»;
  `story.hint` «Имя на карточке — только с вашим согласием в профиле»; `story.empty.title` «Карточки пока нет»;
  `story.empty.action` «К гонке»; `story.preview` (a11y превью «Карточка для сторис: {race}»); `story.shareFailed`;
  карточка: `storyCard.kicker` «Гонка», `storyCard.kickerProvisional` «Гонка · Предварительный», `storyCard.place`
  «Место», `storyCard.group` «Группа», `storyCard.brand` «Покатим» (регистр — `uppercase` токена).

#### FILES TO MODIFY / CREATE

Create:
- `packages/contracts/src/sharing/story-card.schema.ts`, `story-card.schema.test.ts`
- `packages/i18n/src/format.ts`, `format.test.ts`
- `packages/design-tokens/src/story-card.ts`, `app-fonts.ts`, `story-card.test.ts`
- `packages/route-view/src/line-geometry.ts`, `line-geometry.test.ts`
- `apps/api/src/modules/results/results-for-sharing.port.ts`, `results-for-sharing.ts`
- `apps/api/src/modules/appearance/app-appearance.port.ts`, `app-appearance.service.ts`
- `apps/api/src/modules/sharing/{index,sharing.module,sharing.policy,story-card.controller,story-card-image.controller,
  story-card.service,story-card.inputs,story-card.cache,story-card.processor,story-card.texts,story-card.render,
  story-card.png,story-card.fonts}.ts` + тесты (ниже)
- `apps/app/src/app/races/story/[id].tsx`
- `apps/app/src/features/races/story/{story-card-screen.tsx,queries.ts,paths.ts,story-format.ts}`
- `apps/app/src/lib/share-story.ts`, `share-story.web.ts` + тесты
- `docs/adr/0018-story-cards.md`

Modify:
- `packages/contracts/src/common.ts` (код), `src/results/results.schema.ts` (`canShareStory`), `src/index.ts`
- `packages/api-client/src/index.ts` (+ `results.test.ts`/новый `sharing.test.ts`)
- `packages/i18n/src/index.ts`, `ru.ts`
- `packages/design-tokens/src/index.ts`
- `packages/route-view/src/index.ts`
- `apps/api/package.json`, `pnpm-lock.yaml`
- `apps/api/src/queues.ts`, `app.module.ts`, `worker.module.ts`, `error-messages.ts`
- `apps/api/src/modules/results/{index,results.module,results.policy,results-read.service}.ts`
- `apps/api/src/modules/appearance/{index,appearance.module,appearance.service}.ts`
- `apps/app/package.json` (`expo-sharing ~58.0.19`, `expo-file-system ~58.0.10`), `jest.setup.ts` (моки
  `expo-sharing`, `expo-file-system`)
- `apps/app/src/app/_layout.tsx`, `src/__tests__/app-routes.ts`
- `apps/app/src/theme/fonts.ts` (таблица из `appFontFaces`)
- `apps/app/src/features/races/format.ts`, `participation-format.ts`, `src/features/standings/standings-format.ts`,
  `src/lib/minsk-format.ts` (импорт/реэкспорт из `@pokatim/i18n`)
- `apps/app/src/features/maps/track-style.ts`, `src/features/routes/route-contour-path.ts` (из `@pokatim/route-view`)
- `apps/admin/src/format.ts` (`formatElapsed` из `@pokatim/i18n`)
- `apps/app/src/features/races/{participation/race-participation.tsx,results-table.tsx,race-detail.tsx,
  disputes/rival-card.tsx}`
- `docs/adr/README.md`, `docs/product/races-and-seasons.md`, `docs/runbooks/local-dev.md`
- `.claude/rules/{pokatim-backend,pokatim-contracts,pokatim-app,pokatim-security}.md` — абзацы о `sharing`,
  `StoryCardStatus`, экране и шаринге, капабилити-ссылке

#### FILES TO READ

`apps/api/src/modules/disputes/dispute-series.{cache,service,processor}.ts`, `dispute-series.int.test.ts`;
`apps/api/src/modules/results/{results-read.service,results-for-disputes,results.policy,results.collection}.ts`;
`apps/api/src/modules/routes/routes-public.controller.ts` (`gpx`), `src/public-read.guard.ts`;
`apps/api/src/modules/appearance/*`; `apps/api/src/modules/profile/rider-names.port.ts`; `apps/api/test/{harness,
results}.ts` (`corridorRace`, `rideGpx`, `enterRace`, `travelTo`); `packages/design-tokens/src/{app-themes,brand}.ts`;
`apps/app/src/theme/fonts.ts`; `apps/app/src/features/maps/track-style.ts`, `features/routes/route-contour-path.ts`;
`apps/app/src/lib/{share-link,share-link.web,download-file}.ts`; `apps/app/src/features/races/disputes/{rival-card,
dispute-screen}.tsx`; `apps/app/src/app/_layout.tsx`; `infra/docker/{Dockerfile,runtime-deps.mjs}`.

#### TESTS

Unit (vitest):
- `packages/contracts` — `StoryCardQuery` (нет/незнакомый шаблон/лишний ключ — ошибка), `StoryCardStatus`
  (`ready` без токена/кривой токен — ошибка), `MyRaceEntry` без `canShareStory` → `false`.
- `packages/i18n` `format.test.ts` — перенесённые кейсы `formatElapsed` («0:32:19», «25:01:01»), `formatPlace`
  («=3»), `formatLocalRange` (с годом при `now = null`).
- `packages/design-tokens` — `storyCard` = прототип × 3 (выборочно: 1080×1920, inset 60, time 216/222, ступени),
  `storyCardColors` для 7 тем × 2 схем без `undefined`; `appFontFaces` покрывает гарнитуры всех тем.
- `packages/route-view` `line-geometry.test.ts` — `sliceLine` (дробные границы, зажатие, пустой → `null`),
  `contourPath` — перенесённые кейсы.
- `apps/api/.../results.policy.test.ts` — `storyCardEligible`: `provisional|finisher|final|revised` с временем — да;
  `dq`, `withdrawn`, `pending`, `not_counted`, `dns`, `none`, без времени — нет.
- `apps/api/.../sharing/story-card.render.test.ts` (настоящие satori + шрифты):
  1. **приватность**: линия с маркерными точками до ворот и после финиша → `storyCardLine`/`sliceLine` + SVG — в
     `polyline` нет проекций маркерных точек, первая точка = позиция ворот старта (AC6);
  2. **имя**: `riderName: null` — в SVG/дереве нет строки имени; с именем — есть;
  3. **цвета темы**: `line` — `fill` фона = `schemes.light.surface.default`, `night` — `schemes.dark…` для `classic`,
     `chrono`, `typography`; смена темы — другой фон;
  4. ступени времени по длине строки; `lineClamp` названия; без линии — ярус пустой, без ошибки.
- `story-card.png.test.ts` — PNG-сигнатура, IHDR 1080×1920, размер ≤ `maxPngBytes`.
- `story-card.fonts.test.ts` — все id начертаний 7 тем резолвятся в существующие `.ttf`.
- `story-card.inputs.test.ts` — хэш стабилен при равных входах; меняется от темы, шаблона, имени, места, ревизии,
  `renderVersion`.

Int (реальные MongoDB + Redis, `createApiHarness`; `sharing/story-card.int.test.ts`):
- 401 без входа; 400 — нет `template`, `template=foo`, лишний ключ; 404 — неизвестная гонка; 409
  `STORY_CARD_UNAVAILABLE` — без заявки, заявка без времени, отменённая, DQ (`seedDispute` + `disqualify`);
- первый GET → `pending`, повтор → `pending` и **одна** задача в очереди (NX); `StoryCardProcessor.build` напрямую →
  GET → `ready` + токен; GET `/v1/story-cards/<token>.png` → 200, `image/png`, заголовки, IHDR 1080×1920; повторный
  GET статуса → тот же токен;
- смена темы (`appearance` репозиторий) / согласия имени (`PATCH /v1/profile`) → `pending` с новым хэшем;
- неизвестный токен и кривое имя файла → 404 JSON без `Content-Type: image/png`;
- `myEntry.actions.canShareStory` — `true` с временем, `false` без;
- провал на последней попытке → `failed` один раз, следующий GET → `pending` (новая постановка);
- лимит постановок → 429 и ключ постановки снят;
- **отрицательные доказательства**: (а) задача с устаревшим хэшем (место/тема сменились) → `skipped`, PNG не записан
  (без сверки хэша — тест краснеет: старая картинка под новым ключом); (б) без NX-ключа два GET дают две задачи;
- приватность на настоящей сверке: заезд `rideGpx` с подъездом до старта → линия карточки = `sliceLine` по
  `trackMap.segment`, ни одна точка подъезда не попадает в `storyCardLine`.

App (jest-expo, Testing Library):
- «Ваше участие»: кнопка только при `actions.canShareStory`; старый ответ без поля — кнопки нет.
- Таблица: своя строка нажимаема только с `ownRowAction`; чужие — как раньше (регресс споров).
- `rival-card` своя заявка: «Ваш результат», время/место, «Поделиться в сторис», нет «Подать спор».
- Экран карточки: скелетон на `pending`; опрос 1 с и таймаут 30 с (fake timers) → «Не удалось загрузить» + повтор;
  `ready` → превью и «Поделиться»; `failed` → ошибка с повтором; 409 → «Карточки пока нет» + «К гонке»; смена чипа —
  другой ключ запроса; гость → гард (вход).
- `share-story.test.ts` (native, моки): скачивание в кэш → `shareAsync` с `image/png`; нет `ExpoSharing` → режим
  `download` и `downloadFile`. `share-story.web.test.ts`: `canShare` true → `navigator.share({ files })`;
  `AbortError` → `dismissed`; нет `canShare` → `<a download>` по blob.
- `app-routes`/гард: `races/story/[id]` внутри `Stack.Protected`; `theme-guards` — шрифты через `appFontFaces`.

e2e: не требуется (экран за входом, нет SSR); ручная проверка шаринга на iOS/Android после dev-сборки — в pr.md
(NOT VERIFIED, если не делалась); PNG трёх тем — артефакты отчёта (AC8).

#### Порядок реализации (TDD)

1. Пакеты-переносы без смены поведения: `@pokatim/i18n` `format.ts`, `@pokatim/route-view` `line-geometry.ts`,
   `@pokatim/design-tokens` `app-fonts.ts` — тесты переносятся первыми, app/admin переключаются, `pnpm check` зелёный.
2. Контракты + api-client (тесты схем и клиента) + код ошибки + `canShareStory`.
3. Токены `storyCard` + `storyCardColors` (тесты).
4. `results`: `storyCardEligible` (unit) → порт `RESULTS_FOR_SHARING` + `actions.canShareStory` (int на `myEntry`).
5. `appearance`: `AppearanceCoreModule` + порт (int: тема по умолчанию / сохранённая).
6. `sharing` рендер: шрифты → `storyCardTree` → SVG/PNG (unit: приватность, имя, цвета, размер).
7. `sharing` HTTP + кэш + процессор + очередь (int-матрица, отрицательные доказательства) + регистрация в
   `AppModule`/`WorkerModule`/`queues.ts`.
8. App: `share-story(.web)` (unit) → запросы и экран (тесты состояний) → входы (participation, таблица, rival-card) →
   маршрут и гард.
9. ADR-0018, продуктовый документ, runbook, правила `.claude/rules/pokatim-*`; `pnpm check`; PNG трёх тем.

#### OUT OF SCOPE

§4 + дополнительно: OG-картинки и публичная страница карточки; кэш PNG в MongoDB/S3; отзыв выданных токенов;
`app.json` config plugin `expo-sharing` (приём шаринга в приложение); фото и выбор цвета пользователем; шаблоны
кроме `line`/`night`; карточка из таблицы финишёров (своя строка финишёров не нажимается — вход 1 её покрывает);
табличные цифры (RC-11); экран провалов задач в панели; перевод `notification-texts` на `@pokatim/i18n`.

### Documentation Impact

- `docs/adr/0018-story-cards.md` (Accepted после ревью): R1, шаблоны, токены, капабилити-URL и лог (RC-14),
  `failed`, отсутствие порта стирания (≤ 24 ч), табличные цифры, `renderVersion`; индекс `docs/adr/README.md`.
- `docs/product/races-and-seasons.md` — «Поделиться в сторис»: входы, шаблоны, что на карточке, имя по согласию.
- `docs/runbooks/local-dev.md` — новый нативный модуль `expo-sharing`: нужна новая dev-сборка; без неё — «Скачать
  PNG» через браузер. `docs/runbooks/deploy.md` — рост образа api (шрифты, бинарь resvg).
- `.claude/rules/pokatim-backend.md` (модуль `sharing`, очередь `story-card`, порты `RESULTS_FOR_SHARING`,
  `APP_APPEARANCE`), `pokatim-contracts.md` (`story-card.schema.ts`, `canShareStory`), `pokatim-app.md` (экран,
  `share-story`, входы), `pokatim-security.md` (капабилити-ссылка, лимиты, логи).
- pr.md: новые зависимости (api: satori, @resvg/resvg-js, @expo-google-fonts/*; app: expo-sharing, expo-file-system),
  новая dev-сборка, без миграций и env.

# 12. Outcome (заполняет coder)

## Changes

- Пакеты: форматтеры результата и дат → `@pokatim/i18n` (`format.ts`), геометрия линии → `@pokatim/route-view`
  (`line-geometry.ts`: `pointAt`, `sliceLine`, `contourPath`), таблица начертаний `appFontFaces` и токены `storyCard`
  + `storyCardColors` → `@pokatim/design-tokens`; приложение и панель переключены (реэкспорт, без смены поведения).
- Контракты: `story-card.schema.ts` (`STORY_CARD_TEMPLATES`, `StoryCardQuery`, `StoryCardStatus` pending|ready|failed,
  `StoryCardToken`, `STORY_CARD_SIZE`), `MyRaceEntry.actions.canShareStory` (`.default(false)`), код
  `STORY_CARD_UNAVAILABLE`; api-client `getStoryCard`, `storyCardImageUrl`.
- API: `results` — `storyCardEligible`, порт `RESULTS_FOR_SHARING`, `actions.canShareStory` в «моём участии»;
  `appearance` — `AppearanceCoreModule` + порт `APP_APPEARANCE`; новый модуль `sharing` (контроллеры статуса и PNG,
  сервис, кэш Redis, входы и хэш, процессор очереди `story-card`, рендер satori + resvg, шрифты `@expo-google-fonts`).
- App: экран `races/story/[id]` (чипы «Линия»/«Ночь», превью 9:16, скелетон, ошибки, 409, «Поделиться»/«Скачать
  PNG»), `share-story(.web).ts`, входы в «Ваше участие» и через свою строку таблицы («Ваш результат»).
- Документы: ADR-0018 (сверен с реализацией: `token`, `failed`, RC-11, RC-14, без порта стирания), продуктовый
  документ, runbooks, правила зон.

## Files touched

- packages: `i18n/src/{core,format,format.test,index,ru}.ts`, `i18n/{package.json,vitest.config.ts}`;
  `route-view/src/{line-geometry,line-geometry.test,index}.ts`; `design-tokens/src/{app-fonts,story-card,
  story-card.test,index}.ts`; `contracts/src/{sharing/story-card.schema,sharing/story-card.schema.test,common,
  common.test,index,results/results.schema}.ts`; `api-client/src/{index,sharing.test}.ts`.
- api: `package.json`, `scripts/story-card-preview.ts`, `src/{app.module,worker.module,queues,error-messages}.ts`,
  `src/modules/sharing/*` (новый), `src/modules/results/{index,results.module,results.policy,results.policy.test,
  results-read.service,results-for-sharing.port,results-for-sharing,results-disputes.int.test,
  results-entries.int.test}.ts`, `src/modules/appearance/{index,appearance.module,app-appearance.port,
  app-appearance.service}.ts`.
- app: `package.json`, `jest.setup.ts`, `src/app/_layout.tsx`, `src/app/races/story/[id].tsx`,
  `src/features/races/story/*`, `src/lib/{share-story,share-story.web,load-expo-sharing}.ts` + тесты,
  `src/features/races/{format,participation-format,race-detail,results-table}.ts(x)`,
  `participation/race-participation.tsx`, `disputes/rival-card.tsx`, `src/features/standings/standings-format.ts`,
  `src/features/maps/track-style.ts`, `src/features/routes/route-contour-path(.test).ts`, `src/lib/minsk-format.ts`,
  `src/theme/fonts.ts`, `src/__tests__/{app-routes,races-fixtures,story-card.test}.ts(x)`.
- admin: `src/format.ts`. Корень: `pnpm-lock.yaml`.

## Docs updated

`docs/adr/0018-story-cards.md`, `docs/adr/README.md`, `docs/product/races-and-seasons.md`, `docs/runbooks/local-dev.md`,
`docs/runbooks/deploy.md`, `.claude/rules/{pokatim-backend,pokatim-contracts,pokatim-app,pokatim-security}.md`.

## Tests

- Новые unit: i18n `format.test.ts`; route-view `line-geometry.test.ts`; design-tokens `story-card.test.ts`; contracts
  `story-card.schema.test.ts`; api-client `sharing.test.ts`; api `results.policy.test.ts` (`storyCardEligible`),
  `sharing/story-card.{render,png,fonts,inputs}.test.ts` (приватность линии AC6, имя, цвета classic/chrono/typography,
  ступени времени, lineClamp, IHDR 1080×1920, шрифты 7 тем, хэш).
- Int (`sharing/story-card.int.test.ts`, 12): 401/400/404/409 (без заявки, без времени, DQ, снята), pending → одна
  задача → ready → PNG с заголовками, тот же токен; смена темы и согласия имени → новая картинка; 404 JSON токена;
  логи без `userId`/токена; `failed` один раз → повтор ставит; лимит рендера 429 и снятие ключа; отрицательные
  доказательства: устаревший хэш → `skipped` (сверка хэша убрана → тест красный: `expected 'ready' to be 'skipped'`),
  без NX — две постановки; приватность на настоящей сверке `clean.gpx` (`sliceLine` по `trackMap.segment`, точек до
  ворот нет), без разметки — линия маршрута.
- App (jest): `share-story.test.ts`, `share-story.web.test.ts`, `__tests__/story-card.test.tsx` (входы, опрос,
  таймаут 30 с, failed, 409, смена шаблона).
- `TURBO_CONCURRENCY=1 MONGO_URL_TEST=…pokatim_storycards_test… REDIS_URL_TEST=redis://127.0.0.1:6491/1 pnpm check`
  → EXIT 0 (Redis — db 1: стенд test-kit отклоняет db 0):

```
All matched files use Prettier code style!
✔ no dependency violations found (1624 modules, 5950 dependencies cruised)
@pokatim/app:test: Test Suites: 191 passed, 191 total
@pokatim/app:test: Tests:       1736 passed, 1736 total
@pokatim/api:test:  Test Files  141 passed (141)
@pokatim/api:test:       Tests  1543 passed (1543)
 Tasks:    15 successful, 15 total
```

- Сборка api (`turbo run build --filter=@pokatim/api`) и рендер из `dist` (CJS) — PNG получен.

## Open follow-ups

- NOT VERIFIED: `docker build --target api` + `require('@resvg/resvg-js')` в образе amd64; шаринг на устройствах
  iOS/Android (нужна новая dev-сборка с `expo-sharing`), Instagram Stories в листе Android; web Share в Safari/Chrome
  на телефоне.
- PNG превью (не в git): все 7 тем × 2 шаблона × 3 случая — сверить с прототипом на ревью (RC-10: точка старта,
  отступ мастхеда, ширина плитки — [ASSUMPTION]).
- Группа зачёта длинной подписью («Мужчины до 40») в паре — одна строка при 66 px; более длинные подписи переносятся.
