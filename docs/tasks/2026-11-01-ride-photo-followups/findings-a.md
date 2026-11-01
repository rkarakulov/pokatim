# Findings — ride-photo-followups (PR A) — pass 1 — reviewer: claude
base: origin/develop   commits: 16c96c46..cbbee543 (working tree clean)
verdict: APPROVE

Проверено: diff `origin/develop...HEAD` (55 файлов), task.md (AC2–AC5, AC7, §5, §7, §10), `review_contract.md`,
`pokatim-backend.md`, `pokatim-security.md`, ADR-0018/0028 (диф), вызовы `StoryCardCache`/`run`/`OutcomeSink`,
`RidesForSharingService`, `RideNotices.ride`, `noticeSeq` во всех местах `rides`.
Тесты запущены сам (MONGO `ride_photo_rev_test`, Redis db 11): `ride-invite.int`, `story-card-image.service`,
`og-card.int`, `og-card.png`, `og-sync.int`, `ride-photos.int`, `notifications-intake.int`, `rides-for-sharing.int`,
`admin-routes` — `Test Files 9 passed, Tests 166 passed` (ERROR в логе — подставленный сбой теста отката). Полный
`pnpm check` не запускал (NOT VERIFIED мной; отчёт coder — §12).

Измерения без замечаний: транзакционность `rides.photo-reset` (outbox после журнала в той же `tx`, ветки «нет фото»/409
без события, отрицательное доказательство отката — честное); схлопывание по `seq` (`$inc noticeSeq` в условной записи,
ключ `ride:<id>:photo-reset` не пересекается с событиями участников, фильтр `participantsDraft` монотонен); админская
отдача (guard и право с класса, `strictObject` query, пара `(rideId, photoId)` + `hasPhoto`, `replyJpeg` после чтения,
`private, no-store`, 404 JSON; утечки для скрытых нет — публичная отдача не менялась); OG (`photoId` в канонических
фактах, `renderVersion` 4, `maxPhotoPngBytes`, `invitePhoto` → `skipped`, без фото — прежний рендер); гонка «рендер ↔
сброс» (привязка несёт нарисованный `photoId`, проверка на отдаче); удаление ключей (`revoke` DEL png+привязки,
`readyToken` без PNG → перерендер); contracts-first и старые клиенты (`ride_photo_reset` в конце, тест `unknown`);
placement (без ребра `rides → sharing`, один фильтр `isShareable`, композиция вынесена без копий); миграций нет;
доки ADR/rules/product честно перечисляют неотзываемое (кэш устройства, сохранённые файлы, токены до выката, HTTP-кэш
OG и превью соцсетей).

### [MEDIUM] Отдача PNG приглашения: чтение PNG и привязки не атомарно — параллельный запрос отдаёт отозванную картинку
- **file:** apps/api/src/modules/sharing/story-card-image.service.ts
- **location:** `png(token)`, строки 21–31 (порядок `cache.png` → `cache.binding`)
- **problem:** PNG читается первым, привязка — вторым, отдельными командами Redis; отсутствие привязки трактуется как
  «карточка без привязки — отдать» (fail open). Запрос A читает PNG; параллельный запрос B видит `inviteCardLive=false`
  и делает `revoke` (DEL png+привязки); A читает привязку → `null` → отдаёт уже отозванный PNG.
- **why_it_matters:** AC3/P3 обещают 404 после события для любого держателя ссылки; пачка параллельных запросов на
  отозванный токен в момент первой отдачи после события (окно — одно чтение Mongo) получает картинку со снятым фото /
  скрытого райда. Гарантия, на которую опираются доки («перестают открываться»), нарушается гонкой, хотя механизм
  задуман как синхронный «без гонок» (task.md §5).
- **evidence:** `const png = await this.cache.png(token); if (!png) return null; const binding = await
  this.cache.binding(token); if (binding === null) return png;` + `revoke`: `this.redis.del(pngKey(token),
  bindingKey(token))`. `storeReady` пишет обе записи одной `MULTI`, поэтому корректный порядок чтения — привязка
  раньше PNG (или обе одной `MULTI`/pipeline-транзакцией). Unit-тест сервиса на моках порядок не проверяет.
- **recommended_fix:** читать привязку **до** PNG (`binding` → `png`): привязка есть → проверка; привязки нет, а PNG
  есть — значит токен без привязки (обе пишутся атомарно, а `revoke` снимает обе), отозванный в промежутке вернёт PNG
  `null`. Либо один `MULTI` `GET bindingKey` + `GETBUFFER pngKey`. Добавить unit-кейс «revoke между чтениями» (мок кэша
  с последовательностью) — красный на текущем порядке.
- **как исправлено:** (HIGH у Codex) `StoryCardCache.card(token)` — PNG и привязка одним `MULTI` (`GETBUFFER` + `GET`),
  `StoryCardImageService` читает один снимок; токены без привязки — как раньше. Регрессия — `ride-invite.int` «гонка
  отдачи»: ответ на чтение PNG задержан до `DEL` png+привязки другим соединением, райд скрыт → 404; с раздельным
  чтением — `expected 200 to be 404`.

### [LOW] Текст последствий «Удалить фото» обещает больше, чем отзывается
- **file:** packages/i18n/src/ru.ts
- **location:** `admin.ridesModeration.resetPhotoConsequences`
- **problem:** «Фото пропадёт … с картинки райда для соцсетей; выданные картинки приглашения с этим фото перестанут
  открываться». Превью ссылок, уже снятые соцсетями/мессенджерами, и публичный HTTP-кэш OG (`public, max-age=86400`)
  не отзываются; токены приглашений, выданные до выката (24 ч), — тоже. Оговорка «Сохранённое на устройствах может
  держаться до суток» эти случаи не покрывает.
- **why_it_matters:** модератор принимает решение по тексту последствий (P7); ADR-0028, `pokatim-security.md` и
  `rides.md` честно называют эти риски, а UI — нет (расхождение доков и интерфейса).
- **evidence:** ADR-0028 / `pokatim-security.md` диф: «принятые риски — … токены приглашений до выката привязок (до 24 ч),
  публичный HTTP-кэш OG и кэши превью соцсетей».
- **recommended_fix:** например: «…новая картинка райда для соцсетей будет без него (уже показанные превью в соцсетях
  могут остаться)…». Переходное окно можно не упоминать (временно), но превью соцсетей — постоянный риск.
- **как исправлено:** текст: «Сохранённое на устройствах и уже показанные превью в соцсетях могут держаться до суток и
  дольше».

## Итог pass 1
CRITICAL/HIGH нет → **APPROVE**. MEDIUM (порядок чтения привязки) рекомендуется закрыть в этом PR — правка в две строки
и один unit-кейс.
