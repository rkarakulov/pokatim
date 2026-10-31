## Достижения: уровни и прогресс к следующей цели (follow-up 1/3)

Task: `docs/tasks/2026-10-30-achievements-levels/task.md` (решения L1–L7, RC-L1…RC-L10).

### Что
- **Уровни** «Бронза / Серебро / Золото» у трёх счётных кодов (коды прежние): `races_5` «Гонщик» 5/15/30,
  `routes_5` «Путешественник» 5/15/30, `rides_10` «Завсегдатай» 10/25/50. Пороги — одна таблица
  `ACHIEVEMENT_LEVEL_TARGETS` в `@pokatim/contracts`.
- **Сверка:** `level` — поле проекции (смена — `refresh`), `seenLevel` монотонен; повышение → вспышка «Новый
  уровень», понижение и возврат — молча. `POST seen` — одна операция update pipeline. Документы v1 — без миграции
  (нет полей ≡ 1).
- **Прогресс:** `GET /v1/achievements` → `progress[]` (следующий уровень, счёт, порог); в профиле — блок «Следующие
  цели» с полосами (`components/progress-bar.tsx`, на него переведён `upload-progress`), скелетон первой загрузки.
- **Публично и карточка:** уровень у `races_5` в публичном профиле; карточка сторис — порог на значке и «Достижение ·
  Серебро», уровень в хэше, `renderVersion` 3.
- Совместимость: ответ только расширяется (`level` `.nullable().default(null)`, `progress` `.default([])`), запрос
  `seen` прежний.
- Документы: `docs/product/profile.md`, ADR-0020 «Уровни», `.claude/rules/pokatim-*`.

### Проверки
- `pnpm check` (Mongo 27117 / Redis db 11): format, lint, arch, typecheck, все пакеты зелёные; в `@pokatim/api`
  флаки под нагрузкой (`parse-thread`, `results-revisions`) — отдельно 97/97 вместе с achievements и карточкой.
- Ревью: Claude independent-reviewer — APPROVE (3 LOW, закрыты); Codex pass 1 — HIGH (скелетон блока) → исправлен,
  pass 2 — APPROVE.

### Принятые следствия
- После выкладки у райдеров с 15+ фактами — одна вспышка «Новый уровень» (RC-L2); старая сборка покажет повышение
  как «Новое достижение» (RC-L6).
- Follow-up: `ProgressBar` в `@rkarakulov/ui`.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
