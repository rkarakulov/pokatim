# Findings — panel-invitations — pass 2 — reviewer: claude
base: origin/develop   commits: 001153f6..ea2edf38 (новое с pass 1: c206160f, ea2edf38; working tree clean)
verdict: APPROVE

Проверено и запущено (БД `pokatim_rev_test`, Redis db 9): `panel-invitations-locks.int.test.ts`,
`panel-invitations.int.test.ts`, `panel-email.int.test.ts`, `panel-invitation-token.test.ts` — 45/45 зелёные;
admin `features/{members,invite}` — 27/27 зелёные. Полный `pnpm check` сам не запускал (NOT VERIFIED; task.md §12 —
второй прогон зелёный, `exit=0`).

## Закрытие находок pass 1

| Находка | Статус | Чем закрыта |
|---|---|---|
| claude HIGH / codex HIGH — «Отозвать» без состояния мутации, ложный текст на 404 | закрыта | `InvitationsSection.tsx`: окно до `onSuccess`, `busy={revoke.isPending}`, «Отмена» и Esc заблокированы в pending, `disabled={busy}` на обеих кнопках строк (общий флаг `resend`/`revoke`), 404 — `admin.invitations.error.NOT_FOUND` в окне; RTL-тест с незавершённым запросом (повторный клик — один вызов, кнопки строки disabled, 404 — свой текст) |
| claude MEDIUM — глобальный `NOT_FOUND` | закрыта | `admin.members.error.NOT_FOUND` возвращён к тексту `origin/develop`; `grantNotFound` только для `mode === 'grant'` в `GrantRoleDialog`; тест на смену роли |
| claude MEDIUM / codex HIGH — ротация `EMAIL_TOKEN_SECRET` | закрыта | `invitationTokenMatches` (`timingSafeEqual`, проверка длины) в `accept` после снимка, до argon2 → 410; worker — `skipped` + `emailState: 'failed'`; повторная отправка создаёт новый id → хеш от текущего секрета (§8.2 п. 11 верен); unit + int-тест A→B. ADR-0026 п. 2 теперь соответствует коду |
| claude LOW — ворота не доказывают запись-замок `lockPending` | закрыта | ворота внутри транзакции после `lockPending`: позитивный тест различает (при условном чтении `untilBlocked` проходит по завершению отзыва, но ожидание `404` падает на `204`); отрицательный — условное чтение без `$inc` → отзыв 204 посреди принятия, принятие 410. Обоснование — §8.2 п. 10 |
| claude LOW — `markAccepted` без `matchedCount` | закрыта | возвращает `matchedCount === 1`, вызывающий бросает 410 внутри транзакции (откат активации) |
| claude LOW — RC-3, смена пароля | закрыта | тест «пароль сменён между проверкой и принятием — 401, роли нет» |
| claude LOW — срок в тексте, «Войти» в баннере | закрыта (см. LOW ниже) | `{days}` из `PANEL_INVITATION_TTL_DAYS`; кнопка «Войти» в баннере `PANEL_ALREADY_MEMBER` + тест |
| claude LOW / codex MEDIUM — нет `pr.md` | закрыта | `pr.md`: миграция 0041, `PANEL_LINK_BASE`, очередь `panel-email`, ротация, follow-up правил `.claude/rules/*` |

Новый код c206160f по измерениям — без замечаний: корректность и откат (`invitationInvalid` внутри
`runWithInsertRetry` — не транзиентная ошибка, транзакция откатывается), безопасность (сравнение хешей за постоянное
время, в логе `panel.invitation_email_stale_secret` только id), серверный авторитет, append-only журнал (при откате
записи нет), идемпотентность задачи письма (повтор после `failed` снова `skipped`, состояние не меняется для не-`pending`),
состояния данных и §4.12 в UI, i18n (все строки в `ru.ts`), Documentation Sync (ADR-0026, `pr.md`, task.md §8.2/§12).

### [LOW] Срок ссылки подставлен без формы множественного числа
- **file:** packages/i18n/src/ru.ts
- **location:** `admin.members.inviteLead` (стр. ~2988); вызов — `apps/admin/src/features/members/GrantRoleDialog.tsx:90`
- **problem:** «Ссылка действует {days} дней» — фиксированная форма «дней» при том, что срок теперь параметр. В `ru.ts`
  есть механизм `one/few/many` (`calendar.daysLeft`).
- **why_it_matters:** сейчас `PANEL_INVITATION_TTL_DAYS = 7` — текст верен; при смене константы на 1–4, 21–24 и т. п.
  получится «1 дней» / «3 дней». Параметризация ровно ради того, чтобы менять константу.
- **evidence:** `'Письмо со ссылкой уйдёт на этот адрес. Ссылка действует {days} дней. …'`.
- **recommended_fix:** вынести срок в плюральный ключ (`{count}` с `one/few/many`) или оставить как есть с
  комментарием у константы. Не блокер.

## Verdict
APPROVE — CRITICAL/HIGH нет; все находки pass 1 (Claude и Codex) закрыты кодом и тестами; новая находка — одна LOW.
