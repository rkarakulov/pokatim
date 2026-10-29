# Claude independent review, pass 1

# Findings — profile-moderation — pass 1 — reviewer: claude
base: origin/develop   commits: f218203..b134f4f (6 коммитов, рабочее дерево чистое)
verdict: APPROVE

## Что проверено

- **Корректность и гонки.** Жалоба (`recordReport`, затем вставка), сбросы (`resetAvatar`/`resetClub`/`resetPublicName`),
  «Отклонить» (`findForModeration`, затем `clearReports` по `reportRevision` и `openReportCount > 0`) и `PATCH`
  (`updatePublicName`) первой операцией пишут один документ `profiles`. Поэтому параллельные транзакции ловят write
  conflict и повторяются, а `openReportCount` остаётся равным числу открытых жалоб. Чтение снимка в `dismissReports` до
  записи безопасно: если жалоба закоммичена после начала снимка, `clearReports` получает конфликт, повтор видит новую
  ревизию и отвечает 409. Уникальность открытой жалобы держит частичный уникальный индекс `resolvedAt: {$eq:null}`; дубль
  ловится `isDuplicateKey`, `$inc` откатывается вместе с транзакцией. `uuidv7` жалобы и `randomToken` нового id фото
  выдаются до `transactions.run`, повтор колбэка идемпотентен.
- **Перевыпуск id фото.** Переходы «публичен → нет» с фото проходят только через `PATCH` (отзыв согласия, очистка имени)
  и сброс имени модератором; других писателей `publicName`/`showNameInResults` нет (grep). Сброс фото модератором удаляет
  документ фото. Замена или удаление фото самим райдером конфликтует с перевыпуском по документу профиля. `replaceAvatarId`
  срабатывает только при прежнем id. Есть int-тесты на 404 старого id и те же байты по новому.
- **Утечки.** `findPublic` и `VIEW_PROJECTION` не берут счётчики жалоб. Карточка отдаёт жалобы явным списком, без
  `reporterUserId` и `resolvedBy`. Журнал содержит подпись D3 и `details.reportCount`. Логи — `uid` жалобщика или id
  модератора, без цели, комментария, имени и клуба. Комментарий в панели выводится текстом React (экранируется).
- **Права.** Контроллер — `PanelGuard` + `profiles.moderate` на классе. Маршруты панели — под `RequirePermission`,
  пункт меню — с `permission`.
- **Остальное.** Миграция `0034` — expand-only, идемпотентна, номер свободен относительно `origin/develop`. Стирание
  удаляет жалобы на цель первым шагом, сирот добирает повторный проход (sweep). Документы и правила зон обновлены
  (Documentation Sync в порядке).
- **Запуски.** admin: `features/rider-profiles`, `AppLayout`, `csp`, `design-system` — 44/44 зелёные. api unit:
  `profile-reports.repository`, `profile.policy`, `profile.repository` — 14/14. contracts (profile, common, audit) —
  78/78. `tsc --noEmit` api и admin — без ошибок.
- **NOT VERIFIED.** int-тесты api (`profile-reports`, `rider-profiles-moderation`, `profile`, `profile-admin`,
  `account-erasure`, `migrations`) не прогонялись: локальный mongod — standalone, стенд требует replica set. Опираюсь на
  отчёт coder в §12 (`pnpm check` зелёный) и на чтение кода тестов.

## Findings

### [MEDIUM] Любой сброс закрывает все открытые жалобы профиля, в том числе сброс имени из «Результатов»
- **file:** apps/api/src/modules/profile/profile-moderation.service.ts
- **location:** `reset` (стр. ~203–216, `closeOpen(..., 'actioned', ...)` на стр. 212); вызов `resetName` из `ProfileAdminController`; apps/admin/src/features/results/StandingsTable.tsx:219
- **problem:** `avatar-reset` закрывает жалобы на клуб и имя, `club-reset` — на фото. Сброс имени из таблицы результатов
  (там модератор жалоб не видит, а в тексте последствий `admin.results.dialog.resetNameConsequences` о них ни слова) молча
  закрывает как `actioned` жалобы на фото, и профиль уходит из очереди.
- **why_it_matters:** жалоба на неприемлемое фото пропадает из очереди без решения по фото. Вернуть её может только
  повторная жалоба райдера. Так требует буква §3 п. 5 («Сброс закрывает все открытые жалобы»), но это дыра в процессе
  модерации, а не только UX.
- **evidence:** `const closed = await this.reports.closeOpen(tx, userId, 'actioned', actorUserId, now);` — без учёта
  `kind` и причин жалоб.
- **recommended_fix:** минимум — в диалоге сброса имени в «Результатах» добавить в последствия «открытые жалобы на
  профиль закроются» (или показывать там число открытых жалоб). Лучше — follow-up в §8.2/§12 с решением: закрывать только
  жалобы с причинами, которых касается сброс (`photo` → фото и т. д.), или явно принять текущее поведение в
  `docs/product/profile.md` (S6).

### [LOW] 404 при действии в карточке показывается как «Не удалось сохранить»
- **file:** apps/admin/src/features/rider-profiles/rider-profiles-format.ts
- **location:** `actionErrorText` (стр. 17–20); apps/admin/src/features/rider-profiles/RiderProfileScreen.tsx:183–184
- **problem:** если профиль удалили между открытием карточки и действием (стирание аккаунта), сервер отвечает 404,
  а в окне причины появляется общее `admin.saveFailed`. В образце `rider-routes` 404 ведёт к `ConflictBanner` с
  перечитыванием (RC-10). §11.7 упоминает текст «Профиль не найден» для 404.
- **why_it_matters:** модератор повторяет действие впустую вместо того, чтобы увидеть, что профиля нет.
- **evidence:** `if (!isConflict(error)) throw error;` — 404 уходит в `errorText`, а `actionErrorText` отдаёт
  `t('admin.saveFailed')`.
- **recommended_fix:** на `httpStatus(error) === 404` закрывать диалог и перечитывать карточку: её ветка 404 уже
  показывает «Профиль не найден». Либо обрабатывать 404 как `stale`, по образцу `rider-routes`.

### [LOW] Тест гонки «жалоба ↔ сброс» удерживает не сервисный сброс, а сырые записи в БД
- **file:** apps/api/src/modules/profile/profile-reports.int.test.ts
- **location:** стр. 214–241 (`holdTransaction` на стр. 220)
- **problem:** удерживаемая транзакция имитирует сброс прямыми `updateOne`/`updateMany` и не вызывает
  `ProfileModerationService.resetClub`. Тест доказывает, что жалоба повторяется при конфликте, но не порядок записи в
  самом сервисе сброса. Параллельный тест (стр. 243) вероятностный: может пройти и без конфликта.
- **why_it_matters:** если кто-то переставит `closeOpen` перед записью профиля в `reset`, детерминированный тест этого
  не заметит.
- **recommended_fix:** удерживать транзакцию внутри настоящего сервиса (spy на `ProfileReportsRepository.closeOpen` с
  ожиданием-барьером, как в `ride-reports.int.test.ts`) или добавить unit-сторож порядка вызовов в `reset`.

### [LOW] В очереди нет отдельной колонки «Причина»
- **file:** apps/admin/src/features/rider-profiles/RiderProfilesScreen.tsx
- **location:** стр. 29–42 (`column.accessor('openReportCount', …)`, i18n `admin.riderProfiles.reports` `'{count} · {reason}'`)
- **problem:** §11.7 задаёт отдельные колонки «Жалобы» (число) и «Причина». Здесь они склеены в одну ячейку, а в §8.2
  отклонение не записано: там есть только склейка «В профиле».
- **why_it_matters:** расхождение со спецификацией без записи. Функционально некритично.
- **recommended_fix:** разделить колонки или дописать отклонение в §8.2.

## Вердикт

APPROVE — CRITICAL и HIGH нет. MEDIUM-1 стоит решить (хотя бы текстом последствий или записью решения) до мержа или
явно вынести в follow-up.


## Исправления pass 1 (coder, 2026-10-28)

- **[MEDIUM] Любой сброс закрывает все открытые жалобы — РЕШЕНО (поведение API оставлено).** Сброс закрывает все
  открытые жалобы как `actioned` (§3 п. 5, S6). В «Результатах» текст `admin.results.dialog.resetNameConsequences`
  теперь говорит, что открытые жалобы на профиль закроются, в том числе на фото и клуб; тест — `RaceResultsScreen.test.tsx`
  («модератор: «Сбросить имя» …»). Решение — task.md §8.2 и `docs/product/profile.md` («Риски и ограничения»).
- **[LOW] 404 при действии в карточке — ИСПРАВЛЕНО.** Окно закрывается, карточка перечитывается и показывает «Профиль
  не найден» без действий; тест — `RiderProfileScreen.test.tsx` («404 при действии …»).
- **[LOW] Тест гонки «жалоба ↔ сброс» на сырых записях — ПРИНЯТ без изменений.** Детерминированный тест доказывает
  повтор жалобы при конфликте по документу профиля; порядок записей в `reset` покрыт чтением кода ревью.
- **[LOW] Нет отдельной колонки «Причина» — ПРИНЯТО как отклонение**, записано в task.md §8.2; код не менялся.
