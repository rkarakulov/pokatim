# Findings — profile-moderation-d11 — pass 2 — reviewer: claude
base: ca17ec01 (pass 1)   commits: ca17ec01..81bfb419
verdict: APPROVE

Закрытие находок pass 1:
- [MEDIUM] admin-panel.md — закрыто: строка прав (42) и абзац карточки (152–160) описывают выбор причины, «Другое»
  с текстом и предупреждением, то же окно в «Результатах», уведомление авторам и причину по коду в «Журнале»;
  файл добавлен в §10 task.md.
- [LOW] pokatim-db.md — закрыто: порядок `openReporters` → `closeOpen` → outbox → журнал для сбросов и «Отклонить»,
  инвариант «авторы события = авторы закрытых жалоб» записан.
- [LOW] pokatim-security.md — закрыто: тело `{ reason: ProfileReportReason, comment?: ActionReason }`.
- [LOW] «принял меры» авторам жалоб на другое поле — закрыто как принятое решение в Follow-up `profile.md`.
- [LOW] гонка «жалоба ↔ сброс» — закрыто: тест сверяет `reporterUserIds` события с авторами жалоб `actioned`
  этого профиля (нет события ⇔ закрытых нет); импорты (`eventsOfType`, `profileReportsDb`) на месте.
- [LOW] ResetReasonDialog — закрыто: `ResetReasonDialog.test.tsx` (отмена → повторное открытие без выбора и текста;
  ошибка → `role=alert`, окно открыто, выбор сохранён, повтор — закрытие); `autoFocus` поля у «Другое»
  (`TextAreaField` пробрасывает атрибуты в `<textarea>`).

Новых проблем уровня CRITICAL/HIGH/MEDIUM нет.

### [LOW] autoFocus поля «Другое» уводит фокус из группы радио при навигации стрелками
- **file:** apps/admin/src/features/rider-profiles/ResetReasonDialog.tsx
- **location:** `TextAreaField … autoFocus` (~строка 96)
- **problem:** стрелки в группе радио выбирают вариант; дойдя до «Другое» (последний), пользователь клавиатуры
  получает фокус в поле текста и выходит из группы — чтобы сменить причину, нужен Shift+Tab.
- **why_it_matters:** мелкий a11y-штрих, функционально не ломает (поле нужно именно при «Другое»).
- **evidence:** `RadioGroup` — нативные `input[type=radio]` с `onChange` на выбор; поле монтируется при `other`.
- **recommended_fix:** по желанию — фокусировать поле только при выборе мышью/пробелом (например, `onClick` у радио),
  либо оставить как есть.

NOT VERIFIED: тесты не запускались (по заданию).
