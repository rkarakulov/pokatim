Свои OG-картинки сезона и профиля райдера, тёмный шаблон OG

## Что

- OG 1200×630 для `/seasons/<id>` (название, даты, «N гонок») и `/riders/<publicId>` («Профиль райдера», гонки, подиумы, лучшее место — **без имени, клуба и фото**, D-B2).
- Тёмная схема шаблона («Ночь»): гонка, сезон, райдер — тёмные; райд, маршрут, старт, бренд — светлые. Таблица `OG_CARD_POLICY.scheme`, схема в хэше, `renderVersion` 3 (полный проход `og.sync`).
- Виды `season`, `rider` в `OG_CARD_KINDS`; id по виду (`rider` — `RiderPublicId`).
- `og.sync`: живые сезоны (≤ 30 сут. после конца) — каждый прогон без курсора (число гонок не меняет `seasons.updatedAt`); райдеры — только самолечение при первом запросе.
- Порты: `races` (`seasonOgFacts`, `liveSeasonIds`), новый `RIDERS_FOR_SHARING` (`RidersCoreModule`, та же `summarize`, что у страницы).
- Логи OG без `publicId` (префикс хэша).

Задача: `docs/tasks/2026-10-30-og-rider-season-dark/task.md`. Миграций нет.

## Проверки

- lint, arch:check, typecheck — зелёные. Полный `pnpm check` под нагрузкой — таймауты в посторонних int-файлах (disputes, results-disputes, rides-participation, routes-derived, panel-races); отдельно — 48/48.
- Ревью: Claude independent-reviewer — APPROVE (MEDIUM: правила), Codex — APPROVE.
- Превью PNG 19–50 КБ.

## Follow-up (нужен OK пользователя)

- `.claude/rules/pokatim-backend.md:146` («`riders` не импортирует никто, кроме `AppModule`») — теперь `sharing` импортирует `RidersCoreModule`; виды season/rider, таблица `scheme`, курсоры у 4 видов.
- `.claude/rules/pokatim-security.md` — «логи OG без `publicId`».

## Риски

- Первый запрос картинки райдера после публикации протокола — бренд (рендер в очереди).

🤖 Generated with [Claude Code](https://claude.com/claude-code)
