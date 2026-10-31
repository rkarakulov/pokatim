## «Свои», P6 — приглашения (K9)

Task: `docs/tasks/2026-10-31-social-p6-invites/task.md` · эпик `docs/tasks/2026-10-31-social-stage-0/task.md`

- Личный код райдера: `GET /v1/social/invite-code` (лениво, 7 символов без похожих букв).
- Ссылки «Поделиться» (райд, маршрут, билет) у вошедшего несут `?invite=<code>`; «Позвать друзей» в своём профиле.
- На всех карточках для сторис — короткий адрес `<домен>/i/<code>`; web-маршрут `/i/:code` сохраняет код и ведёт на главную.
- Клиент хранит последний код 7 дней (web `localStorage`, native secure storage) и передаёт `RegisterRequest.invite`.
- Первое подтверждение e-mail (ссылка или сброс пароля) → outbox `identity.account-confirmed` → `social-intake` →
  связь `invite` в обе стороны + `invite-registered`. Неизвестный код, удалённые аккаунты, неподтверждённый — без связи.
- Уведомление пригласившему — точка привязки для P7 (P1 ещё не в develop).
- ADR-0027 пп. 1, 5, `social.md` K9, `profile.md`, правила обновлены.

### Проверки
- `pnpm check` (TURBO_CONCURRENCY=4, своя изоляция): всё зелёное, кроме 5 int-тестов `account-erasure`/`achievements`,
  упавших по таймауту под нагрузкой; отдельный прогон этих файлов — 58/58.
- int `sharing,identity,social,account` + `outbox-routes` — 565/565.
- Independent review: pass 1 REQUEST CHANGES (Security checklist) → pass 2 APPROVE.
- e2e `web.spec.ts` (`/i/<код>`) — на CI.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
