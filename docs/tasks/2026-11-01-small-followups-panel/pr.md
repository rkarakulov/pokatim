## Что

Follow-up панели (task: `docs/tasks/2026-11-01-small-followups-panel/task.md`):

1. **Имя райдера в спорах и истории пересчётов** — по правилу Q2 (`docs/product/profile.md`): `Анна К. ·{id}` только
   при имени и согласии (порт `RIDER_NAMES`, один вызов на ответ), иначе `Участник ·{id}`. Список споров — цель,
   разбор — цель и заявитель, история пересчётов — участник записи. Новое ребро `disputes → profile`
   (`ProfileCoreModule`); имя только в ответе — не в спорах, журнале, outbox и логах. Контракты панели — обязательные
   `nullable`.
2. **e2e 2FA панели** — `apps/admin/e2e/totp.spec.ts`: вход → «Безопасность» → подключение → код TOTP считает тест
   (RFC 6238, `node:crypto`) → выход → вход паролем и кодом. В смоуке — фиктивный `PANEL_TOTP_KEY`,
   `PANEL_TOTP_ENFORCED` не включён (прочие сценарии без изменений).

## Проверки

- Ревью: Claude pass 1 — APPROVE (MEDIUM + 3 LOW исправлены), Codex pass 1 — APPROVE (тот же MEDIUM); pass 2 —
  Claude (fallback: Codex недоступен) — APPROVE, LOW по докам исправлен.
- int API 54/54, unit API 89/89, админка 529/529, typecheck/eslint/format/arch — зелёные. Полный `pnpm check` — в CI.
- NOT VERIFIED: локальный e2e со стандартными таймаутами (машина под нагрузкой; с увеличенным `expect.timeout` все 5
  сценариев зелёные) — проверяет job `web` в CI.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
