# Findings — app-web-csp — pass 1 — reviewer: claude (independent-reviewer)

base: origin/develop   commits: working tree
verdict: APPROVE (CRITICAL 0 / HIGH 0 / MEDIUM 2 / LOW 3)

Codex — `findings-codex.md` (APPROVE, MEDIUM 1).

| # | Уровень | Находка | Решение |
|---|---|---|---|
| C1 | MEDIUM | zod 4 проверяет JIT через `new Function` в try/catch — нарушение `script-src` (eval) на каждой странице | исправлено: `z.config({ jitless: true })` в web (`features/web-security/zod-jitless.web.ts`, первый импорт `theme/design-system.ts`), тест, ADR-0025 п. 6 |
| C2 | MEDIUM | смоук не ловит нарушения без `console.error` (eval); runbook утверждал обратное | исправлено: тест «строгий CSP … без нарушений» — `securitypolicyviolation` на 7 ключевых страницах (фикстура базы не меняется — шаблонная); runbook поправлен |
| C3 | LOW | CSP `connect-src` из runtime env, бандл — из build-arg: разойдутся — API заблокирован | инвариант в `deploy.md` и `pokatim-security.md` |
| C4 | LOW | `pokatim-web.md` не обновлён | строка про CSP приложения рядом с CSP панели |
| C5 | LOW | нет прогона e2e на новой политике | прогон `pnpm e2e:web` на текущем коде — в pr.md; с API — CI |
| X1 | MEDIUM (codex) | нет сторожа CSP/nonce на реальном SSR-ответе | исправлено: e2e «строгий CSP: nonce свой у ответа, все inline-скрипты SSR — с ним» (входящий nonce игнорируется) |
