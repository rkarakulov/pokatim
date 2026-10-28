# Профиль райдера: аватар, клуб, история заездов, статистика, публичный профиль

Уровень: task3. Два PR: **A** — API, модель и контракты; **B** — приложение. Достижения («Вспышка достижения») — следующая
задача.

## 1. Title

Профиль райдера (экран 10 прототипа).

## 2. Goal

У райдера есть свой профиль: фото, имя, клуб, сводная статистика, сезон и история гонок и райдов. Другие видят
публичный профиль райдера, только если райдер согласился показывать имя. Удаление аккаунта стирает фото.

**Прототип.** Отдельного экрана «Профиль райдера» в прототипах нет: в `key-*.html` его нет ни как рамки, ни как
подписи. Профиль собран из фрагментов прототипа:

- шапка профиля `.phead`: поверхность высотой героя с контуром, квадратный аватар 56 px, имя, под ним «личная линия»
  `.prule` — строка меты между ink-линией и линией `border`;
- рамка D-43 «Место в сезоне»: «‹ Профиль», блок «Сезон 2026», строки `rr` (место · название + дата + плашка ·
  время), «Гонки сезона · в зачёте N»; профиль открыт **аватаром с Главной**;
- строки таблиц: квадратный аватар, имя, вторая строка — «Тренер: …» или клуб «Velo Club Minsk» простым текстом, не
  ссылкой;
- шит соперника: имя, аватар и тренер;
- значки «Эмаль» (`.bdg`) — место будущих достижений.

## 3. Scope

### PR A — API (`apps/api`, `packages/contracts`, `packages/api-client`)

1. **Профиль.** В `profiles` добавляются поля:
   - `club` — необязательное, 2–60 символов одной строкой, правила как у `RiderPublicName`, без служебных подписей;
   - `avatarId`;
   - `publicId` — непрозрачный id публичного профиля.

   `ProfileView` получает `club`, `avatar` (`{ id } | null`) и `publicId`, все с `.default`. `publicId` не `null` только
   при наличии имени и согласия. `UpdateProfileRequest` принимает ключ `club`.
2. **Аватар.**
   - `PUT /v1/profile/avatar`: тело `application/octet-stream` до 10 МиБ. Query `{ x, y, size }` — доли 0..1,
     квадрат в ориентированном изображении; без query — центральный квадрат. Формат определяется по сигнатуре:
     JPEG, PNG или WebP.
   - Сервер (`sharp`) поворачивает по EXIF, обрезает квадрат и приводит к 512×512 JPEG без метаданных (EXIF и GPS
     стираются). Лимит пикселей входа — 40 Мп.
   - Байты хранятся в Mongo, коллекция `profile_avatars`, `_id` — `randomToken`. Новый аватар заменяет прежний, и
     старый документ удаляется в той же транзакции.
   - `DELETE /v1/profile/avatar` — идемпотентно. Оба метода отвечают `ProfileView`.
   - Лимиты: 20 загрузок в час на пользователя, слоты 2 на процесс и 1 на пользователя.
   - `GET /v1/avatars/:id` — публичный, `image/jpeg`, `public, max-age=31536000, immutable`, `nosniff`,
     `CSP sandbox`; нет записи — 404.
3. **Статистика своего профиля** — `GET /v1/profile/stats` (`no-store`):
   - км и набор по своим основным заездам `activities` (без дублей);
   - число заездов;
   - число гонок с результатом;
   - число подиумов и лучшие места — топ-3 по финальным протоколам.

   Расчёт дешёвый: индексные чтения по `userId`, без сканов чужих данных; при необходимости — покрывающий индекс
   (миграция).
4. **История гонок** — `GET /v1/profile/races?cursor&limit`: свои заявки без снятых, от новых гонок к старым.
   Элемент: гонка (id, название, даты окна), статус результата (`RACE_RESULT_STATUSES`), место и ничья, группа,
   уровень, время. Место — как в «моём участии» гонки: снимок протокола или предварительное.
5. **История райдов** — `GET /v1/profile/rides?cursor&limit`: прошедшие неотменённые и нескрытые райды, где
   пользователь — организатор или «Иду». Элемент: id, название, начало, плановая дистанция, роль.
6. **Публичный профиль:**
   - `GET /v1/riders/:publicId` — имя, клуб, аватар, публичная статистика (гонки, подиумы, лучшее место);
   - `GET /v1/riders/:publicId/races` — только опубликованные протоколы: место, группа, время.

   Только при имени и согласии `showNameInResults`, иначе 404. Кэш `public, max-age=60`, `PublicReadGuard`. Без
   `userId`, км, набора и райдов.
7. **Удаление аккаунта.** `ProfileErasure.erase` стирает аватары пользователя: документы `profile_avatars` по
   `userId`, затем профиль. После удаления `publicId` даёт 404, а аватар по старому id — 404.
8. **Документы:** ADR-0018 «Аватары» (хранение, отдача, обработка), `docs/product/profile.md` (P5 → решения R1–R10),
   `docs/product/account.md` (стирание аватара), `.claude/rules/pokatim-*.md`.

### PR B — приложение (`apps/app`, `packages/i18n`)

1. **`/profile`** — свой профиль внутри `Stack.Protected`:
   - шапка с аватаром (или пустой квадрат «Личная линия»), именем или «Имя не указано» и клубом в личной линии;
   - «Редактировать профиль» → `/settings/profile`;
   - статистика — `StatBlock`;
   - блок «Сезон» — переезжает из `settings/profile`;
   - история «Гонки / Райды» — `SegmentedControl`, «Показать ещё»; гонка → `/races/[id]`, райд → `/rides/[id]`;
   - «Как вас видят другие» → `/riders/[publicId]`; без `publicId` — подсказка про показ имени;
   - место под достижения — только комментарий в коде: пустых заглушек нет (правило «без заглушек „скоро“»).
2. **Вход в профиль** — квадратный аватар справа в `TopBar` Главной (рядом с «Настройками»).
3. **`/settings/profile`** — «Редактировать профиль»: фото («Выбрать фото», «Удалить фото»), имя, клуб, согласие.
   Выбор фото:
   - native — `expo-image-picker` с системной обрезкой 1:1, ленивый импорт: старый dev-клиент без модуля получает
     «Обновите приложение»;
   - web — выбор файла и свой экран обрезки: квадрат, перетаскивание, масштаб «+/−» и клавиши; на сервер уходят доли
     `x, y, size`.
4. **`/riders/[id]`** — публичный профиль, в корневом `Stack` вне `Stack.Protected`: SSR (`loader` — посев,
   `generateMetadata` — `noindex`, без ПДн в мета), история гонок с «Показать ещё». Шаг смоука `e2e/web.spec.ts`.

## 4. Out of Scope

- Достижения и значки «Эмаль».
- Тренер (в прототипе — «Тренер: …» в строках; сущности тренера нет).
- Аватар и ссылка на публичный профиль в строках таблиц результатов и рейтинга сезона, имя и аватар в шите
  соперника — follow-up: эти экраны сейчас правит параллельная сессия, A12 06.
- Модерация клуба и аватара: сброс модератором, жалобы — follow-up, риск в 8.
- S3, подписанные URL и CDN для аватаров.
- Километры райдов: факта «проехал» нет, только плановая дистанция организатора.

## 5. Architecture Context

- ADR-0007 (Mongo), ADR-0008 (`AuthGuard`), ADR-0011 (файлы: «наружу не выдаются» — для аватаров исключение,
  ADR-0018), ADR-0012 (результаты), ADR-0013 (райды), ADR-0015 (удаление).
- Граница модулей: profile читает результаты, треки и райды только через порты `index.ts`. История гонок — в модуле
  results, история райдов — в rides; контроллеры под путём `/profile/…` допустимы в своих модулях.

## 5.1 Placement & Reuse Gate

- Загрузка тела — `admit` → `readLimited` (`raw-body.ts`) → сервис, слоты — `UploadSlots`; курсоры — `page-cursor.ts`;
  публичное — `PublicReadGuard` + `PUBLIC_READ_CACHE_CONTROL`; место — существующая логика «моего участия» (не
  дублировать ранжирование).
- Публичный профиль и статистика — новый модуль-композиция `riders` (`profile` не может импортировать `results`:
  цикл `results → profile`, 11.1); данные — порты `RIDER_PROFILES` (`profile`), `RIDER_RESULTS` (`results`),
  `ACTIVITY_TOTALS` (`tracks`, отдельный порт — `ActivitySource` не расширяется). Текущая ревизия протокола —
  `ResultsRepository.currentRevisions` (уже есть, им пользуется `standings`); `randomToken` — `modules/identity`.
- Приложение: `StatBlock`, `SegmentedControl`, `AsyncContent`, `TextAction`, `DetailHeader`, `public-ssr.ts`,
  `useLoaderSeed`, `share-link` — переиспользуются.

## 6. Relevant Files

PR A — полный список в 11.8. Ключевые:

- `apps/api/src/modules/profile/` — `profile.{collection,repository,service,module}.ts`, `profile-erasure.ts`;
  новые `profile-avatar*.ts`, `avatar-image.ts`, `avatars-public.controller.ts`, `rider-profiles*.ts`.
- `apps/api/src/modules/results/` — `results-read.service.ts` (`entryResult`), `results.repository.ts`
  (`currentRevisions`), `entries.service.ts`; новые `results-history.service.ts`, `profile-races.controller.ts`,
  `rider-results*.ts`.
- `apps/api/src/modules/rides/` — `rides.repository.ts`; новые `profile-rides.controller.ts`, `rides-history.service.ts`.
- `apps/api/src/modules/tracks/` — новые `activity-totals*.ts`; `index.ts`, `tracks.module.ts`.
- `apps/api/src/modules/riders/` — новый модуль-композиция.
- `apps/api/src/{raw-body,upload-slots,page-cursor,public-read.guard}.ts`, `apps/api/src/db/migrations/`.
- `packages/contracts/src/profile/`, `packages/contracts/src/common.ts`, `packages/api-client/src/index.ts`.

## 7. Implementation Notes

- `sharp` — зависимость `apps/api`. Образ `node:24-bookworm-slim` (glibc, amd64): готовые бинарники `@img/sharp-*`
  ставятся как optionalDependencies, `runtime-deps.mjs` их копирует. `sharp.cache(false)`, `concurrency(1)`.
  `limitInputPixels`, `failOn: 'error'`. Декодирование идёт в пуле libvips, не в event loop.
- Обрезка: клиент присылает намерение — прямоугольник. Сервер ограничивает его рамками изображения, а при
  `size·min(w,h) < 64 px` отвечает `422 AVATAR_INVALID`.
- Ошибки: `AVATAR_FORMAT_UNSUPPORTED` (415), `AVATAR_TOO_LARGE` (413), `AVATAR_INVALID` (422 — не декодируется,
  больше 40 Мп, мелкая обрезка) — в конец `ErrorCode`.

## 8. Risks / Assumptions / Open Questions

- **R-1. Нет макета экрана 10.** Сборка из фрагментов прототипа (раздел 2). Визуальной сверки с макетом нет.
- **R-2. UGC без модерации.** Клуб и фото видны другим в публичном профиле только при согласии на имя, но сброса
  модератором и жалоб пока нет — follow-up до прода.
- **R-3. Публичный id.** `publicId` — отдельный случайный токен, не `userId`: публичные ответы `userId` не содержат
  (int-тесты). Отзыв согласия скрывает профиль (404). При повторном согласии id сохраняется — ссылка снова работает.
- **R-4. Кэш.** Публичный профиль — до 60 с после отзыва согласия. Удалённый аватар в браузерах с `immutable` живёт до
  очистки кэша, но новый id после замены и 404 на сервере старый URL не раскрывают.
- **R-5. `sharp` и CVE в libvips.** Входной лимит, проверка сигнатуры, вывод только JPEG. Отдача — только
  перекодированные байты, исходник не хранится.
- **Assumption.** «Райды» в истории — прошедшие с участием «Иду» или организацией: факта проезда в модели нет.

## 8.1 Requirements Consistency

- **Недоопределено:** экран 10 в прототипе отсутствует → решения R1–R10 приняты исполнителем по фрагментам прототипа,
  вынесены в отчёт.
- **Клуб** — в прототипе простой текст второй строки («Velo Club Minsk»), не ссылка → свободное поле, не сущность.
- **Публичный профиль** — отдельного экрана в прототипе нет; «как видят другие» есть в шите соперника. Делаем
  минимальный публичный экран по ссылке и вход «Как вас видят другие» из своего профиля. Ссылки из таблиц — follow-up
  (раздел 4).

### Architecture Review (PR A, 2026-10-28)

- **RC-A1. sharp в HTTP-обработчике vs красный флаг «рендер в HTTP-обработчике» (`pokatim-backend.md`) и «тяжёлое —
  в worker» (AGENTS §4.5).** Перекодирование аватара — синхронное и ограниченное (10 МиБ, 40 Мп, 2 слота на процесс,
  `timeout` 10 с, пул libvips вне event loop). Варианты: (a) **оставить в HTTP** и зафиксировать исключение в ADR-0018 и
  в `pokatim-backend.md` («рендер» = Skia/ffmpeg/OG; аватар — ограниченное перекодирование); (b) очередь BullMQ +
  опрос статуса — сложнее UX и PR B, хранение исходника до обработки (а исходник с GPS хранить не хотим);
  (c) обработка только на клиенте — нарушает серверный авторитет и не гарантирует стирание EXIF. **Рекомендация —
  (a).**
- **RC-A2. URL аватара после отзыва согласия.** `GET /v1/avatars/:id` не проверяет согласие: тот, кто уже видел
  публичный профиль, сможет открыть фото по старому URL и после отзыва. Варианты: (a) **принять** — id
  непредсказуем, видевший мог сохранить фото и так; удаление/замена фото отзывает URL (404) — описать в ADR-0018 и
  `profile.md`; (b) при отзыве согласия в транзакции `PATCH` перевыпускать id аватара (копия под новым
  `randomToken`, старый — удалить); (c) проверять согласие на отдаче — ломает показ своего фото без согласия.
  **Рекомендация — (a)** для PR A, (b) — follow-up вместе с модерацией.
- **RC-A3. «Гонки с результатом» и START.** Строки START и Verified без пульса в снимок протокола не входят
  (race-results-07, DV-10) — по «опубликованным протоколам» у райдера START будет «Гонки: 0». Варианты:
  (a) **считать только строки протокола** (места, подиумы, «в зачёте» — как рамка D-43 «в зачёте N») и подписать
  метрику в PR B «В зачёте»; (b) добавить финишёров без места: активные заявки с `best` по гонкам с опубликованным
  протоколом — нужно чтение гонок пачкой (новый метод `RaceRegistry`) и второй источник истины для «результата».
  **Рекомендация — (a)**, (b) — follow-up с достижениями.
- **RC-A4. Какие заезды в сумме км.** `activities.sport` бывает `other` (бег из FIT). Рекомендация — основные
  активности кроме `other` (`cycling`, `cycling_indoor`, `unknown`); альтернатива — все основные (проще, но
  смешивает бег). Зафиксировать в `profile.md`.
- **RC-A5. `DELETE /v1/profile/avatar` vs конвенция API.** В API нет ни одного `@Delete`: удаление — `POST …/delete`
  (`tracks/uploads/:id/delete`, `routes/mine/:id/delete`), CORS разрешает `GET/HEAD/POST/PUT/PATCH`. Варианты:
  (a) **`POST /v1/profile/avatar/delete`** — по конвенции, CORS не трогаем; (b) `DELETE` + `'DELETE'` в CORS
  (`http-app.ts`) и тест. **Рекомендация — (a)**; AC3 читать как «удаление».
- **Решение по RC-A1…RC-A5 (исполнитель, 2026-10-28; автономный режим, вынесено в отчёт):** везде принят вариант
  (a) — рекомендация архитектора; RC-A4 — без `other`. Удаление фото — `POST /v1/profile/avatar/delete`.
- **Без находок:** контракты (только аддитивно, `.default`), серверный авторитет (клиент шлёт файл и намерение
  обрезки), append-only (журналы не трогаются), outbox/очереди (не нужны: событий для других модулей нет).

## 8.2 Deviations from spec

- Блок «Сезон» переезжает из `settings/profile` в `/profile` — по рамке D-43 («Профиль → блок „Сезон 2026“»).
- Ревью PR A, проход 1 (MEDIUM-1, MEDIUM-2): лимит пикселей аватара — **25 Мп** вместо 40 Мп, слот — **1 на процесс**
  вместо 2, таймауты тела аватара — 10 с тишины / 60 с всего (замер памяти и выбор — ADR-0018). HIGH-1: курсор
  `GET /v1/riders/:publicId/races` — только id гонки (`k: 'r'`), без `startedAt`.

## 8.3 Security checklist

- **AuthN/AuthZ:** свои эндпоинты — `AuthGuard` + `@CurrentUser()`. Публичные — `PublicReadGuard` (IP-лимит), доступ
  по непредсказуемому `publicId` и только при согласии.
- **Входные данные:** тело — `readLimited` 10 МиБ, только `octet-stream`; сигнатура JPEG/PNG/WebP; лимит пикселей;
  query — `strictObject` с числами 0..1; клуб — те же запреты `\p{Cc}`/`\p{Cf}`.
- **Данные наружу:** аватар перекодирован (без EXIF/GPS); публичный ответ — явный список полей без `userId`, км и
  райдов; ключ аватара — `randomToken`; `nosniff`, `CSP sandbox`.
- **Злоупотребления:** лимит загрузок 20/ч, слоты процесса, IP-лимит публичного чтения; размер хранения — один аватар
  на пользователя.
- **Секреты и логи:** в логах только `uid`, размеры и исход; без имени, клуба и байтов.
- **Аудит:** смена фото и клуба не журналируется. Согласие на показ имени уже журналируется (Q1), отдельного согласия
  на фото нет: фото видно только вместе с именем (R3 решений).

## 9. Acceptance Criteria

### PR A

1. `PUT /v1/profile/avatar`:
   - JPEG с EXIF (GPS, ориентация 6) → 200, `avatar.id`;
   - `GET /v1/avatars/:id` отдаёт JPEG 512×512 без EXIF, развёрнутый по ориентации, с заголовками кэша и `nosniff`;
   - обрезка по query даёт заданный квадрат.
2. Ошибки загрузки: PNG и WebP принимаются; GIF или текст → 415; больше 10 МиБ → 413; больше 40 Мп или битый файл →
   422; без входа → 401; превышение лимита → 429.
3. Замена аватара удаляет старый (старый id → 404). `DELETE` → `avatar: null`, повтор — 200.
4. `PATCH /v1/profile { club }` — валидация как у имени, `null` очищает; ответ содержит `club`.
5. `publicId` есть в `ProfileView` только при имени и согласии. `GET /v1/riders/:publicId`:
   - 200 с именем, клубом, аватаром и публичной статистикой;
   - после отзыва согласия, очистки имени или удаления аккаунта — 404;
   - в ответе нет `userId`, км и набора (тест на ключи).
6. `GET /v1/profile/stats` — суммы по своим основным заездам (дубли и чужие не входят), гонки, подиумы и лучшие места
   только по опубликованным протоколам.
7. `GET /v1/profile/races` — свои заявки без снятых, по убыванию даты гонки, курсор; место и статус совпадают с
   `GET /v1/races/:id/entry`.
8. `GET /v1/profile/rides` — прошедшие райды с участием или организацией; отменённые, скрытые и будущие не входят;
   курсор.
9. `GET /v1/riders/:publicId/races` — только опубликованные протоколы.
10. Удаление аккаунта стирает `profile_avatars` пользователя (int-тест erasure).
11. Миграция `0032_*` (или следующая свободная) — индексы; `pnpm check` зелёный.

### PR B

12. Аватар в `TopBar` Главной открывает `/profile`. Шапка, статистика, сезон и история — со скелетонами, ошибками и
    пустыми состояниями по §4.12.
13. История: «Гонки» и «Райды», «Показать ещё»; нажатие ведёт в `/races/[id]` или `/rides/[id]`.
14. `/settings/profile`: выбор фото (native — системная обрезка, web — свой экран обрезки), удаление с подтверждением,
    клуб, имя и согласие. Ошибки 413, 415, 422 и 429 — понятные тексты.
15. `/riders/[id]` открывается гостем по ссылке (SSR, `noindex`); 404 — «Профиль недоступен».
16. Все платформы, только токены темы. `pnpm check` и `e2e:web` зелёные.

## 10. Documentation Impact

- ADR-0018 «Аватары райдеров» (новый), README ADR.
- `docs/product/profile.md` — решения R1–R10, `docs/product/account.md` — стирание аватара,
  `docs/runbooks/account-deletion.md` — шаг.
- `.claude/rules/pokatim-security.md` (исключение для аватаров), `pokatim-db.md` (коллекция и индексы),
  `pokatim-contracts.md`, `pokatim-app.md` (PR B).
- Architect (PR A): `pokatim-backend.md` — модуль `riders` (граф `riders → profile, results, tracks, identity`), порты
  `RIDER_PROFILES`, `RIDER_RESULTS`, `ACTIVITY_TOTALS`, исключение для перекодирования аватара в HTTP (RC-A1);
  `pokatim-db.md` — `profiles.{club,avatarId,publicId}` + индекс, `profile_avatars`, `race_entries.raceWindowStartsAt`
  (денормализация под V-12) + индекс истории, `race_protocol_rows_user_idx`; `pokatim-security.md` — заголовки
  отдачи аватара, публичный профиль (ключи без `userId`), RC-A2; ADR-0015 «Правило для будущих модулей» — шаг
  `profile` теперь включает аватары (`docs/runbooks/account-deletion.md`). `pr.md` — миграция `0032`, новая
  зависимость `sharp` и проверка образца `linux/amd64`.

## 11. Implementation Context

PR A. Architecture Review — **Status: CONCERNS** (блокеров нет; RC-A1…RC-A5 в 8.1 — решить человеку, рекомендации
даны, coder идёт по рекомендациям, если не сказано иное). Код ниже проверен по `feature/rider-profile` (c7ace06).

### 11.1 Placement и граф модулей

Факт: `results → profile` (`RIDER_NAMES`, `VERIFIED_PROFILES`), `routes → profile`, `rides → routes → profile`;
`dependency-cruiser` `no-circular` — по файлам, с type-импортами (`tsPreCompilationDeps`). Значит **`profile` не может
импортировать `results`, `rides`, `routes`** (цикл через `profile/index.ts → profile.module.ts`). `tracks → identity`
только — `profile → tracks` допустимо, но статистике нужны ещё и результаты.

Решение — **новый модуль-композиция `riders`** (образец — `standings`: только порты, своих коллекций нет):
`riders → profile, results, tracks, identity` (через `index.ts`); `riders` не импортирует никто, кроме `app.module.ts`.
Там же — будущие достижения («Вспышка достижения»). Альтернатива «публичный профиль и статистика в `results`»
(`results → profile, tracks` уже есть) отклонена: `results` и так 11 k строк, профиль — не его контекст.

| Что | Модуль / файл | Слой |
|---|---|---|
| `club`, `publicId`, `avatarId` в `profiles`; `PATCH` с `club`; генерация `publicId` | `profile`: `profile.collection.ts`, `profile.repository.ts`, `profile.service.ts`, `profile.policy.ts` | repo/service |
| Аватар: приём, обработка, замена, удаление | `profile`: `profile-avatars.controller.ts` (`@Controller('profile/avatar')`, `AuthGuard`), `profile-avatar.service.ts`, `avatar-image.ts` (sharp, чистая обработка + сигнатура + прямоугольник), `profile-avatar.repository.ts` (единственный писатель `profile_avatars`) | controller/service/repo |
| Отдача `GET /v1/avatars/:id` | `profile`: `avatars-public.controller.ts` (`@Controller('avatars')`, `PublicReadGuard`) | controller |
| Порт публичного профиля | `profile`: `rider-profiles.port.ts` (`RIDER_PROFILES`, `RiderProfileDirectory.findPublic(publicId) → { userId, publicName, club, avatarId } \| null`, согласие и имя — в фильтре), реализация `rider-profiles.ts` в `ProfileCoreModule` | port |
| Стирание аватаров | `profile`: `profile-erasure.ts` | port |
| История гонок `GET /v1/profile/races` | `results`: `profile-races.controller.ts` (`@Controller('profile/races')`, `AuthGuard`, `no-store`) → `results-history.service.ts` (в `ResultsModule`) | controller/service |
| Порт результатов райдера | `results`: `rider-results.port.ts` (`RIDER_RESULTS`, `RiderResults`), `rider-results.ts` в `ResultsCoreModule` | port |
| История райдов `GET /v1/profile/rides` | `rides`: `profile-rides.controller.ts` (`@Controller('profile/rides')`, `AuthGuard`, `no-store`) → `rides-history.service.ts` (или метод `RidesFeedService.history`, ответ — явным списком полей) | controller/service |
| Суммы заездов | `tracks`: **новый** порт `activity-totals.port.ts` (`ACTIVITY_TOTALS`, `ActivityTotals.of(userId)`), реализация `activity-totals.ts` в `TracksCoreModule` | port |
| `GET /v1/profile/stats`, `GET /v1/riders/:publicId`, `…/races` | `riders` (новый): `riders.module.ts`, `profile-stats.controller.ts` (`@Controller('profile/stats')`, `AuthGuard`), `riders-public.controller.ts` (`@Controller('riders')`, `PublicReadGuard`), `riders.service.ts`, `riders.policy.ts` (чистые: лучшие места, подиумы, курсор в памяти), `index.ts` | controller/service |

- Пути `/v1/profile/{avatar,races,rides,stats}` — статические сегменты; у `ProfileController` (`@Controller('profile')`)
  только `GET /` и `PATCH /`, у соседей — `profile/onboarding`, `profile/verified`: конфликтов и pipe `Uuid` нет.
- `ActivityTotals` — **отдельный порт**, не метод `ActivitySource`: интерфейс `ActivitySource` реализуют фейки в
  int-тестах `results`/`disputes`, расширение их ломает; в `tracks` меняются только `index.ts` и `tracks.module.ts`
  (+2 строки) — риск конфликта с сессией «Заезд по маршруту» минимален (R-A6).
- `riders.module.ts`: `imports: [IdentityModule, ProfileCoreModule, ResultsCoreModule]` (`ResultsCoreModule`
  реэкспортирует `TracksCoreModule`), `providers: [RidersService, PublicReadGuard]`. Регистрация — `app.module.ts`
  (worker не нужен).
- Новый пакет — нет (потребитель один — API). В app-foundation — ничего (sharp — доменная зависимость проекта).

### 11.2 Модель данных и миграция `0032_rider_profile`

Последняя применённая — `0031_rides_geo` (`apps/api/src/db/migrations/index.ts`); в ветках `feature/route-ride`,
`feature/story-cards` миграций 0032+ нет на момент ревью (R-A7: проверить перед PR). Expand-only, без транзакции,
идемпотентна.

- **`profiles`** (`ProfileDoc`, поля необязательные, чтение `?? null`):
  - `club?: string | null`;
  - `avatarId?: string | null` — `_id` документа `profile_avatars`;
  - `publicId?: string | null` — `randomToken()` из `modules/identity/index.ts` (32 байта base64url, 43 символа, тот
    же генератор, что ключи файлов). **Создаётся один раз и не меняется**: в пайплайне `updatePublicName` вторым
    `$set` — `publicId: { $ifNull: ['$publicId', { $cond: [имя — строка И согласие, { $literal: token }, null] }] }`
    (второй этап видит значения первого; токен генерирует сервис до транзакции). Отзыв согласия/сброс имени
    модератором `publicId` не трогают (R-3: повторное согласие — та же ссылка).
  - Наружу (`viewOf`): `publicId` — только при `publicName` строкой и `showNameInResults === true`, иначе `null`.
  - Индекс `profiles_public_id_unique`: `{ publicId: 1 }`, `unique`, `partialFilterExpression: { publicId: { $type:
    'string' } }` (не `sparse`: у `null` sparse не помогает).
  - **Бэкфилл в миграции:** профили с именем и согласием без `publicId` — `publicId = randomBytes(32).base64url`
    по одному `updateOne` с условием `publicId: { $exists: false }` (иначе AC5 не выполнится для уже согласившихся).
- **`profile_avatars`** (новая, `PROFILE_COLLECTIONS.avatars`): `{ _id: randomToken, userId, bytes: Binary (JPEG),
  contentType: 'image/jpeg', width: 512, height: 512, bytesLength, createdAt }`. Индекс `profile_avatars_user_idx`
  `{ userId: 1 }` (стирание). Документ ≈ 30–90 КБ — далеко от 16 МБ.
- **`race_entries`** — сортировка истории «по дате гонки»: **денормализация** `raceWindowStartsAt?: Date` в заявку.
  Корректно: окно гонки зафиксировано первой заявкой (V-12, `entriesLocked` в `races.policy.ts`), заявка без
  `admitEntry` не создаётся — копия не устаревает. Пишет `EntriesService.enter` (`entries.service.ts:130`, значение —
  `race.windowStartsAt` из `admitEntry` той же транзакции). Бэкфилл в миграции: по `distinct('raceId', {
  raceWindowStartsAt: { $exists: false } })` → `races.find({ _id: { $in } }, { windowStartsAt })` → `updateMany`.
  Индекс `race_entries_user_history_idx` `{ userId: 1, status: 1, raceWindowStartsAt: -1, _id: -1 }` — равенство
  `status: 'active'` + keyset `(raceWindowStartsAt, _id)` целиком по индексу. `race_entries_user_idx` остаётся
  (удаление индекса — не expand). Отклонено: курсор по `_id` заявки (uuidv7 = дата заявки, не гонки — AC7 ложен);
  сортировка всех заявок в памяти с чтением гонок (O(всех заявок) на каждую страницу, нужен пакетный метод
  `RaceRegistry`).
- **`race_protocol_rows`** — индекс `race_protocol_rows_user_idx` `{ userId: 1, raceId: 1, revision: -1 }`: все строки
  райдера по всем ревизиям — статистика и публичная история. Сейчас индексов по `userId` нет (только
  `{raceId, revision, …}`) — без него это скан коллекции.
- **`activities`** — нового индекса **нет**: агрегация `$match { userId, duplicateOf: null, sport: { $ne: 'other' } }`
  → `$group { count, distanceM: $sum, elevationGainM: $sum }` идёт по `activities_user_started_idx` с выборкой
  маленьких документов (линия — в `activity_tracks`). Покрывающий индекс не даёт выигрыша: равенство с `null`
  в MongoDB не покрывается индексом.
- Константы индексов — экспорт из файла миграции (образец `0031`: `RIDES_GEO_INDEX`), список — в конец `migrations`.
  `migrations.int.test.ts` — кейс бэкфилла `publicId` и `raceWindowStartsAt` + повторный прогон (идемпотентность).

### 11.3 Аватар: поток и правила

`PUT /v1/profile/avatar` (`profile-avatars.controller.ts`, по образцу `track-uploads.controller.ts`):

1. `@Query()` → `ZodValidationPipe(AvatarCropQuery)` **до** слота и тела (400 — без чтения тела).
2. `ProfileAvatarService.admit(userId)`: `RateLimiter.consume('profile-avatar:<uid>', { limit: 20, windowSec: 3600 })`
   → 429 `RATE_LIMITED` + `retryAfterSec`; слот — свой экземпляр `new UploadSlots({ maxTotal: 2, maxPerUser: 1 })`
   → 429 `retryAfterSec: 5`. Всё — до тела.
3. `readLimited(body, AVATAR_MAX_BYTES, { unsupported: 'AVATAR_FORMAT_UNSUPPORTED', tooLarge: 'AVATAR_TOO_LARGE' },
   DEFAULT_BODY_TIMEOUTS)`; ошибка — `Connection: close`; `slot.release()` в `finally`.
4. `avatar-image.ts`:
   - `detectImageFormat(bytes)`: JPEG `FF D8 FF`, PNG `89 50 4E 47 0D 0A 1A 0A`, WebP `RIFF????WEBP`; иначе 415.
   - `sharp(bytes, { limitInputPixels: 40_000_000, failOn: 'error', animated: false, sequentialRead: true })`;
     `metadata()` → `format` обязан совпасть с сигнатурой (иначе 415); размеры **после** ориентации
     (`autoOrient` в метаданных sharp ≥ 0.34; для `orientation ≥ 5` — `w/h` меняются местами).
   - `cropRect(w, h, crop?)` — чистая: без query — центральный квадрат `min(w,h)`; иначе `side = round(size ·
     min(w,h))`, `left = round(x·w)`, `top = round(y·h)`, сдвиг/обрезка в рамки; `side < 64` → 422 `AVATAR_INVALID`.
   - `.autoOrient().extract(rect).resize(512, 512).jpeg({ quality: 82 })` — метаданные sharp по умолчанию не
     пишет (без `keepMetadata`/`withMetadata`/`withExif`). `.timeout({ seconds: 10 })`.
   - На уровне модуля один раз: `sharp.cache(false)`, `sharp.concurrency(1)`.
   - Ошибки sharp (`Input image exceeds pixel limit`, битый файл, таймаут) → 422 `AVATAR_INVALID`; в лог — `uid`,
     размер байт, формат, код исхода (без сообщения libvips, без имени/клуба).
   - API sharp сверить через context7 (`/lovell/sharp`): `autoOrient`, `limitInputPixels`, `failOn`, `timeout`,
     поведение метаданных по умолчанию в 0.35.
5. Транзакция (`MongoTransactions.run`), `_id` нового — `randomToken()`:
   `avatars.insert(tx, doc)` → `profiles.setAvatar(tx, userId, newId, now)` (`findOneAndUpdate` pipeline-upsert c
   `returnDocument: 'before'`, дефолты полей — как `updatePublicName`) → прежний `avatarId` ≠ null →
   `avatars.delete(tx, { _id: prev, userId })`. Ответ — `viewOf(после)`. Гонка двух первых upsert — повтор при
   `isDuplicateKey(error, '_id_')` (образец `ProfileService.update`). Две параллельные замены с разных процессов
   конфликтуют по документу профиля → повтор транзакции видит новый `avatarId` и удаляет его: сирот нет.
- Удаление (RC-A5: рекомендовано `POST /v1/profile/avatar/delete`, `200 ProfileView`; если человек оставит
  `DELETE /v1/profile/avatar` — то же поведение + `'DELETE'` в CORS): лимит `profile-update:<uid>` (общий 30/ч); транзакция `profiles.clearAvatar` (`$set
  avatarId: null`, `returnDocument: 'before'`) → удалить прежний; нет профиля/аватара — 200 с текущим видом.
- `GET /v1/avatars/:id`: pipe `AvatarId` (regex `^[A-Za-z0-9_-]{43}$`, 400 на мусор) → `findById` (проекция
  `bytes`) → нет — `404 NOT_FOUND` (JSON). Заголовки **после чтения** через `HttpAdapterHost` (образец —
  `routes-public.controller.ts` `gpx`): `Content-Type: image/jpeg`, `Cache-Control: public, max-age=31536000,
  immutable`, `X-Content-Type-Options: nosniff`, `Content-Security-Policy: default-src 'none'; sandbox`. На 404
  `immutable` **не ставить** (`@Header` Nest пишет до обработчика — поэтому только через адаптер). Ответ —
  `Buffer` из `Binary.buffer`. Без проверки согласия: доступ — по непредсказуемому id (RC-A2).
- `ProfileErasure.erase(userId)`: `verified.delete` → **`avatars.deleteAllOf(userId)`** (`deleteMany({ userId })`) →
  `repository.deleteProfile`. Без транзакции (как сейчас): каждый шаг идемпотентен, поздний `PUT` воскрешает и
  аватар, и профиль — убирает повторный проход (`account.deletion-sweep`, ADR-0015 п. 5). `AccountErasureService`
  не меняется (шаг `profile` уже есть). Возврат `erase` — прежний `boolean`; число аватаров в сводку шага — по
  желанию.

### 11.4 Статистика, истории, публичный профиль

- **Порт `RiderResults`** (`results/rider-results.port.ts`):
  - `publishedRows(userId) → RiderProtocolRow[]` — строки **текущих ревизий**: `repository.protocolRowsOfUser(userId)`
    (индекс `race_protocol_rows_user_idx`, проекция `raceId, revision, place, tied, status, groupKey, elapsedSec,
    startedAt`) → `repository.currentRevisions(raceIds)` (уже есть, один `aggregate`) → оставить строки с `revision
    === current`. Строка райдера могла выпасть из поздней ревизии — потому сверка с текущей, а не «максимальная
    ревизия строки».
  - `racesOf(raceIds) → Map<id, { title, windowStartsAt }>` — через `RaceRegistry.get` по каждому id (≤ 3 для лучших
    мест, ≤ `limit` для страницы).
  - Вне HTTP-курсора: число строк райдера — десятки–сотни; предел чтения `RIDER_RESULTS_MAX_ROWS = 2000` (больше —
    лог `riders.rows_truncated`, без отказа).
- **`riders.policy.ts`** (чистые, unit): `summarize(rows)` → `{ races: строк со статусом ≠ dq и place ≠ null,
  podiums: place ≤ 3, bestPlaces: top-3 по (place ↑, startedAt ↓) }`; `pageRows(rows, cursor, limit)` — сортировка
  `(startedAt ↓, raceId ↓)` (момент старта сегмента лежит в окне гонки — порядок «по дате гонки»), курсор
  `encodeCursor(startedAt.toISOString(), raceId)`; курсор не той формы — 400 `cursor`.
- **`GET /v1/profile/stats`** (`no-store`): `ActivityTotals.of(userId)` + `summarize(RiderResults.publishedRows)` +
  названия для `bestPlaces`. `distanceM`, `elevationGainM` — целые (округление на сервере).
- **`GET /v1/riders/:publicId`** (`PublicReadGuard`, `PUBLIC_READ_CACHE_CONTROL`): pipe `RiderPublicId` →
  `RIDER_PROFILES.findPublic` → нет — `404 NOT_FOUND` → ответ явным списком: `publicId, name, club, avatar,
  stats: { races, podiums, bestPlace }`. **Нет** `userId`, км, набора, райдов, `bestPlaces` с названиями
  (минимум; лучшее место — число).
- **`GET /v1/riders/:publicId/races?cursor&limit`**: 404 профиля — **до** разбора курсора (образец `routes/:id/races`)
  → `pageRows` → элементы `{ race: { id, title, windowStartsAt }, place, tied, status (final|revised|dq),
  groupKey, elapsedSec }`.
- **`GET /v1/profile/races?cursor&limit`** (`results-history.service.ts`): `repository.entriesOfUserPage(userId,
  after, limit + 1)` — `{ userId, status: 'active' }`, sort `{ raceWindowStartsAt: -1, _id: -1 }`, keyset `$or`
  по паре (курсор — `encodeCursor(raceWindowStartsAt.toISOString(), entryId)`). Для каждой заявки: `RaceRegistry.get`
  (нет/черновик — пропуск) и **`ResultsReadService.entryResult(race, entry, now, session)`** — та же функция, что
  `myEntry` и споры (ранжирование не дублируется). Все чтения страницы — в одном `repository.withSnapshot`. Элемент:
  `race { id, title, windowStartsAt, windowEndsAt, status }`, `result { status, place, tied, elapsedSec, unranked }`,
  `groupKey`, `tier`. `limit` ≤ 20 (по умолчанию 10): ≈ 4 запроса на элемент.
- **`GET /v1/profile/rides?cursor&limit`**: `rides` `{ 'participants.userId': uid, status: 'published', startsAt: {
  $lt: now } }` (организатор — первый участник, отдельного условия не нужно; `cancelled` и `hidden` — вне `status`),
  sort `{ startsAt: -1, _id: -1 }`, keyset по паре; индекс `rides_participant_idx`. Элемент: `id, title, startsAt,
  distanceKm, role: organizerUserId === uid ? 'organizer' : 'participant'`. Без `organizerUserId`, участников, места.

### 11.5 Контракты (`packages/contracts`) и совместимость

- `profile/profile.schema.ts`:
  - `RIDER_CLUB_MAX = 60`; `RiderClub` — `optionalText(60, RIDER_NAME_LINE)` + `min 2 → TOO_SHORT` + те же
    служебные подписи → `INVALID` (вынести общий конструктор, не копировать регулярки).
  - `ProfileView` + `club: z.string().nullable().default(null)`, `avatar: z.object({ id: AvatarId
    }).nullable().default(null)`, `publicId: RiderPublicId.nullable().default(null)` — старый сервер без полей → дефолты;
    старые клиенты — `z.object` не строгий, новые ключи игнорируют.
  - `UpdateProfileRequest` + `club: RiderClub.optional()`; `refine` «хотя бы один ключ» — с `club`.
- `profile/rider-avatar.schema.ts` (новый): `AVATAR_MAX_BYTES = 10 * 1024 * 1024`, `AVATAR_SIZE_PX = 512`,
  `AVATAR_MAX_INPUT_PIXELS = 40_000_000`, `AVATAR_MIN_CROP_PX = 64`; `OpaqueToken` (43 символа base64url) →
  `AvatarId`, `RiderPublicId`; `AvatarCropQuery` — `z.union([z.strictObject({}), z.strictObject({ x, y, size })])`
  где `x, y: z.coerce.number().min(0).max(1)`, `size: z.coerce.number().gt(0).max(1)` (все три или ни одного;
  `NaN`/`Infinity` — `INVALID`).
- `profile/rider-profile.schema.ts` (новый): `RiderHistoryQuery` (`cursor: PageCursor.optional()`, `limit` 1–20,
  default 10), `RiderBestPlace`, `RiderStats` (`activities`, `distanceM`, `elevationGainM`, `races`, `podiums`,
  `bestPlaces[] ≤ 3`), `RiderRaceHistoryItem/Page` (статусы — `tolerantEnum(RACE_RESULT_STATUSES)`, группа, уровень —
  `tolerantEnum`), `RiderRideHistoryItem/Page` (`role: tolerantEnum(['organizer','participant'])`),
  `PublicRiderProfile` (состав ключей держит int-тест), `PublicRiderRace/Page`
  (`status: tolerantEnum(PROTOCOL_ROW_STATUSES)`). Все `nextCursor: string | null`. Экспорт — в `index.ts`.
- `common.ts` `ErrorCode` — **в конец**: `'AVATAR_FORMAT_UNSUPPORTED'`, `'AVATAR_TOO_LARGE'`, `'AVATAR_INVALID'`
  (комментарий «rider-profile»); тексты — `apps/api/src/error-messages.ts` («Выберите фото JPEG, PNG или WebP»,
  «Фото больше 10 МБ», «Не удалось обработать фото»); `error-messages.test.ts` проверит полноту.
- `packages/api-client/src/index.ts` (образцы `uploadTrack`/`trackUploadRequest`, `catalogRouteGpxUrl`):
  `uploadAvatar(token, body: Blob | Uint8Array, crop?)` → `PUT /v1/profile/avatar?x&y&size`, `octetStream`,
  `ProfileView`; `avatarUploadRequest(token, crop?)` → `{ url, method: 'PUT', headers }` (native upload task в PR B);
  `deleteAvatar(token)` (RC-A5); `avatarUrl(id)` (без запроса, `encodeURIComponent`); `getProfileStats`,
  `listProfileRaces`, `listProfileRides` (авторизованные); `getRider(publicId)`, `listRiderRaces(publicId, params)`
  (`getPublic`). `updateProfile` — тип запроса уже из контракта. CORS: `PUT` уже в `methods` (`http-app.ts`),
  `DELETE` — нет; в API нет ни одного `@Delete` — удаление везде `POST …/delete`.

### 11.6 sharp, сборка, CI

- `sharp@^0.35.5` (latest на 2026-10-28, вышла 2026-09-27 — старше `minimumReleaseAge`), dependency `apps/api`.
  Install-скрипта у `sharp` и `@img/sharp-*` нет (`npm view … scripts`) — **`allowBuilds` не нужен**. Бинарники —
  optionalDependencies `@img/sharp-linux-x64` + `@img/sharp-libvips-linux-x64` (glibc) для `node:24-bookworm-slim`
  amd64; macOS arm64 (локально) — `@img/sharp-darwin-arm64`. Lockfile — `pnpm install` (все платформы в lockfile,
  ставится только своя).
- `infra/docker/runtime-deps.mjs` копирует установленные optionalDependencies транзитивно — правок нет. Проверка:
  `docker build --platform linux/amd64 --target api` и `node -e "require('sharp')"` в образе (в `pr.md`).
  `nginx` `client_max_body_size 20m` — 10 МиБ проходят.
- Тестовые изображения генерирует сам sharp в тесте (фикстур в git нет): `sharp({ create: { width: 400, height:
  200, channels: 3, background } })` с двумя цветными половинами (`composite`) → `.jpeg().withMetadata({ orientation:
  6 })`/`.withExif({ IFD0: {...}, IFD3: { GPSLatitude… } })` — сверить ключи через context7; проверка поворота — по
  цвету пикселей `raw()` результата, отсутствие EXIF — `metadata()` без `exif`/`orientation`. > 40 Мп — PNG c
  подделанным `IHDR` (ширина 8000 × высота 5001, CRC — `zlib.crc32`) без реального декода; битый — `FF D8 FF` +
  мусор; GIF — `GIF89a`.

### 11.7 Test matrix

| AC | Тест | Файл |
|---|---|---|
| 1 | int: JPEG (EXIF GPS + orientation 6) → 200 `avatar.id`; `GET /v1/avatars/:id` — 512×512 JPEG, без EXIF, поворот по цвету пикселей, заголовки (`Content-Type`, `immutable`, `nosniff`, `CSP sandbox`); обрезка по query — цвет квадрата; без query — центр | `apps/api/src/modules/profile/profile-avatar.int.test.ts` |
| 1–2 | unit: `detectImageFormat`, `cropRect` (центр, клэмп к рамке, `< 64` → 422), обработка PNG/WebP, 40 Мп, битый, метаданные стёрты | `apps/api/src/modules/profile/avatar-image.test.ts` |
| 2 | int: PNG, WebP → 200; GIF, текст → 415; не `octet-stream` → 415; > 10 МиБ → 413 + `Connection: close`; > 40 Мп, битый → 422; без входа → 401; 21-я загрузка → 429; второй параллельный приём → 429 | `profile-avatar.int.test.ts` |
| 3 | int: замена — старый id → 404, в коллекции один документ; удаление → `avatar: null`, повтор — 200; 404 без `immutable` | `profile-avatar.int.test.ts` |
| 4 | contracts unit: `RiderClub` (2–60, `\p{Cc}`/`\p{Cf}`, служебные, `""`/`null`); int `PATCH { club }` / `{ club: null }` | `packages/contracts/src/profile/profile.schema.test.ts`, `apps/api/src/modules/profile/profile.int.test.ts` |
| 5 | int: `publicId` в `ProfileView` только при имени+согласии, стабилен при отзыве/повторе; `GET /v1/riders/:publicId` 200 → отзыв / очистка имени / сброс модератором / удаление аккаунта → 404; **тест ключей** ответа (нет `userId`, `distanceM`, `elevationGainM`, райдов) | `apps/api/src/modules/riders/riders.int.test.ts` |
| 6 | int: суммы по основным (дубль и чужие не входят, `other` не входит), гонки/подиумы/лучшие только по текущей ревизии опубликованных протоколов (строка выпала из ревизии 2 — не считается; DQ — не место); unit `summarize`, `pageRows` | `riders.int.test.ts` (протоколы — `test/standings.ts: seedProtocolRace/addRevision`), `apps/api/src/modules/riders/riders.policy.test.ts` |
| 7 | int: свои без снятых, порядок по `raceWindowStartsAt` (заявка сделана в обратном порядке), курсор; `result` = `GET /v1/races/:id/entry` `result` до и после публикации | `apps/api/src/modules/results/results-history.int.test.ts` |
| 8 | int: прошедшие с «Иду» и организацией; отменённые, скрытые, будущие, чужие — нет; роль; курсор | `apps/api/src/modules/rides/rides-history.int.test.ts` |
| 9 | int: `…/races` — только опубликованные, текущая ревизия, курсор; неизвестный `publicId` — 404 до курсора | `riders.int.test.ts` |
| 10 | int: erasure удаляет `profile_avatars` пользователя, чужие целы, повтор безопасен; `GET /v1/avatars/<old>` → 404 | `apps/api/src/modules/account/account-erasure.int.test.ts` |
| 11 | int миграции: бэкфилл `publicId`, `raceWindowStartsAt`, индексы, повтор; сторож единственного писателя `profile_avatars` | `apps/api/src/db/migrations/migrations.int.test.ts`, `apps/api/src/modules/profile/profile.repository.test.ts` |
| — | api-client: пути, `octetStream`, query обрезки, `avatarUrl` без запроса, разбор новых полей и дефолтов старого ответа | `packages/api-client/src/profile.test.ts` |
| — | arch: `pnpm arch:check` (нет цикла `profile ↔ results`), `src/admin-routes.test.ts` не затронут | — |

### 11.8 Implementation Context (для coder)

- **ENTRY POINTS:** `apps/api/src/modules/profile/profile.module.ts`, `apps/api/src/modules/results/results.module.ts`,
  `apps/api/src/modules/rides/rides.module.ts`, `apps/api/src/modules/tracks/tracks.module.ts`, новый
  `apps/api/src/modules/riders/riders.module.ts`, `apps/api/src/app.module.ts`, `apps/api/src/db/migrations/index.ts`.
- **FILES TO MODIFY:** `profile/{profile.collection,profile.repository,profile.service,profile.policy,profile-erasure,
  profile.module,index}.ts`; `results/{results.collection,results.repository,entries.service,results.module,index}.ts`;
  `rides/{rides.repository,rides.module}.ts`; `tracks/{tracks.module,index}.ts`; `src/{app.module,error-messages}.ts` (+ `http-app.ts`, только если `DELETE`); `apps/api/package.json`, `pnpm-lock.yaml`; `packages/contracts/src/{common,index}.ts`,
  `profile/profile.schema.ts`; `packages/api-client/src/index.ts`.
- **FILES TO CREATE:** `profile/{profile-avatars.controller,avatars-public.controller,profile-avatar.service,
  profile-avatar.repository,avatar-image,rider-profiles.port,rider-profiles}.ts`; `results/{profile-races.controller,
  results-history.service,rider-results.port,rider-results}.ts`; `rides/{profile-rides.controller,
  rides-history.service}.ts`; `tracks/{activity-totals.port,activity-totals}.ts`; `riders/{index,riders.module,
  riders.service,riders.policy,profile-stats.controller,riders-public.controller}.ts`;
  `db/migrations/0032_rider_profile.ts`; `contracts/src/profile/{rider-avatar,rider-profile}.schema.ts`.
- **FILES TO READ:** `src/raw-body.ts`, `src/upload-slots.ts`, `src/page-cursor.ts`, `src/public-read.guard.ts`,
  `tracks/track-uploads.controller.ts` (+ `.service.ts` `admit`), `routes/routes-public.controller.ts` (`gpx`:
  заголовки после чтения), `results/results-read.service.ts` (`entryResult`), `results/results-for-standings.ts`,
  `standings/standings.module.ts` (образец модуля-композиции), `test/standings.ts`, `test/results.ts`.
- **OUT OF SCOPE (PR A):** `apps/app`, `packages/i18n`, экраны результатов, модуль `routes` (только чтение образцов),
  `ActivitySource` (не расширять), модерация клуба/аватара, аватары в таблицах результатов.

### 11.9 Риски и неизвестные

- **R-A1. `entryResult` на элемент истории** — ≈ 4 запроса × `limit` (≤ 20) в одной snapshot-сессии; приемлемо, при
  росте — пакетный расчёт follow-up.
- **R-A2. Зазор деплоя денормализации:** заявка, созданная старым API между миграцией и выкатом, без
  `raceWindowStartsAt` — в истории уходит в конец. Прод пока нет (`main` — будущий прод); для прод-выката — повтор
  бэкфилла отдельной миграцией, если зазор был.
- **R-A3. Пул libuv:** sharp работает в пуле libuv (`UV_THREADPOOL_SIZE` 4), там же `crypto`/`fs`/`dns` и, возможно,
  argon2 (`@node-rs` — проверить); 2 слота аватаров × ≤ 10 с — до половины пула. Мера — слоты и `timeout`; метрика —
  время ответа входа под нагрузкой загрузок (follow-up).
- **R-A4. libvips CVE** — вывод только JPEG, сигнатура + `metadata().format`, `failOn: 'error'`, лимит пикселей,
  обновлять sharp при CVE (Dependabot).
- **R-A5. `withExif`/`autoOrient` в 0.35** — API подтвердить через context7 до кода тестов.
- **R-A6. Конфликты с параллельными сессиями:** `tracks/index.ts`, `tracks.module.ts` (+2 строки, «Заезд по
  маршруту»); номер миграции `0032` (R-A7) — перед PR `git fetch` и сверить `migrations/index.ts` веток
  `feature/route-ride`, `feature/story-cards`; `packages/contracts/src/common.ts` `ErrorCode` — конфликт порядка
  возможен, коды в конец после слияния.

## 12. Outcome

### PR A (ветка `feature/rider-profile`, 2026-10-28)

**Изменения.**

- Контракты: `RiderClub` (общий конструктор `riderLine` с `RiderPublicName`), `ProfileView.club/avatar/publicId`
  (`.default(null)`), `UpdateProfileRequest.club`; `rider-avatar.schema.ts` (пределы, `AvatarId`/`RiderPublicId`,
  `AvatarCropQuery`), `rider-profile.schema.ts` (`RiderHistoryQuery`, `RiderStats`, истории, `PublicRiderProfile`,
  `PublicRiderRacePage`); коды `AVATAR_FORMAT_UNSUPPORTED|TOO_LARGE|INVALID` в конце `ErrorCode` + тексты.
- `profile`: клуб и `publicId` (второй этап pipeline `updatePublicName`, один раз), аватар — `avatar-image.ts` (sharp
  0.35.5: сигнатура + формат декодера, 40 Мп, `failOn: 'error'`, `autoOrient` → `extract` → 512×512 JPEG без
  метаданных, `timeout` 10 с, `cache(false)`, `concurrency(1)`), `ProfileAvatarService` (лимит 20/ч, слоты 2/1,
  транзакции замены и удаления), `ProfileAvatarsController` (`PUT /v1/profile/avatar`, `POST …/avatar/delete`),
  `AvatarsPublicController` (`GET /v1/avatars/:id`), `ProfileAvatarRepository`, порт `RIDER_PROFILES`;
  `ProfileErasure` стирает аватары до профиля.
- `results`: `race_entries.raceWindowStartsAt` (пишет `EntriesService.enter`), `GET /v1/profile/races`
  (`ResultsHistoryService` → `entryResult` в snapshot-сессии), порт `RIDER_RESULTS` (`publishedRows`, `racesOf`).
- `rides`: `GET /v1/profile/rides` (`RidesHistoryService`, `pastOf`). `tracks`: порт `ACTIVITY_TOTALS` (только
  `index.ts`, `tracks.module.ts` + новые файлы).
- Новый модуль `riders` (композиция): `GET /v1/profile/stats`, `GET /v1/riders/:publicId`, `…/races`; `riders.policy.ts`.
- Миграция `0032_rider_profile`: `profile_avatars` + `profile_avatars_user_idx`, `profiles_public_id_unique` (partial
  `$type: string`), `race_entries_user_history_idx`, `race_protocol_rows_user_idx`; бэкфилл `publicId` и
  `raceWindowStartsAt`. Других 0032+ в ветках `origin` нет (проверено `git fetch` 2026-10-28).
- api-client: `uploadAvatar`, `avatarUploadRequest`, `deleteAvatar`, `avatarUrl`, `getProfileStats`,
  `listProfileRaces`, `listProfileRides`, `getRider`, `listRiderRaces`.
- Зависимость `sharp@^0.35.5` (`apps/api`); в lockfile — `@img/sharp-*` всех платформ как optional (в т.ч.
  `linux-x64` glibc и `darwin-arm64`), install-скриптов нет.
- Документы: ADR-0018 (+ README), `docs/product/profile.md` (R1–R10), `account.md`, `runbooks/account-deletion.md`,
  ADR-0015 (шаг `profile`), `.claude/rules/pokatim-{backend,db,security,contracts}.md`.

**Тесты.** Контракты (`profile.schema`, `rider-avatar.schema`, `rider-profile.schema`, порядок `ErrorCode`); unit
`avatar-image.test.ts` (сигнатура, `cropRect`, EXIF/GPS стёрты, поворот по цвету пикселей, PNG/WebP, 40 Мп, битый),
`riders.policy.test.ts`, сторож `profile_avatars` в `profile.repository.test.ts`; int `profile-avatar.int.test.ts`
(AC1–AC3), `profile.int.test.ts` (клуб, `publicId`), `results-history.int.test.ts` (AC7, до и после публикации =
«моё участие»), `rides-history.int.test.ts` (AC8), `riders.int.test.ts` (AC5, AC6, AC9, тест ключей),
`account-erasure.int.test.ts` (AC10), `migrations.int.test.ts` (0032: бэкфилл, индексы, повтор); api-client
`rider-profile.test.ts`.

**Проверки.** `TURBO_CONCURRENCY=1 pnpm check` (изолированные `MONGO_URL_TEST=…/pokatim_riderprofile_test`,
`REDIS_URL_TEST=…:6479/9`) — зелёный:

```
✔ no dependency violations found (1610 modules, 5921 dependencies cruised)
@pokatim/contracts:test:       Tests  344 passed (344)
@pokatim/api-client:test:       Tests  120 passed (120)
@pokatim/api:test:  Test Files  142 passed (142)
@pokatim/api:test:       Tests  1542 passed (1542)
@pokatim/admin:test:       Tests  357 passed (357)
@pokatim/app:test: Tests:       1727 passed, 1727 total
 Tasks:    15 successful, 15 total
```

Прогон 3 упал на `apps/app` `bottom-sheet.test.tsx` (жест посреди снапа, тайминг под нагрузкой; файл не
затронут) — отдельно 3/3 зелёный, повторный `pnpm check` (прогон 4) — зелёный. Образ `linux/amd64` с sharp
(`docker build --target api`, `node -e "require('sharp')"`) — NOT VERIFIED локально, шаг в `pr.md`.

**Отклонения.**

- Удаление фото — `POST /v1/profile/avatar/delete` (RC-A5 (a)), AC3 «`DELETE`» читается как удаление; CORS не менялся.
- Бэкфилл `publicId` в миграции — условие `publicId: null` (отсутствие **или** `null`), а не только `$exists: false`:
  строже и так же идемпотентно.
- `apps/app`: только моки `api.getProfile` в 13 тестах (типы новых полей `ProfileView`), поведение не менялось.
- `test/uploads.ts` `heldUpload` получил параметр метода (`PUT` для аватара).
- `ProfileView` из `setAvatar`/`clearAvatar`: замена — чтение профиля в транзакции до записи (вместо
  `returnDocument: 'before'` у upsert), удаление — `returnDocument: 'before'` как в 11.3.
