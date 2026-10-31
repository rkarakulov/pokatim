# Достижения: ручная выдача и отзыв в панели — PR A (API)

Задача — `docs/tasks/2026-10-31-achievements-panel/task.md` (M1–M8, RC-1…RC-14 приняты по рекомендации). PR A —
контракты, API, api-client, правила и документы; экраны панели — PR B.

## Что сделано

- **Контракты:** право `achievements.manage` (только admin), действия журнала `achievement.granted_manually` /
  `achievement.revoked_manually` / `achievement.override_cleared` и детали `achievementCode`, `objectKind`, `objectId`,
  `achievementLevel`, код `ACHIEVEMENT_INVALID_STATE` (409) — в конце списков; `ACHIEVEMENT_OBJECT_KIND_BY_CODE`;
  схемы панели `achievement-admin.schema.ts`. Ответы приложения не меняются.
- **API:** `admin/rider-achievements/:userId` — `GET`, `POST grant|revoke|clear` (`PanelGuard` +
  `achievements.manage`, лимит 60/ч на сотрудника). Ручное решение — поле `override` на документах обеих коллекций
  выдач; сверка (GET и серверная) его не трогает — план пропускает, каждая запись сверки с условием `override: null`.
  Транзакция действия: запись выдачи первой (замок) → outbox `achievements.grant-noticed` (`origin: 'server'`) →
  журнал. Снятие решения — немедленная сверка по фактам (при маркере первой сверки).
- **Порты владельцев:** `RIDER_RIDES.ridesOf`, `RIDER_ROUTE_RIDES.routeTitles`, `endsBefore` у `pending`-исхода
  `RIDER_SEASON_STANDINGS`; объекты и названия ручных выдач — `AchievementObjects`.
- **Ответы райдера (M7):** ручная выдача неотличима (список, вспышка, уведомление, карточка); публичный список и
  карточка учитывают ручные решения (RC-1); прогресс не противоречит ручному уровню (RC-9).
- **api-client:** `getRiderAchievements`, `grantRiderAchievement`, `revokeRiderAchievement`,
  `clearRiderAchievementOverride`.
- **Документы:** ADR-0020 «Дополнение: ручные решения», `admin-panel.md`, `profile.md`, `notifications.md`,
  `.claude/rules/pokatim-{backend,db,security,contracts}.md`.

## Миграции и env

Миграций нет (новое поле документа без индексов, старые документы без поля ≡ `null`). Env не меняется.

## Новое право и журнал

- `achievements.manage` — admin получает автоматически (`PERMISSIONS` целиком), moderator и organizer — нет.
- Журнал: subject `rider` (`Участник ·<id>`), причина обязательна, details без имён и названий.

## Проверки

- `pnpm check` (format, lint, arch, typecheck, test) — зелёный (временные mongod 27117 / redis 6479).
- Гонки (M8): `achievements-panel-locks.int.test.ts` — ворота (revoke / refresh / restore / вставка, сезонные,
  параллельные ×6) и отрицательные доказательства (запись сверки прежним фильтром без `override` перезаписывает ручное
  решение); без условия `override: null` в репозитории 5 из 9 тестов краснеют по результату.
- Сторож `admin-routes.test.ts` покрывает новый контроллер.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
