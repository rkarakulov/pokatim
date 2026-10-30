## Общее модальное окно `ModalSheet`; имя у dialog RN-web `Modal`

Уровень task1: follow-ups `docs/tasks/2026-10-29-ride-published-og/pr.md`.

### Что сделано

- `components/modal-sheet.tsx` — общее модальное окно: `placement` (`sheet` — шторка, `dialog` — по центру),
  `headerAction` (действие сверху справа), `titleInContent` (заголовок рисует содержимое). Анимация: `slide` / `fade`,
  reduce motion и `null` до ответа — без анимации.
- `InstallModal` (окно установки PWA) — обёртка над `ModalSheet` с «×»; дублирующая разметка удалена.
- A11y web: `aria-label` — на самом `Modal` (RN-web делает его `role="dialog"` + `aria-modal`); у панели больше нет
  второго вложенного `role="dialog"`. Native — `accessibilityViewIsModal` у панели, как было.
- Правило `pokatim-app.md` (Кофе-райды): `ModalSheet` — единственное модальное окно.

### Проверки

- `modal-sheet.test.tsx` (native: панель без role, `titleInContent`, `headerAction`, затемнение, `requestClose`),
  новый `modal-sheet.web.test.tsx` (один dialog с именем), `install-banner.web.test.tsx`, `ride-detail.test.tsx`.
- `TURBO_CONCURRENCY=1 pnpm check` — app, admin, lint, typecheck зелёные; 4 файла API упали по таймаутам под
  нагрузкой (код API не менялся), отдельно — 30/30.
- NOT VERIFIED: ручная проверка в браузере и на симуляторах iOS/Android.

### Follow-ups

- Фото организатора на 4a — ждёт модуля `media` (без изменений).

🤖 Generated with [Claude Code](https://claude.com/claude-code)
