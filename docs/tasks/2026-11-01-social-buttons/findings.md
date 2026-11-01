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