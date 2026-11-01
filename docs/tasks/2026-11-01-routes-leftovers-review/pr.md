# Ревью после merge #198, #193, #200: «Мой маршрут», клавиатура Android, уборщик сирот, документы

Задача — `docs/tasks/2026-11-01-routes-leftovers-review/task.md`.

## Что сделано

- «Мой маршрут»: черновик названия и открытое подтверждение удаления — у экрана, переживают опрос «Обрабатывается →
  готов»; заморожено (A3) — подпись вместо формы; готовый без длины — «Мои заезды» в раскладке без карты.
- `KeyboardAvoidingArea`: iOS и Android — `behavior="padding"` (Android edge-to-edge не ужимает окно под клавиатуру),
  `keyboardVerticalOffset = -insets.bottom` — без зазора над клавиатурой; web — `.web.tsx` (`View`). Один нативный
  файл вместо `.android.tsx`: поведение платформ одинаковое; тесты обеих платформ на событиях клавиатуры.
- Тест «область поднимается над клавиатурой» эмулирует `keyboardWillShow`; тавтологичный тест routes-04c удалён.
- Неиспользуемые ключи `routes.detail.{length,elevation,elevationValue,loop,yes,no}` удалены.
- Уборщик сирот: курсор в Redis после каждой полной пачки (сбой посреди прогона продолжается с неё); int-тесты —
  сбой посреди прогона, скрытый модератором маршрут, основная удалена при живом дубле.
- Документы: `routes.md` (M4 по routes-07; удаление опубликованного маршрута райдера убирает заезды всех райдеров
  уборщиком в течение суток), `pokatim-db.md` и `route-rides-07-delete/task.md` §8 (принятый риск: ручной заезд,
  удалённый до первого `saveAutoPlan`, может вернуться автозаездом), `pokatim-app.md`.

## Проверки

- format, lint, arch, typecheck; тесты app (2861), i18n, api `route-rides` (unit + int, 114).
- Ревью: Codex недоступен (spend cap) — самопроверка автора (`codex-findings.md`, не кросс-движковое).

## Не проверено

- Клавиатура над шторкой на iOS и Android (edge-to-edge) на устройствах.
- Follow-up: `auth-screen.tsx` — тот же `KeyboardAvoidingView` без поведения на Android.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
