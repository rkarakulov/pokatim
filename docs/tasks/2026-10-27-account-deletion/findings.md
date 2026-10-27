# Findings — account-deletion — pass 1 — reviewer: codex
base: origin/develop   commits: origin/develop..HEAD
verdict: REQUEST CHANGES

### [HIGH] Удаление аккаунта меняет cookie вне общего замка сессии
- **file:** apps/app/src/features/account/queries.ts
- **location:** строки 16–19
- **problem:** Запрос удаления выполняется без `withSessionLock`, хотя его ответ очищает cookie refresh. После ответа вызывается обычный `signOut`, который дополнительно отзывает текущую cookie через API.
- **why_it_matters:** Вкладка A начинает удаление аккаунта A; вкладка B одновременно входит в аккаунт B. Запоздалый ответ удаления стирает новую cookie B. Если вход B завершится между ответом удаления и последующим `clearSession`, последний отправит `sign-out` уже с cookie B и отзовёт чужую сессию.
- **evidence:** `AccountController.delete` вызывает `SessionCookie.clear(reply)`. `requestSignIn` в `features/auth/queries.ts` сериализует вход через `withSessionLock`, но `api.deleteAccount` этот замок обходит. `session-store.signOut` вызывает `clearSession`; web-реализация отправляет `api.signOut()` с текущей cookie. `session-lock.web.ts` прямо требует общего замка для всех операций, меняющих cookie.
- **recommended_fix:** Сериализовать удаление и завершение локального выхода с остальными сессионными операциями. После подтверждённого удаления использовать локальное завершение сессии без дополнительного серверного `sign-out`. Учесть, что refresh внутри `withAccessToken` сам берёт замок: простая внешняя обёртка создаст вложенный захват. Добавить тест гонки удаления с входом другой вкладки.

### [LOW] Документ профиля сохраняет отменённое решение об имени удалённого
- **file:** docs/product/profile.md
- **location:** строки 16–18, P4
- **problem:** После ссылки на новые решения осталось утверждение: «„Удалённый участник“ появится вместе с модулем удаления аккаунта».
- **why_it_matters:** Документ противоречит A3 и фактическому поведению, создавая неоднозначное требование для следующих изменений таблиц результатов.
- **evidence:** `docs/product/account.md`, A3: подписи «Удалённый участник» в таблицах результатов нет; используется «Участник».
- **recommended_fix:** Удалить устаревшее предложение из P4.

NOT VERIFIED: тесты и `pnpm check` в этом проходе не запускались; заявленные автором результаты независимо не подтверждены.
# Findings — account-deletion — pass 1 — reviewer: claude (independent-reviewer)
base: origin/develop   commits: fd19893..07bd451
verdict: APPROVE (CRITICAL 0 / HIGH 0 / MEDIUM 1 / LOW 5)

### [MEDIUM] Ошибка SMTP с e-mail удаляемого остаётся в Redis (failedReason/stacktrace задачи BullMQ)
- **file:** apps/api/src/modules/identity/account-erasure.ts — `sendDeletionEmail`, catch → `throw error`
- **problem:** текст ошибки nodemailer содержит адрес получателя; `removeOnFail: false` хранит его бессрочно. Противоречит A4 и §8.3 (без e-mail в логах).
- **recommended_fix:** бросать очищенную ошибку (`user=<uid> code=<code>`), тест: FakeMailer с адресом в сообщении → в ошибке задачи адреса нет.

### [LOW] Комментарий `emailClaimMs` не соответствует ретраям (account.policy.ts:16–17)
### [LOW] `pendingSweeps` сортировка по `deletedAt` + limit 50 — «голодание» при массовом застревании (identity.repository.ts) → runbook §3 или ротация
### [LOW] `.claude/rules/pokatim-security.md` — «этап 2 app» про сделанный allowlist
### [LOW] a11y: `accessibilityRole="list"` без `listitem` (delete-account-form.tsx:114–120)
### [LOW] Экран на `AuthScreen` вместо оболочки настроек (§5.1) — отклонение не записано в §8.2
