# Маршруты 05: панель — страница маршрута с картой, профилем высоты и скраббингом

## Что

Пользователь: «в админке при просмотре маршрута — как в приложении: профиль высоты с данными и таскание точки, карта и
профиль связаны; сейчас нет самой карты — только тонкая линия». Решения A1–A4 (`task.md` §2.1; A1 — пользователь:
страница + превью; A2 — один палец/мышь, колесо с Ctrl/⌘), architect RC-1…RC-13, отклонения D1–D9.

- **Пакет `@pokatim/route-view`** (новый, без React/RN/i18n): слои маршрута, камера, проекция линии и скраббинг,
  сторы, опции интерактивной карты и фильтр колеса, профиль (пути, тики, значения скраббинга), темп. Приложение
  импортирует из пакета (поведение без изменений), панель — тоже.
- **API:** `PanelRoute.elevation` (`{ minM, maxM, profile } | null`, `default(null)`), `RoutesRepository.panelGeometry` —
  одна проекция `{ line, profile }` вместо полного документа; общий `elevationOf`. Права и видимость без изменений.
- **Панель:** страница `/routes/:routeId` — интерактивная карта MapLibre GL (async-чанк, воркер через `?url`), линия 5 px,
  кнопки +/−/«в рамку», цифры, профиль SVG со скраббингом (hover/drag ↔ маркер, slider ←/→/Home/End), состояния
  (скелетон, 404/403, ошибка с повтором, опрос `processing` ≤ 5 мин на окно, `failed`); список — название-ссылка;
  окно публикации и поле коридора — компактная карта + «Открыть маршрут» (из поля коридора — новая вкладка). Без env
  стиля — прежний `LinePreview`.
- **Infra:** CSP панели — `connect-src` тайлов OpenFreeMap, `worker-src 'self' blob:`, `img-src blob:`; `.mjs` воркера —
  `application/javascript`; `VITE_MAP_STYLE_LIGHT` — build arg (Dockerfile, deploy-dev.yml, turbo env).
- **e2e панели:** страница маршрута со стилем-заглушкой (`page.route`) — карта, кнопки, slider, без ошибок CSP.
- docs: ADR-0014, AGENTS.md §2, правила web/app/contracts, runbook local-dev, продукт routes/admin-panel.

## Важно

- Деплой dev: `VITE_MAP_STYLE_LIGHT` передаётся в сборку панели из `deploy-dev.yml`.
- Смена провайдера тайлов = env + CSP (`csp.test.ts` сторожит).

## Проверки

- `TURBO_CONCURRENCY=1 pnpm check` — зелёный; `pnpm e2e:admin` локально 2/2 (со стилем и без).
- Ревью pass 1 — APPROVE (MEDIUM 2, LOW 1) → исправлены (`findings.md`).

## NOT VERIFIED

- Content-Type `.mjs` и тайлы под nginx стенда — проверка на dev после выката.
- Ctrl/⌘-колесо, тачпад, длинный маршрут — вручную на dev.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
