# Findings — cards-invites-followups — pass 1 — reviewer: independent-reviewer (Claude)
base: origin/develop   commits: origin/develop..b6ae0223
verdict: APPROVE

- [MEDIUM-1] A2: `noindex` + `Disallow` противоречили правилу SEO `pokatim-app.md` — **исправлено**: исключение
  «экраны только для вошедших» в правиле и комментарии `seo.ts`.
- [LOW-1] A1: отсчёт ожидания `pending` по шаблону, ключ — шаблон + тема — **исправлено**: `pollKey = template:themeId`,
  тест.
- [LOW-2] B4: удаление прежней 2FA при повторной активации не видно в журнале — **принято** в ADR-0026 (дополнение):
  `details` журнала — строгая схема контракта.
- [LOW-3] B4: CLI `grant-admin` снятому с 2FA без теста — **исправлено**: `panel-cli.int.test.ts`.
- [LOW-4] B5: e2e не закрывал контексты браузера — **исправлено**.

Codex (pass 1, `findings-codex.md`): APPROVE, [MEDIUM] карточка прежней темы до сохранения — **исправлено**:
`invalidateCardStatuses` в `useSetTheme.onSuccess`, тесты.
