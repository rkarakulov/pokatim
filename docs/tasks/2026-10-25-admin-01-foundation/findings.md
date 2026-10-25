# Findings — admin-01-foundation

## Pass 1 (PR #22, 8b33d36..382f5fd)

Codex — REQUEST CHANGES; Claude independent-reviewer — APPROVE (5 LOW); CI check — красный. Исправлено в eec3b52.

| # | Источник | Уровень | Находка | Исправление |
|---|---|---|---|---|
| C0 | CI | — | Тест «E-mail не подтверждён» нестабилен: срок и «сейчас» — два разных Date.now() | useNow().sync() возвращает тот же момент; тест с замороженными часами; реальный fetch в тестах admin запрещён (src/test/setup.ts); 10 прогонов подряд — зелёные |
| C1 | Codex | HIGH | Выход при сети/5xx уходил на «Вход», сессия оставалась | Только onSuccess; иначе баннер «Не удалось выйти» и «Повторить выход» |
| C2 | Codex | HIGH | DataTable: fetchStatus 'paused' без данных — вечный скелетон | TableQuery.fetchStatus → «Нет соединения» с повтором; «Журнал», «Обзор»; «кто я» — networkMode 'always' |
| C3 | Codex | HIGH | «Обзор» скрывал ошибку обновления | Значение + «Данные могли устареть» с повтором; тесты App.test.tsx перенесены |
| L1 | Claude | LOW | Выход при сбое → «Вход» | = C1 |
| L2 | Claude | LOW | Глубокий импорт @nestjs/core/helpers/cookies | requestCookie: request.cookies или разбор заголовка Cookie (Fastify без @fastify/cookie объект не заполняет) |
| L3 | Claude | LOW | ADMIN_HOST в infra/.env.example | Убран |
| L4 | Claude | LOW | Выход погашенной сессией писал panel.signed_out | PanelSessionCheck: отзыв с причиной гарда без записи журнала |
| L5 | Claude | LOW | Литерал 500 в UI | PANEL_MEMBER_LIST_CAP в контрактах |

D2 (eslint-disable в DataTable.tsx) — оставлен по решению оркестратора.

## Pass 2 (PR #22, eec3b52..d0da586)

Codex — APPROVE с одним MEDIUM.

| # | Источник | Уровень | Находка | Исправление |
|---|---|---|---|---|
| M1 | Codex | MEDIUM | `signIn`: отзыв прежней сессии (`superseded`) — после транзакции, ошибка глушилась `.catch` | Отзыв — в той же транзакции, что новая сессия и `panel.signed_in`, без подавления: сбой отзыва — вход не успешен, новой сессии и записи нет, прежняя жива (int-тест) |
