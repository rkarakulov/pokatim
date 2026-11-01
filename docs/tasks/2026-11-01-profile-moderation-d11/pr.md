## Что

Follow-up модерации профиля (task: `docs/tasks/2026-11-01-profile-moderation-d11/task.md`, решения D11-1/D11-2 в
`docs/product/profile.md`):

1. **Шаблонные причины сброса (D11-1).** Сброс имени, фото и клуба модератором — причина из списка причин жалоб
   (`PROFILE_REPORT_REASONS`); текст — только для «Другое» (обязателен) вместе с предупреждением «Не повторяйте имя
   или клуб». Запрос — `{ reason, comment? }` (`other` без текста — `REQUIRED`, текст у другого кода — `INVALID`);
   журнал — `details.resetReason`, текст только у «Другое». Панель — `ResetReasonDialog` (карточка профиля и
   «Сбросить имя» в «Результатах»), «Журнал» показывает причину по коду.
2. **Уведомление жалобщикам (D11-2).** Сброс (`actioned`) и «Отклонить жалобы» (`dismissed`) пишут в своей
   транзакции outbox `profile.reports-resolved { targetUserId, resolution, reporterUserIds }` — авторы ровно тех
   жалоб, что закрыло действие (без имени и причины). Обработчик — kind `profile_report_resolved` («Жалоба
   рассмотрена», группа «Райды», без перехода): живые авторы без дублей, райдер профиля — только своё прежнее
   уведомление о сбросе.

## Риски

- Строгий контракт панели: старая панель с текстом в `reason` получит 400 (панель деплоится с API).
- Фокус клавиатуры при выборе «Другое» уходит в поле текста (LOW pass 2, принято).
- Сброс одного поля закрывает все открытые жалобы — «меры приняты» получают и авторы жалоб на другое поле (принято).

## Проверки

- Ревью: Claude pass 1 — APPROVE (MEDIUM + 5 LOW исправлены), pass 2 — APPROVE; принят LOW: `autoFocus` поля «Другое» уводит фокус клавиатуры из группы причин (назад — Shift+Tab). Codex недоступен.
- contracts 549, api unit 1121, api int (profile, panel, notifications-intake, results-names, riders) 384, admin 542,
  i18n 16, api-client 31; typecheck, eslint, format, arch — зелёные. Полный `pnpm check` — в CI.
- NOT VERIFIED: ручная проверка панели в браузере.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
