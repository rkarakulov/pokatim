## route-exports-gzip: экспорт маршрута в `route_exports` хранится сжатым gzip

Follow-up RC-7 (b) из `routes-import-export-formats`. Документ экспорта на 20 000 точек: 6,77 МБ → 0,73 МБ (×9,3).

- **Worker**: `exportFilesOf` асинхронно жмёт GPX/KML/TCX (`node:zlib`, уровень 6 явно) **до** транзакции — в разборе и бэкфилле.
- **Хранение**: `route_exports.encoding: 'gzip'` у новых записей; `sizeBytes` — хранимые байты. Старые документы без поля отдаются как есть. `ROUTE_DERIVED_VERSION` не растёт — пережмутся при следующем росте.
- **Отдача** `GET /v1/routes/:id/{gpx,kml,tcx}`: клиент принимает gzip (`acceptsGzip`) → байты как есть + `Content-Encoding: gzip`; иначе `gunzip` с пределом 8 МиБ. `Accept-Encoding` дописывается в `Vary` (CORS `Vary: Origin` сохраняется — `varyWith`).
- Откат образа на релиз до этой задачи запрещён (`pokatim-db.md`).

### Проверки
- unit `acceptsGzip`, `varyWith`, `exportFilesOf` (round-trip, детерминизм, степень сжатия).
- int `routes-public` (gzip/без gzip/`q=0`, старый документ, битый gzip → 500, CORS `Vary`), `routes-derived`, `routes-admin` — зелёные на изолированном стенде.
- Ревью: Claude independent-reviewer pass 1 — APPROVE (MEDIUM/LOW исправлены); Codex pass 1 — APPROVE (MEDIUM `Vary` исправлен), pass 2 — APPROVE.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
