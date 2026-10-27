# Findings: fix-admin-smoke

## Проход 1 — claude (independent-reviewer), APPROVE

- MEDIUM — `results-actions.ts`: действия над результатами инвалидировали только ключ гонки; список гонок (фаза) и
  журнал при `staleTime` 30 с оставались устаревшими. **Исправлено:** + `['admin','races','list']`, `['admin','audit']`,
  тест `isInvalidated` в публикации.
- MEDIUM — `GrantRoleDialog.tsx`: выдача роли не инвалидировала журнал. **Исправлено**, тест в `MembersScreen.test.tsx`.
- LOW — стиль `index.css` оставался в документе после упавшего CSS-теста. **Исправлено:** `mountPanelCss()` снимает
  стиль через `onTestFinished`.
- LOW — нестабильный тест входа (429, fake timers) под нагрузкой — вне scope, файл не менялся.

## Проход 2 — claude (independent-reviewer), APPROVE

Замечания прохода 1 закрыты. LOW — строка JSDoc длиннее 120 в `results-actions.ts` — перенесена.

## После ревью — CI `web` (`pnpm e2e:admin`, AC15)

`staleTime` 30 с отдавал журнал из кэша при заходе на экран: 401 погасшей сессии не приходил, «Сессия истекла» не
показывалась. **Исправлено:** `staleTime` по умолчанию снова 0, двойной GET убран через `refetchOnWindowFocus: false`.
