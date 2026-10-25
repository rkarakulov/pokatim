# CLAUDE.md

Канон проекта — [`AGENTS.md`](AGENTS.md). Прочитай его первым; здесь только навигация для Claude Code.

Процесс разработки — плагин `app-dev-kit` (маркетплейс `app-foundation`, подключён в `.claude/settings.json`
вместе с `superpowers`). Компоненты вызываются с префиксом плагина:

| Что | Вызов |
|---|---|
| Оркестратор задачи | `/app-dev-kit:develop-task <задача \| путь к task.md>` |
| Уровни | `/app-dev-kit:task1` … `/app-dev-kit:task3` |
| Фазы | `/app-dev-kit:{understand-project,create-spec,plan-task,implement-task,verify-task,review-task,codex-review,finish-task}` |
| Аудит архитектуры | `/app-dev-kit:architecture-review` |
| Агенты | `subagent_type: "app-dev-kit:{architect,coder,independent-reviewer,investigator}"` |
| Скилы зон | `app-dev-kit:{backend-nest,mobile-expo,web-ui}` |

В проекте: `.claude/rules/*.md` — правила по путям (`paths:` frontmatter), `tools/ai_review/` — контракт ревью и
Codex-мосты. `.ai/dev-kit/` — копия плагина для Codex; Claude Code её не читает.

pokatim: доменные правила поверх правил шаблона — `.claude/rules/pokatim-*.md` (те же `paths:`), продуктовые
решения — `docs/product/`, ADR — `docs/adr/`.

## Уровень задачи → superpowers

| Уровень | Скилы |
|---|---|
| fast path (багфикс) | `systematic-debugging` → `test-driven-development` → `verification-before-completion` |
| task1 | `verification-before-completion` |
| task2 | `brainstorming` (если размыто) → `test-driven-development` → `verification-before-completion` |
| task3 | `brainstorming` (обязательно) → `writing-plans` → `subagent-driven-development` / `test-driven-development` → `receiving-code-review` → `verification-before-completion` → `finishing-a-development-branch` |

Документацию библиотек (NestJS, Expo, драйвер MongoDB, BullMQ, TanStack Query, MapLibre …) сверяй через context7, а не по памяти.
