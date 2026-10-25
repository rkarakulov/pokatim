---
paths:
  - "apps/api/src/modules/identity/**"
  - "apps/api/src/modules/media/**"
  - "apps/app/src/features/auth/**"
  - "apps/api/src/modules/panel/**"
  - "apps/api/src/modules/races/**"
  - "apps/api/src/modules/calendar/**"
  - "apps/api/src/public-read.guard.ts"
  - "apps/api/src/cli/**"
  - "apps/admin/src/session/**"
---

# pokatim — зоны безопасности (дополняет `security.md`)

Эти пути — зона `security.md`, но его `paths:` (шаблон) их не покрывают: **прочитай `.claude/rules/security.md`
целиком** перед правкой. Security checklist (AuthN/AuthZ · входные данные · данные наружу · злоупотребления · секреты и
логи · аудит) обязателен в task.md; reviewer без него ставит REQUEST CHANGES.

- Пароли — argon2id. Токены — короткоживущий access + ротируемый refresh (хешем); инвалидация всех сессий при сбросе пароля.
- Ссылки verify/reset/delete — одноразовые, с TTL; открытие ссылки ничего не меняет, действие — POST по кнопке.
- Сессия в вебе (ADR-0003 п. 4): refresh — только в cookie `HttpOnly; Secure; SameSite=Strict` с узким `Path`
  (`SESSION_COOKIE` из contracts), без `Domain`, в теле ответа web его нет; access — только в памяти (не
  `localStorage`/`sessionStorage`); cookie-эндпоинты защищены CSRF (Fetch Metadata + Origin,
  `enableCsrfProtection`), CORS с credentials — только для `CORS_ORIGINS`. Native — refresh в теле, SecureStore.
- IP-лимиты — по `rateLimitKeyForIp` (IPv6 — сеть /64). Вход: счётчики IP → e-mail+IP → e-mail по очереди до первого
  отказа (отказанная попытка дальше не списывается).
- Вход по паролю (ADR-0005): лимиты попыток (`RateLimiter` базы, ключи — HMAC e-mail/IP) проверяются до argon2;
  неверный пароль, неизвестный и удалённый адрес — один `401 INVALID_CREDENTIALS` с одинаковым телом, для
  неизвестного адреса verify идёт по хешу-пустышке (выравнивание времени); 429 — одинаково для любых адресов; без
  «осталось N попыток». Сессия выдаётся только через `SessionService.issue`.
- Ротация refresh: предыдущий токен — только в окне повтора (60 с); позже — reuse detection, отзыв сессии
  (`revokedReason`); отказы refresh — один и тот же 401. Логи отзыва/блокировки — только `sid` и причина.
- Удаление аккаунта (когда появится) в **той же транзакции** под `lockUser` отзывает все сессии пользователя:
  ротация проверяет удалённость пользователя чтением до атомарного `findOneAndUpdate`, окно гонки закрывает
  только этот инвариант (ADR-0007, R3).
- Сброс пароля (ADR-0006): запрос — один ответ для любого адреса, лимиты IP → e-mail (HMAC-ключи) до БД, 429
  одинаков для любых адресов; письмо — только существующему аккаунту. Активна одна ссылка (новая заменяет прежние),
  TTL 1 ч; argon2 — только после проверки ссылки. Смена пароля отзывает **все** сессии (`password_reset`), гасит
  токен регистрации и сессию не выдаёт (вход — заново). Вход сверяет хеш пароля под `lockUserCredentials` (`$inc version`
  в транзакции: проверивший старый пароль до коммита сброса или пока сброс «в процессе» — 401). Пути с токеном в web (`/auth/*`) — `Referrer-Policy: no-referrer`. Лог — `uid` и
  число отозванных сессий.

- Авторизованные эндпоинты (ADR-0008): только `AuthGuard` identity (через `modules/identity/index.ts`) — access JWT
  (`AccessTokenVerifier`: HS256, `iss`/`aud`, `exp` по `CLOCK`, `sub`/`sid` — UUID) **и** живая сессия `sid` того же
  `sub`, пользователь не удалён; вторая проверка JWT вне `AccessTokenVerifier` — нет. Пользователь — только
  `@CurrentUser()` из access, не из тела/пути; любой отказ — один `401 UNAUTHORIZED` без лога. Клиент: Bearer —
  только явным параметром методов api-client, требующих входа (без глобального `getAccessToken`); вызовы — через
  `withAccessToken` (`features/auth/authorized.ts`), refresh — только `refreshAccess` под замком сессии.

- Персональные и биометрические данные (пульс, мощность, FTP, вес) — не в ответах и публичных ссылках, не в логах.
- Защита от перебора e-mail: нейтральные ответы регистрации, повтора письма и удаления аккаунта.
- Неподтверждённый аккаунт не получает полноценных токенов (AD-28) — спорный момент с V-09, решать в task.md.
- Файлы пользователей — в S3 под непредсказуемыми ключами; выдача — через подписанные URL.
- Парсеры FIT/GPX/KML работают в worker с лимитами по памяти и времени; XML — без внешних сущностей (XXE).

- Панель «Протокол» (ADR-0009): вход — только паролем через порт identity `PanelCredentials` (та же
  `CredentialsCheck`: общие счётчики `signin-*`, пустышка, один 401); второго входа по паролю в `panel` нет, коллекции
  identity `panel` не читает (только `IdentityAccounts`). Сессия панели — непрозрачный токен в cookie
  `PANEL_SESSION_COOKIE` (`Path=/v1/admin`, `HttpOnly; Secure; SameSite=Strict`, без `Domain`), в БД — sha256; access
  JWT и refresh приложения `PanelGuard` не принимает.
- `PanelGuard` на каждом запросе: сессия → аккаунт активен → **штамп учётных данных** совпадает → член `active` →
  права роли (карта — только сервер). Маршрут `/v1/admin/*` без `PanelGuard` или явного `@Public()` — тест красный.
  Снятие роли отзывает сессии панели в той же транзакции; себя менять нельзя; последнего админа убрать нельзя
  (`lockAdmins`). Логи — `uid`, `sid`, причина; CLI не печатает e-mail.
- **Принятый риск — тот же домен `/admin/`** (C3): XSS web приложения может действовать от имени открытой в том же
  браузере сессии панели. Обязательно **до прода**: 2FA (TOTP) для `admin` и строгий CSP web приложения; CSP панели —
  `infra/docker/admin-nginx.conf` (менять только вместе со смоуком `pnpm e2e:admin`, он отдаёт тот же заголовок).
- Доменные модули панели (`races`, `calendar`): каждый `/v1/admin/*` — `PanelGuard` + `@RequirePermission` (тест
  `src/admin-routes.test.ts` обходит контроллеры всех модулей); владение гонкой — в сервисе по правам сессии (без
  `races.manage_any` чужая — `404`, не 403); `ownerUserId`, статус, фаза, сезон — только сервер. Публичное чтение —
  только опубликованное, без владельца, имён сотрудников и `version`; IP-лимит `public-read`.
