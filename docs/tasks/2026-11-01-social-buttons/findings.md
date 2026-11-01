# Findings — social-buttons — pass 1 — reviewer: codex
base: origin/develop   commits: origin/develop..2927fa3d
verdict: REQUEST CHANGES

### [HIGH] Обновление зависимостей без обязательного Security checklist
- **file:** docs/tasks/2026-11-01-social-buttons/task.md
- **location:** документ целиком; pnpm-workspace.yaml:53–60
- **problem:** Обновлены восемь пакетов `@rkarakulov/*` с 0.7.1 до 0.8.0, включая серверную инфраструктуру и контракты, но в задаче отсутствует Security checklist.
- **why_it_matters:** `.claude/rules/security.md` прямо требует checklist при изменении зависимостей и предписывает `REQUEST CHANGES` при его отсутствии. Обновление выходит за пределы UI-пакета, необходимого для `reserveLabels`.
- **evidence:** В правилах: «Затронута зона ниже → в task.md обязателен Security checklist; reviewer без него ставит REQUEST CHANGES». Среди зон указаны «зависимости и реестр пакетов». В `task.md` есть только проблема, решение и приёмка.
- **recommended_fix:** Добавить checklist по шести пунктам правила с обоснованными `не применимо`, описать состав и совместимость обновления пакетов. Изменение конфигурации также отразить в `pr.md` согласно AGENTS.md §6.

Других подтверждённых дефектов в изменённом коде и проверенных местах вызова не обнаружено.

NOT VERIFIED: целевые тесты не выполнились — Jest завершился с `EPERM` при записи haste-map в read-only окружении, в том числе с `--watchman=false --no-cache`. `pnpm check`, браузерная проверка и скриншоты до/после не подтверждены; проверка на устройствах iOS/Android не выполнялась.

---

# Findings — social-buttons — pass 2 — reviewer: codex
base: origin/develop   commits: origin/develop..6ad98339
verdict: APPROVE

Подтверждённых находок нет.

Замечание HIGH из pass 1 закрыто: в task.md добавлены Security checklist и описание обновления зависимостей; изменение конфигурации отражено в pr.md.

Проверены места вызова `ConnectButton` и `RiderSocialBlock`, обработка мутаций и ошибок, i18n, токены, документация и реализация `Button` установленного UI-пакета 0.8.0. Карточка результата имени райдера в кнопку не передаёт. API, миграции, очереди и аудит diff не меняет.

Проверки:
- `git diff --check origin/develop...HEAD` — PASS.
- `pnpm --filter @pokatim/app typecheck` — PASS.
- `pnpm check`: форматирование и lint прошли; выполнение остановлено ревьюером на этапе `arch:check`. Полный gate — **NOT VERIFIED**.
- Целевые Jest-тесты — **NOT VERIFIED**: запуск завершился с `EPERM` при записи haste-map в read-only окружении.
- Скриншоты web, работа на iOS/Android и заявленная идентичность кода остальных пакетов базы между 0.7.1 и 0.8.0 — **NOT VERIFIED**: независимо в этом проходе не проверялись.
---

# Findings — social-buttons — pass 1 — reviewer: claude (independent-reviewer)
base: origin/develop   commits: 2927fa3d
verdict: APPROVE

- [LOW] Состояние «Убрать из своих» на карточке результата не покрыто тестом — исправлено: тест в `rival-card.test.tsx`
  (подпись без имени, A12).
- [LOW] Комментарий `useRiderSocial` называл кнопку статусом «В своих» — исправлено.
- [LOW] В task.md не было Placement & Reuse и §10 Documentation Impact — добавлены.
