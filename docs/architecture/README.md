# Архитектура pokatim

Текущее состояние системы. Решения и их обоснование — в [`../adr/`](../adr/README.md).

## Контейнеры

```
app (Expo)    ─┐
admin (Vite)  ─┼─ HTTPS ─ Caddy ─ api (NestJS) ─┬─ MongoDB 8.0 (replica set, ADR-0007)
web (app, SSR)─┘                                ├─ Redis (BullMQ, rate-limit)
                                                └─ S3 (треки, фото, карточки, бэкапы)
                         worker (NestJS, BullMQ) ─ те же MongoDB / Redis / S3; ffmpeg, Skia
```

Одна VPS, Docker Compose (`infra/`). Kubernetes, CDN, поиск, push, WebSocket — вне MVP.

## Модули API (`apps/api/src/modules/`)

identity · profile · routes · rides · calendar · races · results · disputes · seasons ·
gamification · sharing · notifications · moderation · media

Межмодульные вызовы — через `index.ts` модуля; события — outbox → BullMQ.

## Ключевые потоки

- **Заезд:** файл (resumable upload) → S3 → задача разбора трека → проверка коридора (`packages/tracks` в worker;
  «рядом»/bbox — `2dsphere` MongoDB, ADR-0007) →
  результат, кластер, флаги правдоподобия → пересчёт мест → уведомление in-app.
- **Протокол:** чек-лист публикации → публикация → финальные результаты → пересчёт сезона.
- **Спор:** подача → ответы обвиняемого (append-only) → решение → DQ / отклонение → пересчёт.
- **Шеринг:** запрос карточки → задача рендера (Skia / ffmpeg) → S3 → публичная ссылка → публичный экран приложения (web: SSR + OG).

### Регистрация и подтверждение e-mail (модуль `identity`, ADR-0002)

```
app ─ POST /v1/auth/register ─► api: users + user_consents + ссылка + registration_token + outbox
                                          (одна транзакция; Redis: пауза повтора 60 с, лимит по IP)
worker: outbox-публикатор ─► очередь identity-email ─► захват отправки (sendClaimedAt, 60 с)
        ─► SMTP (dev — Mailpit) ─► sentAt; доставка at-least-once, дубль — с той же ссылкой
ссылка …auth/verify/<token> ─ GET (только чтение) ─ POST confirm ─► emailVerifiedAt
app ─ POST /v1/auth/registration/poll ─► pending | verified + сессия (обмен один раз)
worker: identity-maintenance, 03:00 Europe/Minsk ─► удаление неподтверждённых старше 7 дней
```

- Токен ссылки — HMAC от id ссылки (`EMAIL_TOKEN_SECRET`), в БД только sha256; ретрай письма — та же ссылка.
- Повтор письма (`resend`): пауза 60 с и ≤ 10 за сутки (Redis, атомарно через Lua); новая ссылка
  отменяет прежние и продлевает токен регистрации.
- Мутации аккаунта сериализуются `lockUser` — `$inc: { version: 1 }` документа `users` первой операцией
  транзакции: вторая транзакция того же аккаунта получает конфликт записи и повторяется на свежем снимке
  (ADR-0007, R1). Сроки сравниваются с `CLOCK` приложения. Истёкшие сессии, ссылки и токены регистрации
  удаляет TTL-индекс через 30 дней после `expiresAt` (только уборка).
- Ошибки — единый `ApiError` из contracts (глобальный фильтр), в ответах и логах нет запросов БД, стеков,
  e-mail и токенов.

### Сессия: native и web (модуль `identity`, ADR-0003 п. 4, ADR-0005)

```
вход:   POST /v1/auth/session/sign-in { email, password, sessionTransport? }
        ─► лимиты (Redis: e-mail+IP 5, e-mail 20, IP 50 за 15 мин) ─► 429 до argon2
        ─► argon2 verify (неизвестный/удалённый адрес — по пустышке) ─► 401 INVALID_CREDENTIALS
        ─► не подтверждён: verificationRequired + новый токен регистрации ─► «Подтвердите e-mail»
        ─► подтверждён: SessionService.issue ─► сессия по транспорту (web: прежняя cookie → superseded)
native: poll / sign-in / refresh ─ тело { refreshToken } ─► Session в теле ─► SecureStore
web:    poll / sign-in { sessionTransport: 'cookie' } ─► CookieSession в теле (без refresh)
        + Set-Cookie __Secure-pokatim_rt (HttpOnly; Secure; SameSite=Strict; Path=/v1/auth/session)
web, загрузка страницы: POST /v1/auth/session/refresh (cookie, Web Lock между вкладками)
        ─► ротация ─► новый access в память | 401 → не вошли
        | 429 / сеть / 5xx → повтор, затем «не удалось» с кнопкой повтора (не выход)
native, запуск: сессия из SecureStore сразу (офлайн — в аккаунте) ─► фоновая ротация по телу
        ─► новый refresh в SecureStore | 401 → выход, экран «Вход» | сеть (1 повтор) / 429 / 5xx → остаёмся
выход: POST /v1/auth/session/sign-out (текущий или предыдущий refresh) ─► revokedAt, signed_out, 204,
        cookie сброшена; приложение очищает кеш запросов и регистрацию, гард ведёт на «Вход»
```

- Ротация — один `findOneAndUpdate` с pipeline-обновлением (жива, не отозвана; текущий refresh или предыдущий в
  окне 60 с; пользователь не удалён — чтением до ротации): предыдущим становится текущий хеш документа, срок —
  30 дней от ротации, не дальше 180 от входа. Из параллельных refresh одним токеном проходят ровно два (текущим и повтором в окне). Предыдущий вне окна —
  reuse detection: сессия отозвана (`reuse_detected`, лог только с `sid`), ответ — тот же 401. Лимит refresh —
  60/мин на IP (Redis).
- HTTP API (`apps/api/src/http-app.ts`): CSRF — `enableCsrfProtection` (Fetch Metadata + `Origin`), доверенные
  origin-ы и CORS с credentials — `CORS_ORIGINS` (dev: web на другом порту); прод — один origin за Caddy, список пуст.
- App: развилки файлами — `features/auth/session-persistence(.web).ts`, `secure-storage(.web).ts`,
  `lib/api-platform(.web).ts`; гарды допускают «сессия неизвестна» — SSR отдаёт HTML, вкладки — скелетон.
  Web: вход, refresh, poll регистрации и выход — под одним Web Lock (`session-lock.web.ts`): операции, меняющие
  cookie, не перекрываются между вкладками; API на 401 без предъявленной cookie её не сбрасывает. Native — замок в
  памяти процесса (`session-lock.ts`): выход во время фоновой ротации ждёт её и отзывает уже новый refresh.

### Сброс пароля (модуль `identity`, ADR-0006)

```
app «Забыли пароль?» ─ POST /v1/auth/password-reset { email }
        ─► лимиты (Redis, HMAC: IP 20/ч, затем e-mail — пауза 60 с, 5/сутки) ─► 429 до БД
        ─► один ответ { resendAvailableInSec } для любого адреса; аккаунт есть (и не удалён) —
           прежние ссылки superseded + password_reset_tokens (TTL 1 ч) + outbox (одна транзакция)
worker: очередь identity-email ─► захват отправки ─► письмо «Восстановление пароля» (…auth/reset/<token>)
ссылка …auth/reset/<token> ─ GET (только чтение: valid | expired | used | 404)
        ─ POST confirm { token, password } ─► ссылка проверена до argon2 ─► под lockUser: новый хеш, ссылка used,
          все сессии отозваны (password_reset), токен регистрации погашен, e-mail подтверждён, outbox
        ─► passwordChanged + e-mail (сессии нет) ─► «Пароль изменён» → «Вход» с e-mail
worker: очередь identity-email ─► письмо «Пароль изменён» (время по Минску, без ссылки с токеном)
```

- Очередь `identity-email` — один процессор-диспетчер по `job.name` (подтверждение, ссылка сброса, «Пароль изменён»):
  BullMQ раздаёт задачи очереди любому процессору. Захват отправки — общий для коллекций ссылок.
- Вход сверяет хеш пароля под `lockUserCredentials`: проверивший старый пароль до коммита сброса или пока сброс «в
  процессе» сессию не получает; ротация, закоммиченная между снимком сброса и отзывом сессий, вызывает конфликт
  записи — сброс повторяется и отзывает и её.
- App: запросы сброса — вне Web Lock сессии (cookie не трогают); после смены пароля сессия этого устройства —
  локальный выход (`useSignOut`); web-сервер отдаёт `Referrer-Policy: no-referrer` на `/auth/*`.

### Web (SSR, PWA)

`apps/app` собирается `expo export --platform web` (`web.output: 'server'`) и обслуживается `apps/app/server`
(Express + `expo-server`) за Caddy: HTML каждого маршрута — с сервера, OG — `generateMetadata`, данные — API
после гидрации (`loader` — только посев). PWA — manifest-маршрут из темы бренда, service worker — только статика.

## Outbox и очереди

- Модуль пишет событие через `MongoOutboxWriter.append(session, …)` в той же транзакции, что и данные; в payload —
  только id.
- Публикатор (`MongoOutboxPublisherModule` из `@rkarakulov/api-kit/mongo`, только worker) раз в ~1 с захватывает
  пачку (lease `claimId`/`claimedUntil`), ставит задачу `queue.add(type, { outboxEventId }, { jobId: id })` и отмечает
  `publishedAt`.
  Маршруты тип → очередь задаёт composition root (`worker.module.ts`); инфраструктура базы о модулях не знает.
- Задачи идемпотентны: повторная публикация не дублирует задачу (тот же `jobId`), обработчик
  перечитывает состояние из БД. Очистка опубликованных событий outbox — отдельная задача (позже).

## Дизайн-система (`packages/design-tokens`)

Источник — CSS прототипов (19 экранов, визуальный слой «Ателье»).

- **Бренд** (`brand.ts`, единственное место палитры): палитра прототипов (внутри файла, не экспортируется),
  шрифты (Playfair Display + Inter) и роли `text.*`, `surface.*`, `border.*`, `action.*`, `status.*`,
  `map.*`, `surfaceBar.*`, `control.*`, `surface.skeleton` для тем `light` (Jersey Aura), `dark` (Night Ride),
  `panel` (веб-панель «Протокол»: светлая семантика + `nav.*` тёмной навигации).
- **Структурные токены** — из базы `@rkarakulov/design-tokens`: `space`, `inset`, `size`, `stroke`, `radius`
  (квадратная эстетика: скругление только у тумблера), `motion` (пульс скелетона 1.2 с), плотность веб-панели
  (`density.compact`).
- **Типографика** (база): шкала `.t-*` прототипов; вес связан с ролью шрифта на уровне типов.
- **Контраст** (`contrast.ts`): пары ролей каждой темы проверяются тестом по WCAG (текст 4.5, UI 3).

| Клиент | Как подключает |
|---|---|
| app | `configureDesignSystem` (`src/theme/design-system.ts`); `useTheme()` → семантика; `textStyle(name)`; компоненты `@rkarakulov/ui`; данные — `AsyncContent` + `Skeleton*`; витрина `/ui-kit` = `UiKit` базы (dev) |
| admin | `installDesignSystem()` → `designSystemCss({ theme: 'panel' })` в `<head>`; классы `.t-*`, `.skeleton`; шрифты `src/fonts.ts` |

Шрифты на вебе — самохостинг `@fontsource/*` (без внешних CDN). Состояния данных — AGENTS.md §4.12.

Примитивы в приложениях не используются; hex-цвета в TSX/CSS приложений запрещены.

Раздел дополняется по мере реализации; устаревшая схема хуже отсутствующей.
