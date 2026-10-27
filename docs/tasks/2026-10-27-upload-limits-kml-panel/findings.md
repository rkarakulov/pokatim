# Findings — upload-limits-kml-panel — pass 1 — reviewer: codex
base: origin/develop   commits: origin/develop..HEAD
verdict: REQUEST CHANGES

### [HIGH] Отсутствует обязательный Security checklist
- **file:** docs/tasks/2026-10-27-upload-limits-kml-panel/task.md
- **location:** между §5 и §8.2, строки 62–64
- **problem:** Задача меняет приём пользовательских файлов и защиту от злоупотреблений, но не содержит обязательного Security checklist.
- **why_it_matters:** Не выполнен явный гейт ревью для загрузки файлов; `.claude/rules/security.md` требует `REQUEST CHANGES` при отсутствии этого раздела.
- **evidence:** `.claude/rules/security.md:18–21`: «в task.md обязателен Security checklist; reviewer без него ставит REQUEST CHANGES»; среди зон указана «загрузка файлов». В task.md после Implementation Context сразу следует Deviations from spec.
- **recommended_fix:** Добавить checklist по шести пунктам `.claude/rules/security.md`: серверные проверки доступа, валидация файлов, данные наружу, защита от злоупотреблений, секреты и логи, аудит. Для каждого указать существующий механизм и влияние изменения либо обосновать неприменимость.

Других подтверждённых дефектов в рассмотренном diff и проверенных местах вызова не обнаружено.

**NOT VERIFIED:** unit-тесты `raw-body.test.ts` и `upload-slots.test.ts` не запустились: Vite получил `EPERM` при создании временного файла конфигурации в read-only окружении. `pnpm check` независимо не подтверждён.
## Pass 2 — Codex: APPROVE

Подтверждённых дефектов не обнаружено.

Находка HIGH предыдущего прохода закрыта: в task.md добавлен §8.3 Security checklist со всеми шестью пунктами.

Проверены ограничения слотов, освобождение в `finally`, таймауты и очистка обработчиков, все три вызова `readLimited`, отправка KML сырым телом и обработка ошибок приложением райдера. Изменения не затрагивают серверный авторитет, аудит, миграции и идемпотентность очередей; нарушений границ модулей, совместимости контрактов, дизайн-системы и платформенных требований не выявлено.

**NOT VERIFIED:** команда `pnpm --filter @pokatim/api test src/raw-body.test.ts src/upload-slots.test.ts` завершилась до запуска тестов: Vite получил `EPERM` при создании временной конфигурации в read-only окружении. Интеграционные и admin-тесты, а также `pnpm check` независимо не подтверждены.
