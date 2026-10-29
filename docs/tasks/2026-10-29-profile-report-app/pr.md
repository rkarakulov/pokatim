## Что

Follow-up profile-moderation (PR #98): жалоба на публичный профиль райдера в приложении.

- `/riders/[id]`: «Пожаловаться» внизу профиля — вошедшему по `canReport`/`reported` сервера (`GET /v1/riders/:publicId/me`,
  только после найденного профиля), уже жаловался — «Вы пожаловались на этот профиль», свой — ничего; гостю — «Вход» с
  возвратом к профилю (allowlist возврата — `/riders/<RiderPublicId>`); сессия неизвестна (SSR) — ничего.
- Экран `riders/report/[id]` внутри `Stack.Protected`: причина (6 чипов), комментарий ≤ 500, «Отправить» → «Жалоба
  отправлена» и «К профилю»; отказы 409 own_profile / 429 / 404 / сеть — баннер. Без имени, клуба и фото.
- i18n `riders.report.*`, `docs/product/profile.md`, `.claude/rules/pokatim-app.md`, шаг e2e-смоука.

Спецификация — `docs/tasks/2026-10-29-profile-report-app/task.md`.

## Проверка

- `pnpm format:check`, `pnpm lint`, `pnpm arch:check`, `pnpm --filter @pokatim/app typecheck` — ок.
- `pnpm --filter @pokatim/app test` — 211 наборов, 1956 тестов зелёные (новые: `rider-report.test.tsx`, блок в
  `rider-profile.test.tsx`, allowlist, манифест SSR).
- iOS/Android-симулятор — NOT VERIFIED; web — проверка на dev после мержа.
