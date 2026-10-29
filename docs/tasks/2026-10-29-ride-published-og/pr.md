## Шит «Райд опубликован» после создания кофе-райда; OG-картинка райда — сверка

Задача: `docs/tasks/2026-10-29-ride-published-og/task.md` (task2). Follow-ups из `docs/tasks/2026-10-28-ride-invite-card/pr.md`.

### Что сделано

- **Шит «Райд опубликован»** (прототип «Кофе-райды», кадр (d)) вместо баннера на детали после `?published=1`:
  - заголовок, «Пригласите друзей — карточкой для сторис или ссылкой.»;
  - «Карточка-приглашение» (primary) → `rides/invite/[id]`;
  - «Ссылка» (secondary) → системное меню `shareLink`: отправлено — шит закрывается, меню закрыли — остаётся,
    web без Web Share — «Ссылка скопирована» в шите, ошибка — баннер; нет web-origin — кнопки нет, текст про карточку;
  - «Закрыть», касание затемнения, «Назад» Android / Esc web.
  - Только организатору (`viewer.role` сервера) будущего райда и только после монтирования (не на SSR).
  - Любое закрытие снимает `published` (`router.setParams`): «Назад» с карточки и перезагрузка шит не открывают.
- **`components/modal-sheet.tsx`** — модальный шит `Modal` RN (iOS, Android, web): затемнение `overlay.scrim`,
  `sheetSurface`, заголовок-heading, dialog с именем, `accessibilityViewIsModal`, reduce motion — без анимации.
- **OG-картинка райда** — уже в develop с #115 (ADR-0018): `kind: 'ride'`, «Классика», версионированный URL,
  пререндер `og.sync`, без организатора и описания, линия — только маршрута в каталоге; кода в этом PR нет, ревью
  подтвердило по коду. `docs/product/rides.md` — обе строки «сделано».
- i18n: `rides.published.*`, удалён `rides.detail.published`. Правила `pokatim-app.md` (Кофе-райды).

### Деплой

API, контракты, env, миграции, очереди — без изменений.

### Проверки

- `TURBO_CONCURRENCY=1 pnpm check` — зелёный (Mongo/Redis изолированы: `pokatim_rideog_test`, redis db 2).
- app: `ride-detail.test.tsx` (шит: показ, действия, закрытие, снятие параметра, не организатору / гостю /
  отменённому / прошедшему / без параметра), `modal-sheet.test.tsx`.
- e2e `web.spec.ts`: шаг шита после «Опубликовать» — NOT VERIFIED локально (нужны API и web-сервер).
- Ревью: Claude independent — APPROVE (5 LOW: L4, L5 исправлены); Codex — APPROVE без находок.
- NOT VERIFIED: ручная проверка на симуляторах iOS/Android.

### Follow-ups

- Общий модальный шит для `ModalSheet` и `InstallModal` (почти одинаковые).
- `aria-label` у внешнего `role="dialog"` RN-web `Modal` (оба окна).
- Фото организатора на 4a (`media`).

🤖 Generated with [Claude Code](https://claude.com/claude-code)
