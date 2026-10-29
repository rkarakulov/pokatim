# Findings — landing-seo — pass 1 — reviewer: claude (independent-reviewer)
base: origin/develop   commits: 2672895f
verdict: APPROVE

- **[MEDIUM] `Disallow: /v1/` прятал от Googlebot клиентские данные индексируемых страниц** (`apps/app/src/lib/seo.ts`):
  Googlebot при рендере соблюдает robots и для fetch; таблица и гонки сезона грузятся на клиенте из `/v1/seasons/...`.
  **Исправлено:** `/v1/` не закрывается (JSON API не индексируется), `Allow: /v1/og/images/` больше не нужен; тест
  проверяет, что `/v1/...` открыт; правило в `.claude/rules/pokatim-app.md` и `docs/product/landing.md`.
- **[LOW] Формулировка «noindex-страницу не закрывай» противоречила `Disallow: /tickets/`.** **Исправлено:** «кроме
  ссылок с токеном» — в шапке `seo.ts` и правиле.
- **[LOW] При > 10 000 объектов вида выпадают свежие** (скан по `updatedAt` по возрастанию). **Принято:** известное
  ограничение в §8 task.md, вместе с follow-up sitemap index.
- **[LOW] Documentation Sync §11/§12 task.md.** **Исправлено.**

Codex pass 1 (`findings-codex.md`): APPROVE, находок нет.
