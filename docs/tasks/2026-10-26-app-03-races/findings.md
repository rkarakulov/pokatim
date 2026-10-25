# Findings — app-03-races

## Pass 1 (PR #26, origin/develop..c833ed8)

Codex — REQUEST CHANGES (2 HIGH); Claude independent-reviewer — APPROVE (2 MEDIUM, 4 LOW). Исправлено в 849f0f3 (TDD).

| # | Источник | Уровень | Находка | Исправление |
|---|---|---|---|---|
| H1 | Codex, Claude | HIGH | Ошибка фонового обновления «Завершённых» при данных не видна (`race-feed.tsx`) | Баннер «Данные могли устареть» с повтором `past.refetch()`, данные остаются; тест «current ок, past упал» |
| H2 | Codex | HIGH | «Другие сезоны» без загрузки/ошибки — отказ выглядел как «нет сезонов» (`season-detail.tsx`) | `AsyncContent`: скелетон, ошибка с повтором, баннер при ошибке обновления; скрыт только после успешного пустого ответа; 4 теста |
| M1 | Claude | MEDIUM | Без сети при данных три новых экрана молчат | Общий `OfflineBanner` (`useIsOnline`) на вкладке, карточке, сезоне и Главной; тесты на каждый экран |
| M2 | Claude | MEDIUM | SSR ставил `noindex` на временный сбой API; 404 вытесняли успешные ответы из кэша | `fetchPublicForSsr` → `found`/`notFound`/`unavailable`; `noindex` только для `notFound`; отдельный пул 404 (100); тесты |
| L1 | Claude | LOW | «Все гонки» на «не найдено» вели гостя на регистрацию | `signedIn ? '/races' : '/'`; тесты |
| L2 | Claude | LOW | Выбранный месяц оставался после выхода из набора чипов | Пересечение с `monthChips(now)` по часам Минска; тест через полночь |
| L3 | Claude | LOW | Литерал ` · ` | `meta([dates, phase])` |
