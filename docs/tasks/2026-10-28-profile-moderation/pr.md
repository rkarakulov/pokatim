## Модерация профиля райдера: жалобы, очередь в панели, сброс фото и клуба, перевыпуск id фото

Спецификация — `docs/tasks/2026-10-28-profile-moderation/task.md`. Закрывает R-2 и RC-A2 (b) профиля райдера
(`docs/tasks/2026-10-28-rider-profile/task.md`): клуб и фото — UGC, до прода нужна модерация.

### Что сделано
- **Жалоба на профиль (API):**
  - `POST /v1/riders/:publicId/reports` — причины `photo | club | name | impersonation | spam | other`, комментарий
    до 500 символов;
  - `GET /v1/riders/:publicId/me` — `{ canReport, reported }`;
  - профиль только публичный (иначе 404), на свой — 409 `PROFILE_INVALID_STATE own_profile`;
  - одна открытая жалоба от пользователя (частичный уникальный индекс), после решения модератора можно снова;
    лимит 20 в сутки.
- **Панель — раздел «Профили райдеров»** (`profiles.moderate`: admin и moderator):
  - очередь открытых жалоб;
  - карточка: фото, клуб, статус публичности, жалобы без автора, имя — по Q2;
  - действия «Сбросить фото», «Сбросить клуб», «Сбросить имя», «Отклонить жалобы» с причиной в журнале
    (`profile.avatar_reset`, `profile.club_reset`, `profile.reports_dismissed`, `details.reportCount`);
  - сброс закрывает открытые жалобы; устаревшая карточка при «Отклонить» — 409 `CONFLICT`.
- **Перевыпуск id фото** при переходе профиля «публичен → нет» (отзыв согласия, очистка имени, сброс имени
  модератором): копия под новым `randomToken`, старый URL → 404.
- **Удаление аккаунта** стирает жалобы на пользователя; поданные им жалобы остаются (псевдонимный id).

### Миграция
- `0034_profile_reports`: коллекция `profile_reports`, индексы `profile_reports_open_unique`,
  `profile_reports_target_idx`, `profiles_report_queue_idx` (частичный). Только добавление, без бэкфилла, повторный
  прогон безопасен.

### Документы
`docs/product/profile.md` (S1–S8, R-2 и RC-A2 закрыты), `admin-panel.md`, `account.md`, ADR-0019 (перевыпуск id),
ADR-0015, `docs/runbooks/account-deletion.md`, `.claude/rules/pokatim-{backend,db,security,contracts,web}.md`.

### Ревью
- Claude independent review pass 1 — APPROVE (MEDIUM-1, LOW-2 исправлены; LOW-3 принят; LOW-4 — отклонение в §8.2).
- Codex pass 1 — REQUEST CHANGES (HIGH: ошибки перечитывания карточки) → исправлено; pass 2 — APPROVE.

### Проверки
- `TURBO_CONCURRENCY=1 pnpm check` — зелёный (изолированные Mongo и Redis).

### Follow-up
- Кнопка «Пожаловаться» и экран жалобы в приложении (`apps/app`, публичный профиль `/riders/[id]`).
- Уведомление райдеру о сбросе; шаблонные причины сброса (D11).
