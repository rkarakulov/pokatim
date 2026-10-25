# Findings — tracks-devices

## Pass 1 (PR #28, origin/develop..a6f0ffc)

Codex — REQUEST CHANGES (5 HIGH); Claude independent-reviewer — REQUEST CHANGES (1 HIGH, 5 MEDIUM, 2 LOW).
Исправлено в d090e63, 2951642, c2fb0b1, d62dce7.

| # | Источник | Уровень | Находка | Исправление |
|---|---|---|---|---|
| H1 | Codex, Claude | HIGH | Финальный сбой разбора оставлял загрузку в `processing`, приложение опрашивало бесконечно | Исходник пропал → `failed: storage`; сбой потока на последней попытке → `failed: unreadable`; int-тесты |
| H2 | Codex | HIGH | Уборка `pending` отзывала подключение, подтверждённое между чтением и отзывом | Атомарный переход `pending → disconnecting` по `version` и `pendingUntil`, отзыв через outbox; тест конкурентной уборки |
| H3 | Codex | HIGH | Отключение с удалением не сериализовано с идущим pull | Общий Redis-замок pull/revoke + проверка эпохи подключения перед приёмом; тест с задержанным `/timeseries` |
| H4 | Codex | HIGH | Удалённая загрузка воскресала после падения worker | Маркер источника `track_source_refs` (миграция 0012) в транзакциях удаления и приёма; тест «упал → удалил → pull» |
| H5 | Codex | HIGH | Шаг онбординга «Устройства» без сети — вечный скелетон | `AsyncContent`: «Нет соединения» с повтором, «Позже» доступна; тест офлайна |
| M1 | Claude | MEDIUM | 16 МиБ+ — обрыв соединения вместо 413 | Тело сливается (`resume()`), 413 `TRACK_TOO_LARGE` + `Connection: close`; тест на реальном сокете |
| M2 | Claude | MEDIUM | Враждебный GPX нагружал память worker | Подсчёт `<trkpt`/тегов до разбора, `maxYoungGenerationSizeMb`, worker 512m |
| M3 | Claude | MEDIUM | `pending` скрывал повторное подключение ~40 мин | «Подключить снова» на экране и в шаге; тесты |
| M4 | Claude | MEDIUM | Уборка удаляла исходники `duplicate` | Чистятся только `failed`/`skipped`; тест |
| M5 | Claude | MEDIUM | Лицензия `@garmin/fitsdk` | Решение автора: оставить (только сервер, риск принят) — ADR-0011, §8.2 |
| L1 | Claude | LOW | Старый кэш онбординга без шага устройств | Разовое перечитывание с сервера — §8.2 |
| L2 | Claude | LOW | Expo Go и `exp://` | Runbook: подключение — только в dev build |
