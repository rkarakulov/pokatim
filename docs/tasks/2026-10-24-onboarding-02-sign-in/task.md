# 1. Title

Онбординг, слайс 2: вход по паролю, выход, жизненный цикл сессии (native refresh, окно повтора, reuse detection)

# 2. Goal

Райдер «Покатим» (`docs/product/brand.md`) с подтверждённым e-mail входит по e-mail и паролю на любой платформе
(iOS, Android, web/PWA) и выходит из аккаунта. Сессия переживает обрыв ответа refresh (окно повтора) и защищена от
кражи refresh-токена (reuse detection → отзыв сессии). Закрываются хвосты слайса 1 и F5b:

- слайс 1, Out of Scope: «Вход по паролю, refresh-ротация, logout, блокировка 15 мин — слайс 2»; потерянный ответ
  poll → «E-mail подтверждён. Войдите» (ADR-0002, «Последствия»);
- F5b (`docs/tasks/2026-10-23-onbike-web/task.md` §8 «Строгая ротация без окна повтора», §12 «Слайс 2»): окно повтора
  через предыдущий хеш, reuse detection, native refresh/sign-out, политика продления сессии (Q2 F5b).

Источники значений: решение Q4 слайса 1 (значения прототипа: «15 мин» — блокировка входа). Описания экрана входа и
его ошибок в `docs/product/` нет (`prototypes.md` отсутствует) — тексты и раскладка помечены `[ASSUMPTION]` и вынесены
автору (§8.1, «Вопросы автору»).

# 3. Scope

**Contracts / api-client** (`packages/contracts/src/auth/sign-in.schema.ts` — новый, `common.ts`; `packages/api-client`)
- `SignInRequest { email, password, sessionTransport? }`, `SignInResponse` (union по `state`: `signedIn` + сессия по
  транспорту | `verificationRequired` + токен регистрации — при согласии автора на Q4), код `INVALID_CREDENTIALS`
  (в конец списка). Клиент: `signIn(body)` с подмешиванием `sessionTransport`, как у `pollRegistration`.

**API — модуль `identity`**
- `POST /v1/auth/session/sign-in` — вход по e-mail + паролю; ответ по `sessionTransport` (`body` — `Session`,
  `cookie` — `CookieSession` + cookie `__Secure-onbike_rt`). Нейтральный отказ `401 INVALID_CREDENTIALS` для
  неверного пароля, неизвестного и удалённого e-mail; время ответа выровнено (argon2 verify и для неизвестного
  адреса). Web: cookie прежней сессии этого браузера, пришедшая на вход, отзывается после успешного входа.
- Ограничение попыток (Redis, `RateLimiter` базы): e-mail + IP, e-mail, IP — `429 RATE_LIMITED` + `retryAfterSec`
  одинаково для существующих и несуществующих адресов; при отказе пароль не проверяется (§8.1 R2, значения — Q1).
- Ротация refresh: окно повтора 60 с через `previous_refresh_token_hash` + `rotated_at`; предъявление предыдущего
  токена вне окна — reuse detection: сессия отзывается (`revoked_reason = 'reuse_detected'`), ответ — тот же 401.
- Выход принимает текущий **или предыдущий** refresh (гонка выхода с ротацией не оставляет живую сессию).
- Продление сессии при ротации — по решению автора (Q5; рекомендация — скользящие 30 дней с абсолютным пределом).
- Миграция `0004` (expand-only): `sessions` + `previous_refresh_token_hash`, `rotated_at`, `revoked_reason`, индекс.

**App (`apps/app`, все платформы)**
- Экран «Вход» (`(onboarding)/sign-in.tsx` вместо заглушки): e-mail, пароль, «Войти», «Создать аккаунт»; ошибки —
  баннером (401, 429 с отсчётом, сеть); SSR + `generateMetadata` (публичный экран), `DocumentTitle`; автозаполнение
  (`autoComplete="email"` / `"current-password"`). Web — под Web Lock `onbike.session-refresh` (вход меняет cookie).
- Предзаполнение e-mail из регистрации/занятого адреса — через память (стор), не через URL.
- «Уже есть аккаунт? Войти» на регистрации и «Войти» у `EMAIL_TAKEN` — уже есть (`register.tsx`), теперь ведут на
  настоящий экран (с e-mail в черновике).
- Потерянный ответ poll: `SignInRequired` — «E-mail подтверждён. Войдите с паролем», если локальный срок токена
  регистрации не истёк (401 ⇒ токен обменян ⇒ адрес подтверждён), иначе — «Регистрация устарела» с входом и
  регистрацией; `VerifiedElsewhere` — вход по паролю прямо здесь.
- Native: восстановление сессии — локально (офлайн-старт не выходит из аккаунта), затем фоновая ротация refresh
  (`POST /v1/auth/session/refresh` с телом) с сохранением нового токена в SecureStore; 401 → локальный выход и экран
  входа; сеть/429/5xx — остаёмся в аккаунте (одна немедленная повторная попытка при сетевой ошибке — в пределах окна).
  Сессионные операции native сериализованы in-process замком (`session-lock.ts`).
- Выход (native и web): сервер (`sign-out`) + очистка SecureStore (native) + `queryClient.clear()` + регистрация;
  офлайн — локальный выход всё равно. Кнопка «Выйти» — временно на «Главной» (Q7) до экрана профиля.
- После явного выхода и после отзыва сессии сервером — экран «Вход», а не «Регистрация» (`redirectTo` гарда по флагу
  «на устройстве уже входили»).

**E2E / docs** — шаги смоука `e2e/web.spec.ts` (SSR `/sign-in`; с API: выход → вход по паролю → перезагрузка);
ADR-0005, правки ADR-0002/0003, architecture, rules (§10).

# 4. Out of Scope

- Сброс пароля и ссылка «Забыли пароль?» — слайс 3 (ссылку не показываем: мёртвых действий нет). Инвалидация всех
  сессий пользователя при сбросе (отзыв по `user_id`) — тоже слайс 3.
- Опрос и геопозиция — слайс 4. Веб-страницы ссылок / universal links — слайс 5.
- Авторизация эндпоинтов по access JWT (AuthGuard), авто-refresh access по 401, обновление сессии при возврате
  приложения из фона (`AppState`) — с первым авторизованным эндпоинтом (AGENTS.md §4.9: нет «на вырост»).
  **Сделано:** AuthGuard и авто-refresh — `docs/tasks/2026-10-25-onboarding-04-survey-geo` (ADR-0008); `AppState`
  не понадобился (обновление перед авторизованным запросом).
- Список устройств / «выйти на всех устройствах», уведомление о входе с нового устройства, 2FA, биометрия
  (`onbike-app.md`: биометрического входа нет), внешние IdP.
- Журнал входов (append-only `auth_events`) — §8.1 R6; в слайсе 2 — `revoked_reason` и структурный лог.
- Очистка истёкших/отозванных строк `sessions` — отдельная задача обслуживания.
- Изменения в app-foundation (лимитер с `peek/reset` — follow-up, §8.1 R2).

# 5. Architecture Context

- **api:** `apps/api/src/modules/identity` — `session.controller.ts` (+ `sign-in`), новый `sign-in.service.ts`
  (логика входа, лимиты), `session.service.ts` (ротация с окном и reuse, отзыв, выдача без изменений),
  `identity.repository.ts` (запросы сессий, `findCredentialsByEmail`), `password-hasher.ts` (+ `verify`),
  `identity.policy.ts` (лимиты входа, окно повтора, продление), `identity.schema.ts` (колонки `sessions`).
  Чужие модули не затрагиваются; `index.ts` модуля не меняется.
- **contracts:** только добавления (`SignInRequest`, `SignInResponse`, `INVALID_CREDENTIALS` в конец
  `defineErrorCodes`). `RefreshSessionRequest`, `SignOutRequest`, `Session`, `CookieSession`, `SESSION_COOKIE` — без
  изменений формы; старые сборки native (не зовут refresh/sign-in) не затронуты.
- **Миграция `0004_session_rotation`** — expand-only: три nullable-колонки + CHECK + частичный индекс по предыдущему
  хешу. Данные не переносятся. Обратная совместимость: API предыдущей версии колонки не читает.
- **Очереди/outbox:** не нужны — вход, ротация, выход синхронны; писем в слайсе 2 нет (уведомление о входе — вне
  scope). BullMQ не трогаем.
- **Redis:** счётчики попыток входа через `RateLimiter` из `@rkarakulov/api-kit` (уже в `SessionService`,
  `RegistrationService`); ключи — HMAC (как `rateLimitKeyForIp`).
- **app:** `features/auth/*` (сторы, persistence, lock, queries, error-messages, verification-states),
  `(onboarding)/sign-in.tsx`, `_layout.tsx` (`redirectTo`), `(tabs)/index.tsx` (выход), `packages/i18n/src/ru.ts`.

# 5.1 Placement & Reuse Gate

- **Переиспользуем:** `Email`, `Password`-лимиты (`PASSWORD_MAX_LENGTH`), `normalizeEmail`, `OpaqueToken`,
  `SessionTransport`, `AnySession`/`CookieSession`, `SESSION_COOKIE` (contracts); `SessionService.issue` (выдача
  сессии — единственная точка), `SessionCookie.deliver/clear/noStore` (транспорт), `RateLimiter.consume` +
  `rateLimitKeyForIp` (лимиты), `domainError`/`PROJECT_ERROR_MESSAGES`, `ZodValidationPipe`, `CLOCK`;
  `withSessionLock` (web), `persistSession/clearSession/restoreSession` (платформенные развилки файлами),
  `actionErrorMessage`/`retryAfterSec`/`apiErrorCode`, `AuthScreen`/`AuthActions`/`AuthInline`, `useSecondsLeft`
  (`lib/countdown`), `publicPageMetadata`, `DocumentTitle`; компоненты `@rkarakulov/ui` (`TextField`, `Button`
  `loading`, `Banner`, `TextAction`).
- **Запрещённые дубли:** вторая реализация выдачи сессии или cookie (только `SessionService.issue` +
  `SessionCookie`); свой Redis-Lua лимитер в identity (только `RateLimiter` базы — §8.1 R2); ручной `fetch` в app;
  DTO вне contracts; `Platform.OS` в экранах; тексты вне `@on-bike/i18n`; оформление вне токенов/компонентов.
- **Тонкий контроллер:** `SessionController.signIn` — pipe контракта, `@Ip`, `@Cookies`, вызов `SignInService`,
  доставка по транспорту; решения (лимиты, проверка пароля, AD-28) — в сервисе.
- **Пакеты:** новых нет (≥2 потребителей нет). Код для базы — только follow-up (лимитер `peek/reset`, identity в F6).

# 6. Relevant Files

- `apps/api/src/modules/identity/session.controller.ts` — refresh/sign-out; сюда `sign-in`.
- `apps/api/src/modules/identity/session.service.ts` — `issue`/`rotate`/`revoke`; окно повтора, reuse.
- `apps/api/src/modules/identity/identity.repository.ts` — `rotateSession`, `revokeSession`; новые запросы.
- `apps/api/src/modules/identity/{identity.schema,identity.policy,password-hasher,registration.service}.ts`.
- `apps/api/src/modules/identity/session.int.test.ts`, `apps/api/test/identity.ts` — образец int-тестов сессии.
- `packages/contracts/src/auth/session.schema.ts`, `packages/contracts/src/common.ts`, `packages/api-client/src/index.ts`.
- `apps/app/src/features/auth/{session-store,session-persistence(.web),session-lock(.web),queries,verification-states,registration-store,error-messages}.ts(x)`.
- `apps/app/src/app/(onboarding)/{sign-in,register}.tsx`, `apps/app/src/app/_layout.tsx`, `apps/app/src/app/(tabs)/index.tsx`.
- `apps/app/e2e/web.spec.ts`, `packages/i18n/src/ru.ts`.

# 7. Implementation Notes

- **Порядок входа (сервис):** контракт → `normalizeEmail` → три `RateLimiter.consume` (IP, e-mail+IP, e-mail; любой
  отказ → 429 с наибольшим `retryAfterSec`, пароль не проверяется) → `findCredentialsByEmail` → `argon2.verify`
  (для неизвестного/удалённого — по фиксированному «пустышечному» хешу тех же параметров, вычисленному один раз при
  старте сервиса) → исход: неверно/нет/удалён → 401 `INVALID_CREDENTIALS`; верно и не подтверждён → Q4; верно и
  подтверждён → транзакция `lockUser` + `SessionService.issue` → доставка по транспорту.
- **`PasswordHasher.verify(hash, password)`** — `@node-rs/argon2` `verify`; битый хеш → `false`, не исключение.
  Параметры хеша не меняются, rehash не нужен.
- **Ротация одним UPDATE** (READ COMMITTED, перепроверка WHERE после ожидания блокировки — как сейчас):
  ```sql
  UPDATE sessions
     SET previous_refresh_token_hash = refresh_token_hash,   -- старое значение строки
         refresh_token_hash = :next, rotated_at = :now
         [, expires_at = LEAST(:now + ttl, created_at + absolute)]   -- только при Q5 = скользящий срок
   WHERE revoked_at IS NULL AND expires_at > :now AND <пользователь не удалён>
     AND (refresh_token_hash = :h
          OR (previous_refresh_token_hash = :h AND rotated_at > :now - :grace))
  RETURNING id, user_id, expires_at;
  ```
  В обоих случаях новый «предыдущий» — текущий хеш строки до UPDATE: при повторе в окне брошенный текущий токен
  становится предыдущим, и его позднее предъявление (вне окна) — тоже reuse. 0 строк → `UPDATE sessions SET
  revoked_at = :now, revoked_reason = 'reuse_detected' WHERE previous_refresh_token_hash = :h AND rotated_at <= :now -
  :grace AND revoked_at IS NULL RETURNING id` → лог `warn` с `sid` (без токена, e-mail, IP) → 401. Иначе — 401.
- **Выход:** `revoked_reason = 'signed_out'`, условие `(refresh_token_hash = :h OR previous_refresh_token_hash = :h)`.
- **Вход на web при живой cookie** (cookie уходит на `/v1/auth/session/*`): после успешного входа — отзыв сессии
  предъявленной cookie (`revoked_reason = 'superseded'`), затем `Set-Cookie` новой; сбой отзыва вход не отменяет.
- **Native замок:** `session-lock.ts` — цепочка промисов в памяти (одна операция сессии за раз: вход, фоновая
  ротация, выход, poll); web — прежний Web Lock, вход — под ним.
- **Native восстановление:** `restoreSession` возвращает локальную сессию (как сейчас), новая `revalidateSession`
  (native — refresh по телу + `persistSession`; web — no-op, там восстановление уже refresh) вызывается стором после
  гидрации. Сбой записи SecureStore после ротации — `console.warn` без токена (следующий запуск вне окна → reuse →
  вход заново; принято, §8).
- **E-mail в сторе, не в URL:** `registration-store.draft.email` уже есть — экран входа читает его как
  `defaultValues`; e-mail в query-строке попал бы в историю браузера и логи web-сервера.
- **Тексты** — `packages/i18n/src/ru.ts`, формальное «вы»; финальные — по ответу автора (Q3).

# 8. Risks / Assumptions / Open Questions

- **Ложный выход при потерянном ответе refresh вне окна (принято).** Сервер ротировал, клиент ответа не получил и
  повторил позже 60 с (приложение убито, вкладка закрыта во время запроса) → reuse → сессия отозвана → вход по паролю.
  Смягчение: native — одна немедленная повторная попытка; web — Web Lock. Цена — ввод пароля, не потеря данных.
- **Браузеры без Web Locks:** гонка двух вкладок с переупорядочиванием ответов может оставить в cookie токен,
  ставший «предыдущим»; позже 60 с — reuse → выход. Редкий случай (Web Locks есть во всех evergreen-браузерах).
- **Параллельные refresh одним токеном:** было `[200, 401×4]` (F5b), станет `[200, 200, 401×3]` (второй — повтор в
  окне). Тест F5b обновляется осознанно (§8.2 при реализации).
- **Повторная выдача токена регистрации при входе неподтверждённого (Q4):** прежний токен на первом устройстве
  перестаёт действовать — тот экран покажет «Войдите». Принимаем (у пользователя таблица на один токен).
- **Блокировка чужого аккаунта (DoS)** — §8.1 R1, Q2.
- **CGNAT** мобильных операторов Беларуси: лимит по IP (50/15 мин) — с запасом `[ASSUMPTION]`, как 20/ч регистрации.
- `[ASSUMPTION]` Раскладка экрана «Вход» — по образцу «Создать аккаунт» (`AuthScreen`, кикер, поля, кнопка, строка
  «Нет аккаунта? Создать аккаунт»); прототипа в репозитории нет.
- `[ASSUMPTION]` Переключателя видимости пароля нет (в форме регистрации его тоже нет); нужен — задача в базу
  (`TextField`).

# 8.1 Requirements Consistency

Architecture Review — onboarding-02-sign-in. **Status: CONCERNS** — блокеров нет; продуктовые вопросы Q1–Q9 — автору
(human gate), без ответа реализуется рекомендация. Решения R1–R7 — архитектора, оркестратор может переиграть.

- **R1. Вредное решение: блокировка «по аккаунту» в чистом виде (Q1/Q2).** Счётчик только по e-mail позволяет любому,
  кто знает адрес, держать владельца вне аккаунта (5 запросов раз в 15 мин). Альтернативы:
  (а) только e-mail: 5 / 15 мин — буква прототипа, DoS принят;
  (б) **e-mail + IP: 5 / 15 мин; e-mail (все IP): 20 / 15 мин; IP (все адреса): 50 / 15 мин** — обычный пользователь
  видит блокировку после 5 ошибок, злоумышленник с одного IP чужой аккаунт не блокирует, распределённый перебор
  ограничен ~1900 попыток/сутки на аккаунт, spraying и нагрузка argon2 — лимитом IP;
  (в) прогрессивная задержка без блокировки — расходится с прототипом («15 мин»). **Рекомендую (б).**
- **R2. Конфликт с инвариантом (AGENTS.md §2/§4.4, `backend.md`: инфраструктура — в app-foundation).** «Блокировка
  после N неудачных попыток» требует у лимитера `peek` и `reset` — их в `RateLimiter` базы нет
  (`app-foundation` `packages/api-kit/src/redis/rate-limiter.ts`: только `consume`). Альтернативы:
  (а) **считать все попытки входа в фиксированном окне `consume`** (успешные тоже): гарантия против перебора та же
  (≤ N догадок за окно), блокировка длится до конца окна (≤ 15 мин от первой попытки), без изменений базы;
  (б) новый примитив в api-kit (`check/registerFailure/reset`, блокировка ровно 15 мин после N-й ошибки) — задача и
  релиз app-foundation до слайса API, обновление каталога; (в) свой Lua в identity — нарушение инварианта, нет.
  **Рекомендую (а)** в слайсе 2; (б) — follow-up при переносе identity в базу (F6). Расхождение с «после N
  **неудачных**» видно пользователю лишь при 5+ входах за 15 мин — Q1 называет это явно.
- **R3. Окно повтора и reuse detection.** F5b предложил `previous_refresh_token_hash` + `rotated_at`, окно 30–60 с.
  Принято с уточнениями: окно **60 с** (мобильная сеть); повтор в окне — новая ротация той же сессии, «предыдущим»
  становится брошенный текущий токен (так кража ловится и при «пинг-понге»); отзыв — только эта сессия (Q8).
  Альтернативы: таблица истории всех хешей (ловит любые старые токены, но растёт на каждую загрузку web-страницы;
  без пользы — старые токены и так мертвы); «предыдущий без срока до следующей ротации» (нет ложных выходов, но
  укравший получает рабочую сессию до следующего захода владельца — дни на native). Нет.
- **R4. Путь входа `POST /v1/auth/session/sign-in`,** а не `/v1/auth/sign-in`: `Path` cookie — `/v1/auth/session`,
  поэтому вход видит прежнюю cookie браузера и отзывает её сессию (иначе — осиротевшие живые сессии при смене
  аккаунта в соседней вкладке). Регистрация остаётся `/v1/auth/register` (cookie туда не уходит — так и задумано).
- **R5. Native refresh — фоновый после локального восстановления,** а не блокирующий (как web): офлайн-старт на
  велопрогулке не должен выкидывать из аккаунта или показывать «Нет соединения» вместо вкладок. Без авторизованных
  эндпоинтов ротация при холодном старте нужна, чтобы отзыв на сервере (выход в другом месте, reuse) дошёл до
  устройства; авто-refresh по 401 и `AppState` — вне scope (§4).
- **R6. Аудит (Security §6).** Вход, блокировка, reuse — чувствительные события; append-only журнала входов у
  проекта нет (`onbike-backend.md`: append-only — споры, треки, пересчёты, модерация). В слайсе 2: `revoked_reason`
  у сессии + структурный лог (`sid`, причина; без e-mail/IP/токенов). Журнал `auth_events` — отдельной задачей,
  если понадобится разбор инцидентов (Q9).
- **R7. Противоречие в источнике: «E-mail подтверждён. Войдите» (ADR-0002) vs нейтральный 401 poll.** Сервер не
  различает «обменян» и «истёк» (без оракула). Клиент знает свою оценку срока токена (`expiresAt` в
  registration-store): не истёк → 401 значит «обменян» → адрес подтверждён → «E-mail подтверждён. Войдите с паролем»;
  истёк → «Регистрация устарела». API не меняется.
- **Недоопределено (продукт) — Q1–Q9 ниже.** Не блокируют: у каждого — рекомендация по умолчанию.

### Вопросы автору (human gate)

| # | Вопрос | Рекомендация (по умолчанию) |
|---|---|---|
| Q1 | N попыток и что считаем | 5 попыток за 15 мин на пару e-mail+IP; считаются все попытки (R2а), блокировка до конца окна (≤ 15 мин) |
| Q2 | Блокировать аккаунт целиком (буква прототипа) или по e-mail+IP с общим потолком (R1) | R1(б): 5 e-mail+IP / 20 e-mail / 50 IP за 15 мин |
| Q3 | Тексты | «Неверный e-mail или пароль.» (401); «Слишком много попыток входа. Попробуйте через {время}.» (429, отсчёт по `retryAfterSec`); «E-mail подтверждён. Войдите с паролем.» (потерянный poll); «Регистрация устарела. Войдите или зарегистрируйтесь заново.»; «Адрес {email} подтверждён. Войдите с паролем.» (ссылка на другом устройстве); «Выйти» / подтверждения выхода нет. Без «осталось N попыток» (лишняя подсказка перебору) |
| Q4 | Верный пароль у неподтверждённого аккаунта | Ответ `verificationRequired` с новым токеном регистрации → «Подтвердите e-mail» на этом устройстве (повтор письма, вход без пароля после подтверждения). Альтернатива — `403` «Подтвердите e-mail по ссылке из письма» без повтора (тупик, если письмо потеряно, до очистки через 7 дней) |
| Q5 | Продление сессии (Q2 F5b) | Скользящий срок: каждая ротация — 30 дней от «сейчас», абсолютный предел 180 дней от входа. Альтернатива — как сейчас, 30 дней от входа (вход по паролю раз в месяц) |
| Q6 | «Запомнить меня» | Нет: native — сессия в SecureStore; web — постоянная cookie с остатком срока; на чужом компьютере — «Выйти» |
| Q7 | Где «Выйти», пока нет профиля | `TextAction` «Выйти» на «Главной» (временно; в профиль — с экраном профиля) |
| Q8 | Reuse detection: отзывать одну сессию или все сессии пользователя | Одну (семейство токенов = сессия `sid`); «выйти везде» — со сбросом пароля (слайс 3) |
| Q9 | Журнал входов (append-only) | Не сейчас: `revoked_reason` + лог (R6) |

# 8.2 Deviations from spec

Решения до кода (2026-10-24):

- **Автор (human gate):** Q1/Q2 — лимиты входа e-mail+IP 5 / e-mail 20 / IP 50 за 15 мин (R1б); Q4 — верный пароль
  у неподтверждённого → `verificationRequired` с новым токеном регистрации → «Подтвердите e-mail» с повторной
  отправкой; Q5 — скользящие 30 дней от ротации, абсолютный предел 180 дней от входа; Q7 — «Выйти» временно
  `TextAction` на «Главной».
- **Оркестратор (по рекомендациям архитектора):** Q3 — тексты как рекомендовано, без «осталось N попыток»; Q6 — без
  «Запомнить меня»; Q8 — reuse detection отзывает одну сессию (`sid`); Q9 — журнала входов нет (`revoked_reason` +
  структурный лог только с `sid`); R2 — все попытки входа считаются в фиксированном окне существующим `RateLimiter`
  базы (без релиза базы), примитив «N неудачных» — follow-up в app-foundation; R4 — путь
  `POST /v1/auth/session/sign-in`; R3 — окно повтора 60 с, тест параллельных refresh F5b меняется осознанно
  (`[200, 401×4]` → `[200, 200, 401×3]`).

Отклонения и уточнения при реализации:

- **`SignInRequest` — `z.strictObject`:** лишние ключи — 400 (§8.3 п. 2). Остальные запросы контрактов — как были
  (лишнее отбрасывается).
- **`verificationRequired.resendAvailableInSec = 0`:** вход письмо не отправляет; пауза повтора — лимит
  `verify-resend` (если он ещё действует, «Отправить ещё раз» покажет «Слишком много писем»). Срок нового токена
  регистрации — 24 ч (как ссылка); без письма прежняя ссылка остаётся действующей, если не истекла.
- **Флаг `returning` (гард → «Вход») — только в памяти:** после выхода/отзыва сессии в этом запуске. После
  перезапуска без сессии — «Регистрация» (как раньше): хранить признак «уже входили» на устройстве — отдельное
  продуктовое решение (не требовалось AC7).
- **Тексты Q3** разложены на заголовок + текст экрана: «Войдите в аккаунт» / «E-mail подтверждён. Войдите с
  паролем.»; «Регистрация устарела» / «Войдите или зарегистрируйтесь заново.». Остальные — дословно.
- **Сессия в памяти стора — без refresh** (`CookieSession.parse` при входе) на обеих платформах: на native refresh
  берётся из SecureStore (ротация и выход читают его оттуда под замком).
- **jest:** `jest.setup.ts` сбрасывает сторы через `jest.requireActual` в `beforeEach`, а не статическим импортом —
  стор сессии теперь тянет `@/lib/api` (native-ротация), и импорт в setup закешировал бы настоящий клиент раньше
  `jest.mock('@/lib/api')` тестов. Тесты вкладок/витрины без корневого layout получили `QueryClientProvider`
  (`useSignOut` на «Главной»).
- **E2E:** второй ожидаемый отказ — 401 `POST /v1/auth/session/sign-in` (шаг «неверный пароль»); поля формы входа —
  по роли (под «Входом» в стеке скрыто смонтирована «Регистрация» с теми же подписями полей).

# 8.3 Security checklist

Затронуты аутентификация и сессии (`onbike-security.md`, `security.md`): вход, лимиты, ротация, выход, web-cookie.

1. **AuthN/AuthZ.** `sign-in` — публичный; сессию получает только подтверждённый не удалённый аккаунт с верным паролем
   (AD-28: неподтверждённому — максимум токен регистрации, Q4). `refresh`/`sign-out` — владелец текущего (или в окне
   — предыдущего) refresh; reuse вне окна отзывает сессию. Проверки — на сервере, в условном UPDATE (гонки).
   Web: refresh только в cookie `HttpOnly; Secure; SameSite=Strict; Path=/v1/auth/session`, без `Domain`; CSRF —
   глобальный `enableCsrfProtection` (login CSRF закрыт Fetch Metadata + Origin); native — тело + SecureStore.
2. **Входные данные.** Zod-контракт: `Email` (≤ 254, trim), пароль 1–128 (верхний предел ограничивает работу
   argon2), `sessionTransport` — enum; лишние ключи — 400; cookie — `OpaqueToken.safeParse` до лимита и БД.
3. **Данные наружу.** Ответ входа — только токены/сроки (web — без refresh); `verificationRequired` — токен
   регистрации и e-mail, только после верного пароля. Одинаковые тела 401 для «нет адреса / неверный пароль /
   удалён» и одинаковые 401 refresh для «отозвана / истекла / reuse / мусор»; `Cache-Control: no-store`.
4. **Злоупотребления.** Лимиты входа (R1/R2, Redis, ключи — HMAC e-mail и IP), 429 + `retryAfterSec` без проверки
   пароля и одинаково для несуществующих адресов; выравнивание времени (verify по пустышке); лимит refresh 60/мин IP
   (как есть); argon2 — только после лимитов.
5. **Секреты и логи.** В БД — sha256 refresh (текущий и предыдущий), пароль — argon2id; в Redis — HMAC-ключи, не
   e-mail/IP; логи reuse/блокировки — только `sid`/причина; пароль, токены, e-mail, IP не логируются (тест на
   вызовы логгера); клиент: `console.warn` — только имя ошибки.
6. **Аудит.** `sessions.revoked_reason` (`signed_out` | `reuse_detected` | `superseded`) + `revoked_at`; журнала
   входов нет (R6, Q9). Append-only таблиц не меняем.

# 9. Acceptance Criteria

1. Вход: подтверждённый аккаунт, верный пароль → 200; `body` — `Session`, `cookie` — `CookieSession` + cookie с
   атрибутами F5b; e-mail в любом регистре и с пробелами по краям.
2. Неверный пароль, неизвестный и удалённый e-mail → 401 `INVALID_CREDENTIALS`, тела побайтно одинаковы; для
   неизвестного адреса argon2 verify вызывается (пустышка).
3. Лимиты (Q1/Q2): 6-я попытка за окно → 429 `RATE_LIMITED` + `retryAfterSec`, и с верным паролем, и для
   несуществующего адреса; пароль при отказе не проверяется; после окна вход проходит.
4. Неподтверждённый + верный пароль → по Q4 (рекомендация: `verificationRequired`, новый токен работает в poll/resend,
   прежний — 401); неверный пароль у неподтверждённого → 401.
5. Refresh: текущий → ротация (`previous`/`rotated_at`); предыдущий в окне 60 с → 200, та же `sid`; предыдущий вне
   окна → 401 и сессия отозвана (`reuse_detected`), текущий токен этой сессии после — 401; неизвестный → 401 без
   отзыва; 5 параллельных одним токеном → ровно 2 × 200, сессия жива.
6. Выход текущим или предыдущим токеном → сессия отозвана (`signed_out`), 204; web-вход при живой cookie отзывает
   прежнюю сессию (`superseded`).
7. App (iOS, Android, web): экран «Вход» по дизайн-системе, ошибки и 429 с отсчётом, кнопка — `loading`; вход →
   Главная; «Выйти» → экран «Вход», SecureStore/cookie очищены; native-офлайн-старт — в аккаунте; native 401 при
   фоновой ротации → «Вход»; потерянный poll → «E-mail подтверждён. Войдите с паролем» → вход с подставленным e-mail.
8. Web SSR: `/sign-in` — HTML формы, `<title>`/OG без персональных данных; смоук с API: регистрация → выход → вход
   по паролю → перезагрузка — в аккаунте; `document.cookie` без refresh.
9. Архитектура: выдача сессии только через `SessionService.issue`, лимиты только `RateLimiter`, DTO только из
   contracts, без `Platform.OS` в экранах; `pnpm check` зелёный; int-тесты на реальных PostgreSQL + Redis.

# 10. Documentation Impact

- **ADR-0005** «Вход по паролю и жизненный цикл refresh: окно повтора, reuse detection, лимиты входа» (R1–R5) +
  строка в `docs/adr/README.md`.
- **ADR-0002** — раздел «Пересмотр (слайс 2)»: вход по паролю есть; потерянный poll → «E-mail подтверждён. Войдите»
  (R7); неподтверждённый вход — по Q4.
- **ADR-0003**, «Реализация» п. 4 — вход по паролю ставит ту же cookie; окно повтора снимает риск строгой ротации F5b.
- `docs/architecture/README.md` — «Сессия: native и web»: вход, ротация с окном, reuse, выход, native-фоновая ротация.
- `.claude/rules/onbike-security.md` — правило: нейтральный вход, лимиты, выравнивание времени, reuse detection.
- `.claude/rules/onbike-app.md` — «Сессия»: native-замок, фоновая ротация, выход (очистка кеша запросов), вход под
  Web Lock, e-mail между экранами — не в URL.
- `docs/runbooks/local-dev.md` — новых env нет; абзац «как снять блокировку входа в dev» (ключи `rl:signin-*` в Redis).
- `docs/tasks/2026-10-23-onbike-web/task.md` §12 — follow-up «слайс 2» отмечен ссылкой на эту задачу.

# 11. Implementation Context

Уровень — task3. Слайсы — по коммиту, проверка после каждого обязательна. Q1–Q9 — по ответу автора (по умолчанию —
рекомендации §8.1).

### ENTRY POINTS
- API: `POST /v1/auth/session/sign-in` (новый), `POST /v1/auth/session/refresh` (окно, reuse, продление),
  `POST /v1/auth/session/sign-out` (по текущему или предыдущему) — `session.controller.ts`.
- App: `src/app/(onboarding)/sign-in.tsx`, `src/app/_layout.tsx` (`redirectTo`), `features/auth/session-store.ts`
  (`hydrate` → `revalidateSession`, `signOut`), `src/app/(tabs)/index.tsx` («Выйти»).

### Слайсы и проверка после каждого
| # | Что | Проверка |
|---|---|---|
| **S1** | Contracts + api-client: `SignInRequest`, `SignInResponse`, `INVALID_CREDENTIALS` (в конец), комментарии `Session` («вход — `/session/sign-in`»); `api.signIn` с `sessionTransport` и `credentials` | TDD; `pnpm --filter @on-bike/contracts test`, `--filter @on-bike/api-client test`, `pnpm typecheck` (новый код без текста в `error-messages.ts` — красный typecheck API: добавить текст здесь же) |
| **S2** (после S1, параллельно S3) | API: миграция `0004` (`db:generate`, SQL глазами), `identity.schema`/`policy`, `PasswordHasher.verify`, `SignInService`, `SessionController.signIn`, ротация с окном/reuse/продлением, выход по предыдущему, отзыв `superseded` | `pnpm --filter @on-bike/api test` (unit + int на `onbike_test`, Redis db 1); `db:migrate` на чистой БД; Security §8.3 — каждый пункт тестом; `pnpm check` |
| **S3** (после S1, параллельно S2) | App: экран «Вход», стор/черновик e-mail, `signIn` (web — под Web Lock), native `session-lock` (мьютекс), `revalidateSession` (native/web), выход (сервер + очистка + `queryClient.clear()`), `redirectTo` по флагу, `SignInRequired`/`VerifiedElsewhere`, `verificationRequired` → `/check-email`, «Выйти» на Главной; строки `ru.ts` | `pnpm --filter @on-bike/app test` (native + web + server); `typecheck`; `expo export -p android`; `build:web` + `start:web` + `curl /sign-in` (форма, title, без ПДн) |
| **S4** | E2E + docs: шаги `e2e/web.spec.ts` (SSR `/sign-in`; с API: выход → вход → перезагрузка; неверный пароль — баннер), §10 | `pnpm build:web && E2E_API=1 pnpm --filter @on-bike/app e2e:web` — зелёный; без API — сценарий с API `skip`; ссылки в docs живые; `pnpm check` |

Параллель S2/S3: S2 — только `apps/api/**`; S3 — только `apps/app/**` и `packages/i18n/src/ru.ts`. `packages/contracts`,
`api-client`, lockfile — только S1.

### FILES TO MODIFY
| Файл | Слайс | Изменение |
|---|---|---|
| `packages/contracts/src/auth/sign-in.schema.ts` (новый, + test), `src/index.ts`; `session.schema.ts` — комментарии | S1 | `SignInPassword`, `SignInRequest`, `SignInResponse` (отдельный файл: `registration` уже импортирует `session` — без цикла) |
| `packages/contracts/src/common.ts` (+ test) | S1 | `INVALID_CREDENTIALS` в конец `defineErrorCodes` |
| `packages/api-client/src/index.ts`, `src/session.test.ts` | S1 | `signIn` |
| `apps/api/src/error-messages.ts` (+ test) | S1 | `INVALID_CREDENTIALS: 'Неверный e-mail или пароль'` |
| `apps/api/drizzle/0004_*.sql`, `meta/*` | S2 | колонки, CHECK, индекс |
| `apps/api/src/modules/identity/identity.schema.ts` | S2 | `previousRefreshTokenHash`, `rotatedAt`, `revokedReason` |
| `apps/api/src/modules/identity/identity.policy.ts` | S2 | `signInLimits` (3 правила), `refreshReuseGraceMs: 60_000`, `sessionAbsoluteTtlMs` (Q5) |
| `apps/api/src/modules/identity/password-hasher.ts` (+ test) | S2 | `verify` |
| `apps/api/src/modules/identity/sign-in.service.ts` (новый, + `sign-in.int.test.ts`) | S2 | вход (§7) |
| `apps/api/src/modules/identity/session.service.ts` (+ test) | S2 | `rotate` с окном/reuse; `revoke(reason)`; лог reuse |
| `apps/api/src/modules/identity/identity.repository.ts` (+ int) | S2 | `findCredentialsByEmail`, `rotateSession` (§7), `markReuseDetected`, `revokeSession(hash, reason)` |
| `apps/api/src/modules/identity/session.controller.ts` (+ test) | S2 | `@Post('sign-in')`: pipe, `@Ip`, `@Cookies`, `noStore`, `deliver`, отзыв прежней cookie |
| `apps/api/src/modules/identity/identity.module.ts` | S2 | `SignInService` в providers |
| `apps/api/src/modules/identity/registration.service.ts` | S2 | (Q4) выдача нового токена регистрации — метод, переиспользуемый входом |
| `apps/api/src/modules/identity/session.int.test.ts` | S2 | параллельные refresh: `[200, 200, 401×3]`; окно, reuse, выход по предыдущему |
| `apps/app/src/app/(onboarding)/sign-in.tsx` (+ test) | S3 | экран (форма как `register.tsx`, схема — `SignInRequest`) |
| `apps/app/src/features/auth/queries.ts` | S3 | `useSignIn` (мутация под `withSessionLock`) |
| `apps/app/src/features/auth/session-store.ts` (+ test) | S3 | `hydrate` → `revalidateSession`; `signOut` (сервер + локально); флаг `returning` |
| `apps/app/src/features/auth/session-persistence.ts` / `.web.ts` (+ tests) | S3 | `revalidateSession`; native `clearSession` → `api.signOut({ refreshToken })` + SecureStore |
| `apps/app/src/features/auth/session-lock.ts` | S3 | in-process мьютекс |
| `apps/app/src/features/auth/verification-states.tsx` | S3 | тексты R7, вход с e-mail |
| `apps/app/src/features/auth/error-messages.ts` (+ test) | S3 | `INVALID_CREDENTIALS`, текст блокировки с отсчётом |
| `apps/app/src/app/_layout.tsx` | S3 | `redirectTo` по `returning` |
| `apps/app/src/app/(tabs)/index.tsx` | S3 | «Выйти» (Q7) |
| `packages/i18n/src/ru.ts` | S3 | `auth.signIn.*`, `auth.signOut`, тексты Q3 |
| `apps/app/e2e/web.spec.ts` | S4 | шаги §9.8 |
| docs §10 | S4 | — |

### FILES TO READ
`AGENTS.md` §4; `.claude/rules/{security,onbike-security,backend,onbike-backend,contracts,onbike-contracts,db,app,onbike-app,tests}.md`;
ADR-0002, ADR-0003 («Реализация» п. 4); `docs/tasks/2026-10-23-onbike-web/task.md` §8, §8.3, §11–12 (S4, фиксы
pass 1); `docs/tasks/2026-10-22-onboarding-01-signup/task.md` §8.1, §11; `apps/api/test/{harness,identity}.ts`;
`@rkarakulov/api-kit` `RateLimiter`; `@node-rs/argon2` `verify` (context7).

### TYPES & SCHEMAS
```ts
// packages/contracts/src/auth/sign-in.schema.ts
export const SignInPassword = z.string({ error: fieldError('REQUIRED') })
  .min(1, { error: 'REQUIRED' }).max(PASSWORD_MAX_LENGTH, { error: 'TOO_LONG' }); // без TOO_SHORT: политика — у регистрации
export const SignInRequest = z.object({
  email: Email, password: SignInPassword, sessionTransport: SessionTransport.optional(),
});
export const SignInResponse = z.discriminatedUnion('state', [
  z.object({ state: z.literal('signedIn'), session: AnySession }),
  // Q4 (рекомендация); при отказе автора — вариант убирается
  z.object({ state: z.literal('verificationRequired'), registrationToken: RegistrationToken,
             email: z.string(), resendAvailableInSec: z.number().int().nonnegative() }),
]);
// common.ts: defineErrorCodes([... 'LINK_EXPIRED', 'INVALID_CREDENTIALS'])
```
(`Email`, `RegistrationToken` — из `registration.schema.ts`, `AnySession`, `SessionTransport` — из `session.schema.ts`.)

Миграция `0004`: `sessions.previous_refresh_token_hash text NULL`, `rotated_at timestamptz NULL`,
`revoked_reason text NULL CHECK (revoked_reason IN ('signed_out','reuse_detected','superseded'))`,
`CREATE UNIQUE INDEX sessions_previous_refresh_token_hash_unique ON sessions (previous_refresh_token_hash) WHERE
previous_refresh_token_hash IS NOT NULL`.

Ключи Redis: `signin-ip:<HMAC ip>`, `signin-email-ip:<HMAC email|ip>`, `signin-email:<HMAC email>` (секрет — как у
`rateLimitKeyForIp`; e-mail — нормализованный).

### TESTS
- **contracts:** `SignInRequest` валиден/невалиден (пустой пароль → `REQUIRED`, 129 символов → `TOO_LONG`, e-mail с
  пробелами, лишний ключ, транспорт вне enum); `SignInResponse` оба варианта, `CookieSession` без refresh;
  `ErrorCode` — новый код последним.
- **api-client:** `signIn` → `POST /v1/auth/session/sign-in`, транспорт подмешан, `credentials` в `fetch`.
- **API unit:** `PasswordHasher.verify` (верный/неверный/битый хеш); `SessionController.signIn` — мусор в теле →
  400 до сервиса; ключи лимитов без сырых e-mail/IP.
- **API int (PostgreSQL `onbike_test` + Redis db 1, фиксированный CLOCK):** AC1–AC6 по пунктам; одинаковые тела 401
  (точное сравнение); spy: argon2 не вызывается при 429 и вызывается для неизвестного адреса; лимиты по e-mail через
  разные IP (`X-Forwarded-For` при `TRUST_PROXY=1`, как `trust-proxy.int.test.ts`); окно: CLOCK +59 с → 200, +61 с →
  401 + `revoked_reason`; гонка 5 refresh → 2×200; выход предыдущим; web-вход с cookie → прежняя сессия
  `superseded`; Q5 — `expires_at` сдвигается и упирается в предел; лог reuse без токена (spy логгера); миграция на
  чистой БД.
- **App native (jest-expo):** форма входа (ошибки полей, баннеры 401/429/сеть, `loading`); успех → стор `signedIn` +
  SecureStore, гард → вкладки; `verificationRequired` → `/check-email`; e-mail из черновика; `revalidateSession`:
  200 → новый токен сохранён, 401 → выход и `/sign-in`, сеть → остаёмся + одна немедленная повторная попытка, 429/5xx
  → остаёмся; мьютекс: выход во время ротации ждёт её; выход офлайн — локально чисто; `SignInRequired` — оба
  варианта текста по `expiresAt`.
- **App web (`*.web.test.ts`):** вход — под `onbike.session-refresh`, ответ — `CookieSession.parse` (refresh в
  памяти нет), `revalidateSession` — no-op; выход — прежний.
- **E2E:** §9.8; `pageerror`/`console.error` пусто, кроме согласованного 401 refresh анонима (F5b §8.2).
- **Ручной смоук (человек, NOT VERIFIED если не делался):** Android/iOS — вход, выход, перезапуск офлайн; Safari по https.

### OUT OF SCOPE
§4. Плюс: изменения app-foundation (follow-ups: лимитер `peek/reset` — R2(б); identity в базу — F6); очистка
`sessions`; авторизованные эндпоинты.

# 12. Outcome

Реализовано по слайсам S1–S4 (ветка `feature/onboarding-02-sign-in`, решения — §8.2).

- **S1 contracts/api-client:** `sign-in.schema.ts` (`SignInPassword`, `SignInRequest` — strict, `SignInResponse`
  `signedIn | verificationRequired`), `INVALID_CREDENTIALS` последним кодом, текст API; `api.signIn` с транспортом
  платформы и `credentials`.
- **S2 API (`identity`):** миграция `0004_session_rotation` (expand-only: 3 nullable-колонки, CHECK, частичный
  уникальный индекс); `SignInService` (3 лимита `RateLimiter` до argon2, пустышка — при старте модуля, Q4 —
  `RegistrationService.reissueToken`); `SessionController.signIn` (отзыв прежней cookie — `superseded`, сбой
  отзыва вход не отменяет); ротация с окном 60 с, reuse detection (лог `{ sid, reason }`), скользящий срок 30/180
  дней; выход по текущему или предыдущему refresh (`signed_out`); `PasswordHasher.verify`/`dummyHash`.
- **S3 app:** экран `/sign-in` (SSR, `generateMetadata`, `DocumentTitle`, автозаполнение, баннеры 401/429 с
  отсчётом/сеть, `loading`); `useSignIn` под замком сессии; native `session-lock.ts` (цепочка промисов),
  `revalidateSession` (native — ротация по телу, web — no-op), выход `useSignOut` (сервер + хранилище +
  `queryClient.clear()` + регистрация); гард → «Вход» после выхода/отзыва; `SignInRequired` по локальному сроку
  (R7), `VerifiedElsewhere` → вход с e-mail; e-mail между экранами — черновик в памяти; «Выйти» на «Главной».
- **S4:** смоук — SSR `/sign-in`; с API — регистрация → подтверждение → перезагрузка → выход → неверный пароль
  (баннер) → вход → перезагрузка, `document.cookie` без refresh. Документы: ADR-0005 (+ реестр), ADR-0002 «Пересмотр
  (слайс 2)», ADR-0003 п. 4, `docs/architecture/README.md`, `onbike-security.md`, `onbike-app.md`, runbook (снятие
  блокировки входа в dev, шаги смоука), follow-up F5b отмечен.

Security checklist §8.3 — тестами:
1. AuthN/AuthZ — `sign-in.int.test.ts` (сессия только подтверждённому; неподтверждённому — токен регистрации; web
   cookie с атрибутами), `session.int.test.ts` (окно, reuse, выход предыдущим, параллельные refresh).
2. Входные данные — `sign-in.schema.test.ts`, int «тело не по контракту → 400 до проверки пароля», unit контроллера
   (pipe, мусор в cookie — без отзыва).
3. Данные наружу — int: побайтно одинаковые 401 (неверный/неизвестный/удалённый), web-ответ без refresh,
   `Cache-Control: no-store`; смоук: тело входа без refresh.
4. Злоупотребления — int: 6-я попытка → 429 и с верным паролем, без вызова argon2 (spy), одинаковый 429 для
   несуществующего адреса, лимит e-mail через разные IP (`X-Forwarded-For`, `TRUST_PROXY=1`), лимит IP, после окна —
   вход; verify по пустышке для неизвестного адреса (spy).
5. Секреты и логи — `tokens.test.ts` и int «в Redis только HMAC-ключи»; int «лог reuse без токена/хеша/e-mail»
   (spy `Logger.warn`); app: `console.warn` выхода — только имя ошибки.
6. Аудит — int: `revoked_reason` = `signed_out` / `reuse_detected` / `superseded`.

Проверки (2026-10-24):
- `pnpm check` — EXIT 0 (api 134 теста, вкл. int на `on_bike_test` + Redis db 1; app 164; contracts 41;
  api-client 22).
- `pnpm --filter @on-bike/api db:migrate` — dev-БД `on_bike` и `on_bike_test`: «migrations applied successfully»,
  `\d sessions` — колонки, CHECK, индекс на месте.
- `EXPO_PUBLIC_API_URL=http://127.0.0.1:3000 pnpm build:web` — EXIT 0.
- `pnpm e2e:web` без API — 8 passed, 1 skipped; с `E2E_API=1` (API/worker из `apps/api/dist`, порт 3000 был
  свободен; env API — переменными процесса с тестовыми секретами, Redis db 3) — 9 passed.
- `expo export -p android` — бандл собран (Hermes, 4.1 МБ).

NOT VERIFIED: ручной смоук на Android/iOS (вход, выход, перезапуск офлайн) и Safari по https — не выполнялся.

Ревью pass 1 (`findings.md`): 6 замечаний исправлены — лимиты входа по очереди до первого отказа, IPv6 в
IP-лимитах — по /64, запись сессии native под замком входа/poll, признак незавершённого выхода на web, синхронизация
e-mail регистрации при возврате, сессия в памяти native без refresh.

Follow-ups: `@rkarakulov/api-client-core` — обрыв при чтении тела 2xx классифицировать как `ApiNetworkError`
(сейчас `response.json().catch(() => undefined)` → ошибка разбора схемы; on-bike обходит это в native-ротации:
повтор при любой ошибке без HTTP-статуса); примитив лимитера «N неудачных» (`peek/reset`) в app-foundation (R2б); нормализация IPv6 до /64 для
IP-лимитов — в базу (`rateLimitAddress` сейчас в identity on-bike; шаблонные IP-лимиты базы должны делать то же); отзыв всех сессий пользователя —
со сбросом пароля (слайс 3; сделано — `docs/tasks/2026-10-25-onboarding-03-password-reset/task.md`, ADR-0006); журнал входов — по необходимости (Q9); очистка истёкших/отозванных `sessions`;
признак «на устройстве уже входили» между запусками (§8.2) — продуктовое решение.
