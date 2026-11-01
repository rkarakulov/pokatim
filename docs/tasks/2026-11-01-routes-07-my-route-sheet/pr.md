# routes-07: «Мой маршрут» — карта на весь экран и шторка

Задача — `docs/tasks/2026-11-01-routes-07-my-route-sheet/task.md` (follow-up routes-04d RC-16, «Что не входит»
`docs/product/routes.md`).

## Что сделано

- Карточка `routes/mine/<id>` у готового маршрута — раскладка карточки каталога: карта на всю область под шапкой
  (`RouteLineMap fill bottomInset`) и шторка `BottomSheet` поверх. Шапка шторки — «Дистанция» и «Набор» по раскладке
  темы (`ROUTE_STATS_VARIANT`, `routeDistanceGainItems` — общие с каталогом); тело — «Загружен», «Мои заезды», заявка в
  каталог, «Переименовать», «Удалить».
- Переименование — тело шторки подменяется формой (поле вверху); область — `KeyboardAvoidingArea`
  (`components/keyboard-avoiding-area(.ios).tsx`: iOS — `padding`, Android и web — без поведения, как `auth-screen`);
  карта и шторка — во внутреннем `View flex: 1`, чтобы отступ поднимал `absolute`-шторку; `keyboardShouldPersistTaps`.
- «Обрабатывается», отказ, незнакомый статус — прежняя прокрутка без карты; после готовности — карта и шторка.
- Pull-to-refresh перезапрашивает геометрию только без данных (неизменна; в `fill` ошибка обновления при показанной
  карте не видна).
- Документы: `docs/product/routes.md` (раскладка, строка «Что не входит» снята), `.claude/rules/pokatim-app.md`.

## Проверки

- Jest приложения (`my-routes`, `my-route-publication`, `route-rides-block`, `route-detail`), typecheck, lint.
- Полный `pnpm check` (TURBO_CONCURRENCY=4) — зелёный на HEAD перед push.
- Ревью: Codex pass 1 (HIGH — шторка не поднималась отступом), pass 2 (HIGH — скрытая ошибка обновления геометрии),
  pass 3 — APPROVE. Claude independent-reviewer не запускался (исполнитель — форк без субагентов).

## Не проверено

- Клавиатура над шторкой на iOS / Android (edge-to-edge) и мобильном web, VoiceOver/TalkBack, крупный шрифт — вручную
  на устройствах.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
