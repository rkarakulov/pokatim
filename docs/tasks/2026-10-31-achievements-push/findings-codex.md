# Findings — achievements-push — pass 1 — reviewer: codex
base: origin/develop   commits: origin/develop..HEAD
verdict: APPROVE

### [MEDIUM] Сезонное уведомление не проверяет актуальность достижения
- **file:** apps/api/src/modules/achievements/achievement-notices.ts
- **location:** 30–39, `AchievementNoticesService.notice`
- **problem:** Сезонная ветка проверяет только отсутствие отзыва выдачи и наличие завершённого сезона. Если после создания события протокол и снимок сезона пересчитаны, а следующей сверки достижений ещё не было, уведомление создаётся даже о потерянном чемпионстве или подиуме.
- **why_it_matters:** Райдер получает «Новое достижение: Чемпион сезона», хотя актуальный рейтинг уже не даёт этого достижения; при переходе на экран GET отзовёт выдачу.
- **evidence:** `seasonTitles` читает только `SEASON_RACES.finishedSeasons`, без строк и актуальности снимка. `revokedAt` обновляет сверка достижений, а не пересчёт standings. Сценарий изменения места подтверждён существующим тестом `achievements.int.test.ts`, «AC3: пересчёт снимка сместил место». Раздел 5.B задачи требует `state`, если код больше не заработан.
- **recommended_fix:** Перед созданием сезонного уведомления проверить достижение по актуальному `final`-исходу через существующие `outcomesOf` и `seasonalAchievements`; определить обработку `pending`. Добавить тест: выдача с событием → пересчёт с потерей места → intake без промежуточного GET.

### [LOW] Тест старой сборки использует новую схему цели
- **file:** packages/contracts/src/notifications/notification.schema.test.ts
- **location:** 162–181
- **problem:** Имитация старой сборки заменяет только `group` и `kind`. Поле `target` остаётся из текущего `NotificationView` и уже распознаёт `achievement`.
- **why_it_matters:** Тест не подтверждает заявленную совместимость новой цели со старым клиентом и отсутствие перехода.
- **evidence:** `NotificationView.extend` переопределяет только два поля; проверки `parsed.target` нет.
- **recommended_fix:** Использовать схему целей до изменения с прежним fallback и проверить `parsed.target === { type: 'unknown' }` при сохранении серверного текста.

Проверки: `git diff --check`, форматирование, ESLint и `arch:check` прошли. **NOT VERIFIED:** полный `pnpm check` остановился на typecheck — Turbo не смог записать логи/кэш в окружении read-only (`Operation not permitted`); тесты этим запуском не выполнялись. Серверная сверка и AC3/AC5 исключены из оценки как согласованный scope N2.