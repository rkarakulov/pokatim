# profile-moderation-d11 — причина сброса из списка и уведомление жалобщику (task2)

## 1. Title

Шаблонные причины сброса имени, фото и клуба (D11) и уведомление авторам жалоб о решении по жалобе на профиль.

## 2. Goal

Причина сброса модератором — код из справочника причин жалоб на профиль; свободный текст — только у «Другое».
Свободного текста с именем или клубом в append-only журнале становится меньше. Автор закрытой жалобы узнаёт о
решении.

## 3. Scope

- Контракт: `ResetRiderNameRequest` / `RiderProfileResetRequest` — `{ reason: ProfileReportReason, comment? }`,
  `comment` (`ActionReason`) обязателен только у `other`, у прочих — 400. `UnblockRiderAvatarRequest` и
  `DismissRiderProfileReportsRequest` — по-прежнему свободная причина.
- Журнал: `details.resetReason` (код, в конец деталей), `reason` — текст «Другое», иначе `null`.
- Событие `profile.reports-resolved` (`targetUserId`, `resolution`, `reporterUserIds`) в транзакции сброса и
  «Отклонить жалобы»; обработчик в `notifications` → kind `profile_report_resolved` (группа «Райды», без цели).
- Панель: окно сброса с выбором причины (радио), «Другое» — поле текста и предупреждение D11; «Журнал» — причина по
  коду. Окно «Сбросить имя» в «Результатах» — то же окно.

## 4. Out of Scope

- Шаблонные причины «Отклонить жалобы» и «Снять запрет» (свободный текст остаётся).
- Премодерация фото; переход из уведомления на профиль.

## 8.1 Риски

- Старые записи журнала — без `resetReason` (показываются как раньше: текст причины).
- Payload события несёт id авторов жалоб — только id (псевдонимы), без имени и причины; число авторов ограничено
  открытыми жалобами профиля (одна открытая на автора, S2).
- Строгий контракт: старая панель с текстом в `reason` получит 400 — панель деплоится вместе с API.

## 8.2 Решения по ходу

- `comment` у не-«Другое» — ошибка 400 (`INVALID`), не игнор: панель — единственный клиент, молча терять текст нельзя.
- Цель уведомления — `null` (без перехода): у `profile` нет порта для `notifications`, а после сброса имени профиль
  не публичен — переход вёл бы на «Не найдено» (как у скрытого райда в `ride_report_resolved`).

## 8.3 Security checklist

1. AuthN/AuthZ: эндпоинты те же, `profiles.moderate`.
2. Входные данные: строгая схема, код из справочника, текст — `ActionReason`.
3. Данные наружу: уведомление без имени профиля, причины и деталей сброса; автору — только о его жалобе.
4. Злоупотребления: получатели — только авторы жалоб, закрытых этим действием; живость — `liveUserIds`.
5. Секреты и логи: в лог — только флаги, без причин.
6. Аудит: код причины в журнале, текст — только «Другое».

## 9. Acceptance

1. Contracts: код без текста — ок; «Другое» без текста — ошибка; текст у не-«Другое» — ошибка.
2. API int: сброс с кодом → журнал `resetReason` без текста; «Другое» → с текстом; outbox `profile.reports-resolved`;
   обработчик — только авторы закрытых жалоб, живые, без дублей; отклонение → текст `dismissed`; T3-уведомление
   райдеру не меняется.
3. Панель (RTL): выбор причины, «Другое» требует текст, предупреждение — только при «Другое»; «Журнал» — причина по коду.

## 10. Documentation Impact

`docs/product/profile.md` (решения D11-1, D11-2, «Где в продукте», риски, Follow-up), `docs/product/notifications.md`,
`.claude/rules/pokatim-contracts.md`, `.claude/rules/pokatim-backend.md`, `.claude/rules/pokatim-web.md`.

## 12. Outcome

- Контракт: `ResetRiderNameRequest` = `RiderProfileResetRequest` — `{ reason: ProfileReportReason, comment? }`
  (`superRefine`: `other` без текста — `REQUIRED`, текст у кода — `INVALID`); `UnblockRiderAvatarRequest` — своя
  схема `{ reason: ActionReason }`; `AuditEntry.details.resetReason`; kind `profile_report_resolved` — в конец.
- API: `ProfileModerationService` — код в `details.resetReason`, текст «Другое» в `reason`; `closeReports` читает
  авторов открытых жалоб в транзакции до `closeOpen` и пишет `profile.reports-resolved`; `NotificationIntake` —
  черновик без цели и схлопывания. Вызовы в int-тестах и `api-client` переведены на коды.
- Панель: `features/rider-profiles/ResetReasonDialog.tsx` (карточка профиля и «Сбросить имя» в «Результатах»),
  «Журнал» — «причина — <подпись>». Приложение не менялось: тексты — снимок сервера, kind — `tolerantEnum`.
- Проверки: contracts, api unit (1121), api int (profile, panel, notifications-intake, results-names, riders —
  384), admin (542), i18n, api-client; typecheck api/admin/app/contracts/api-client/i18n; eslint изменённых;
  `format:check`; `arch:check`. NOT VERIFIED: полный `pnpm check`, приложение (jest) и ручная проверка в браузере.
