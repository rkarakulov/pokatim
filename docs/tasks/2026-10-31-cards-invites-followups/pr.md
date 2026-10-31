Follow-up карточек для сторис (#139, #142) и приглашений панели (#141, ADR-0026). Задача — `docs/tasks/2026-10-31-cards-invites-followups/task.md`.

## Карточки (A)

- **Тема в ключе карточки.** `useCardStatus` добавляет к ключу `useAppTheme().id` — сервер рисует карточку в теме запрашивающего, смена темы больше не показывает старую картинку. Успешное сохранение темы (`useSetTheme`) отменяет и перезапрашивает статусы карточек (`invalidateCardStatuses`, `meta.cardStatus`, `cancelQueries` → `invalidateQueries`): ответ, полученный или начатый до сохранения, — прежней темы. Отсчёт 30 с `pending` — по шаблону и теме.
- **noindex.** `noindexPageMetadata` + `generateMetadata` на `/rides/invite`, `/races/story`, `/routes/story`, `/achievements/story`; `Disallow` остаётся (правило SEO дополнено исключением для экранов только вошедшим). `routes/story` — за `useSettingsShell` (+ строка в сторож).
- **Рендер приглашения райда проверен глазами** (7 тем × 2 шаблона, `preview:story-cards`): в порядке. Скрипт превью падал на фикстурах достижений без `level` — починен.

## Панель (B)

- **2FA снятого сотрудника.** Снятие роли в своей транзакции удаляет 2FA и доверенные устройства; повторная активация снятого (выдача, CLI, принятие приглашения) — тоже, для снятых раньше. Вернувшийся подключает 2FA заново, а не упирается в старый аутентификатор. ADR-0026 — дополнение, `[ASSUMPTION]` в task.md.
- **e2e** `apps/admin/e2e/invitations.spec.ts`: «Пригласить» → письмо (Mailpit) → регистрация в приложении → ссылка → «Принять и войти» → «Обзор».
- **«дней»** — `admin.members.inviteLead` плюральной формой.

## Проверки

- jest app (карточки, тема, мета, оболочка), vitest i18n, int api (`panel-members`, `panel-invitations`, `panel-cli`) — зелёные; новые тесты A1/B4 краснеют без исправлений.
- `pnpm e2e:admin` локально (свой Mailpit, своя БД): 4/4.
- Полный `pnpm check` локально целиком зелёным не прошёл: флаки под нагрузкой (load 37–47) в файлах вне diff (`SeasonScreen.test.tsx` и др. — отдельно проходят); push — `--no-verify` с согласия пользователя, финальный гейт — CI.
- Ревью: Codex pass 1–2 — APPROVE (оба MEDIUM исправлены), independent-reviewer — APPROVE (MEDIUM и LOW исправлены, LOW-2 принят в ADR). `findings-*.md` в папке задачи.
- NOT VERIFIED: экран карточки на iOS/Android вручную.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
