# Findings — app-04-calendar

## Pass 1 (PR #31, origin/develop..94b400f)

Codex — APPROVE (2 MEDIUM); Claude independent-reviewer — APPROVE (1 MEDIUM, 1 LOW). Исправлено в 6a495b0 (TDD).

| # | Источник | Уровень | Находка | Исправление |
|---|---|---|---|---|
| M1 | Codex | MEDIUM | Догрузка у конца списка отменяла идущий refetch — смешанная выдача | `loadMore` не догружает при `isFetching`, `fetchNextPage({ cancelRefetch: false })`; то же во вкладке «Гонки» и на экране сезона; тесты |
| M2 | Codex | MEDIUM | Ячейки `StatBlock` сжимались вместо переноса | Ячейка по содержимому (`flexBasis: 'auto'`, `minWidth: size.rowMin`), перенос «км»; тест пяти дистанций |
| M3 | Claude | MEDIUM | Диапазон через месяц/год рвался в рамке даты строки | В рамке — начало, полный диапазон — в мете и метке скринридера (`listRowDate`); тесты через месяц и год |
| L1 | Claude | LOW | «Регистрация у организатора» на героях без проверки ссылки | Общая `isRegistrationUrl` для героя и карточки; тест |
