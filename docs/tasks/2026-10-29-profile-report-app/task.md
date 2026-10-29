# 1. Title

Жалоба на публичный профиль райдера в приложении: «Пожаловаться» на `/riders/[id]` и экран `riders/report/[id]`
(follow-up profile-moderation, уровень task2).

# 2. Goal

API жалоб на профиль уже в `develop` (PR #98): `GET /v1/riders/:publicId/me` → `{ canReport, reported }`,
`POST /v1/riders/:publicId/reports` `{ reason, comment? }`. В приложении нет входа в жалобу — модерация фото, клуба и
имени (S1–S7 `docs/tasks/2026-10-28-profile-moderation/task.md`) недоступна райдерам. Сделать кнопку и экран по образцу
жалобы на маршрут (routes-06) и райд (05b).

**Human gate:** пропущен — автономный режим; решения ниже помечены `[ASSUMPTION]`.

# 3. Scope

- `features/riders/queries.ts`: `useRiderViewer(id, enabled)` (ключ `['riders','viewer',id]`, `withAccessToken`,
  `DEFAULT_STALE_MS`), `useReportRider(id)` (ответ → `setQueryData` ключа зрителя).
- `features/riders/rider-screen.tsx`: блок `RiderReportAction` в конце тела найденного профиля:
  - вошедший — `AsyncContent` по `me`: `reported` → «Вы пожаловались на этот профиль»; `canReport` → «Пожаловаться»
    → `/riders/report/<id>`; иначе (свой профиль) — ничего;
  - гость (`status === 'signedOut'`) — «Пожаловаться» → `rememberReturnPath('/riders/<id>')` + `/sign-in`; после
    входа — возврат на профиль, действие не выполняется автоматически (как «Я иду», Q13);
  - сессия неизвестна (SSR, `unknown`/`unavailable`) — ничего (без рассинхрона гидрации).
- Экран `app/riders/report/[id].tsx` + `features/riders/rider-report.tsx` внутри `Stack.Protected` (`_layout.tsx`,
  `__tests__/app-routes.ts`, сторож манифеста SSR): причина — `Chip` из `PROFILE_REPORT_REASONS` (подписи
  `domain.profileReportReason.*`), комментарий ≤ 500 — однострочный `TextField`, «Отправить»; успех — баннер «Жалоба
  отправлена» и «К профилю»; `reported` — «Вы пожаловались…»; `!canReport` — «На этот профиль нельзя пожаловаться».
  Без имени, клуба и фото на экране и в заголовке документа (D-B2: только «Пожаловаться на профиль»).
- Ошибки — `features/riders/error-messages.ts`: сеть; `409 PROFILE_INVALID_STATE own_profile` — «На свой профиль
  пожаловаться нельзя»; 429 — «Слишком много жалоб за сутки…»; 404 — «Профиль недоступен»; прочее — общий текст.
- Возврат после входа: allowlist `return-path-allowlist.ts` — `/riders/<RiderPublicId>` (43 символа base64url).
- i18n `riders.report.*`; `docs/product/profile.md`, `.claude/rules/pokatim-app.md` — строка про жалобу; e2e-смоук:
  гость видит «Пожаловаться» на `/riders/<id>`.

# 4. Out of scope

Изменения API и контрактов; жалоба из таблиц результатов (решение Q3 profile-moderation); многострочное поле.

# 5. Acceptance criteria

- AC1 вошедший на чужом профиле видит «Пожаловаться» (по `canReport`), уже жаловался — строку «Вы пожаловались…»; на
  своём — ничего; ошибка `me` — `AsyncContent` с повтором, профиль остаётся.
- AC2 гость видит «Пожаловаться» → «Вход»; после входа — возврат на `/riders/<id>`.
- AC3 экран жалобы: причина обязательна, комментарий ≤ 500 (ошибка под полем), тело `{ reason, comment|null }`;
  успех — «Жалоба отправлена», «К профилю» ведёт на профиль; кнопка на профиле сменяется на «Вы пожаловались…» без
  перезапроса (кеш зрителя).
- AC4 отказы 409 own_profile / 429 / 404 / сеть — баннер с понятным текстом.
- AC5 невалидный id и 404 `me` — «Профиль недоступен» без формы; гость по прямой ссылке на экран — гард на вход.
- AC6 SSR `/riders/<id>` не рендерит действие жалобы (сессия неизвестна); манифест — `/riders/report/<id>` →
  `riders/report/[id]`.

# 6. Test matrix

| AC | Тест |
|---|---|
| AC1, AC2, AC6 | `__tests__/rider-profile.test.tsx` |
| AC3–AC5 | `__tests__/rider-report.test.tsx` |
| AC2 allowlist | `features/auth/return-path.test.ts` |
| AC6 манифест | `src/app-routes-manifest.server.test.ts` |
| смоук | `e2e/web.spec.ts` (гость видит «Пожаловаться» → вход) |

# 7. Риски

- Публичный id 43 символа — не `Uuid`: allowlist проверяет `RiderPublicId`, open redirect исключён регуляркой пути.

# 8. Решения

- [ASSUMPTION] Кнопка — в конце профиля (после «Гонок»), `TextAction`, как у маршрута: жалоба — редкое действие.
- [ASSUMPTION] Гостю кнопка видна (поручение автора), ведёт на вход с возвратом к профилю, не к экрану жалобы
  (экраны за входом в allowlist не входят, кроме удаления аккаунта).
