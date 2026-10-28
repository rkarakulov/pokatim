# Findings — settings-hub — pass 1 — reviewer: claude
base: origin/develop   commits: origin/develop..4c26c5d (1 commit; working tree clean)
verdict: APPROVE

Проверено самостоятельно: `jest` (settings-screen, home, sign-in, top-bar, features/settings native + web) —
6 suites / 76 tests passed; `tsc --noEmit` (apps/app) — чисто; `vitest` packages/i18n — 7 passed.
Полный `pnpm check` и Playwright e2e не запускались (NOT VERIFIED).

Измерения без замечаний: correctness навигации хаба и языка; call sites (`onOpenProfile` больше нигде не используется,
`settings/profile` достижим из хаба, `delete-account-form` fallback не затронут); безопасность (новых запросов нет,
ссылки только из `EXPO_PUBLIC_*` с проверкой https/e-mail, `openExternalUrl` с `noopener`); placement (локальная
строка в `features/settings` по прецеденту `device-row`/`detail-row`, токены и роли темы, хардкода цветов нет);
contracts/серверный авторитет/аудит/миграции/BullMQ — не затронуты; i18n — все строки из `@pokatim/i18n`;
состояния данных — у хаба нет запросов, гард и скелетон — `useSettingsShell`; все платформы — `locale-preference`
имеет `.web`, иконки `settings`/`check` есть в SF Symbols и Material Symbols; Documentation Sync — раздел 10 task.md
выполнен (rules, runbook, Dockerfile).

### [LOW] mailto на web открывается через `window.open(_blank)` — пустая вкладка
- **file:** apps/app/src/app/settings/index.tsx
- **location:** строка 98 (`open(\`mailto:${supportEmail}\`)`) → apps/app/src/lib/open-external-url.web.ts
- **problem:** web-реализация `openExternalUrl` всегда делает `window.open(url, '_blank', 'noopener,noreferrer')`; для
  `mailto:` это открывает новую пустую вкладку (Chrome/Safari) параллельно почтовому клиенту.
- **why_it_matters:** UX «Поддержки» на web/PWA: у пользователя остаётся about:blank-вкладка; в PWA standalone —
  лишнее окно браузера.
- **evidence:** `open-external-url.web.ts`: `window.open(url, '_blank', 'noopener,noreferrer')` без развилки по схеме.
- **recommended_fix:** для `mailto:` на web — `window.location.href = url` (или отдельная функция `openMail` с
  `.web`-вариантом); сейчас адрес поддержки не задан нигде, поэтому не блокер.

### [LOW] AC4 «во время выхода кнопка недоступна» не покрыт тестом хаба
- **file:** apps/app/src/__tests__/sign-in.test.tsx
- **location:** describe('выход'), строки ~236–270
- **problem:** тесты выхода переехали на `/settings`, но ни один не проверяет `disabled` у «Выйти» на время
  `signOut()` (как и раньше на Главной).
- **why_it_matters:** acceptance 4 заявлен, но защищён только кодом (`disabled={signingOut}`), регрессия не поймается.
- **evidence:** `grep toBeDisabled sign-in.test.tsx` — только кнопка формы входа (строка 105).
- **recommended_fix:** в тесте выхода задержать `api.signOut` (неразрешённый промис), нажать «Выйти» и проверить
  `toBeDisabled()`.

### [LOW] Восстановление языка при запуске проверено только на уровне функции
- **file:** apps/app/src/app/_layout.tsx
- **location:** строки 58–63 (`void restoreLocale()`)
- **problem:** AC5 «при запуске сохранённый язык применяется» покрыт юнит-тестами `restoreLocale`, но вызова из
  корневого layout не проверяет ни один тест — удаление строки из `useEffect` тесты не заметят.
- **why_it_matters:** честность покрытия acceptance; при одном языке последствий нет, при втором — тихая регрессия.
- **evidence:** `grep -rn restoreLocale apps/app/src/__tests__` — пусто.
- **recommended_fix:** в тесте с `appRoutes` положить `"ru"` в мок SecureStore, шпионить `i18n.setLocale` и проверить
  вызов после рендера корня.

### [LOW] Комментарий в корневом Stack теперь относится не к тому экрану
- **file:** apps/app/src/app/_layout.tsx
- **location:** строки 143–146
- **problem:** комментарий «Профиль (profile-rider-name, вход — иконка верхней панели)» стоит над новыми
  `settings/index` и `settings/language`, а «Профиль» больше не входит с верхней панели (вход — из хаба).
- **why_it_matters:** вводит в заблуждение следующего читателя layout.
- **evidence:** `{/* «Профиль» (profile-rider-name, вход — иконка верхней панели) … */}` → `<Stack.Screen name="settings/index" />`.
- **recommended_fix:** отдельный комментарий для хаба/языка (settings-hub, вход — иконка «Настройки»), у «Профиля» —
  «вход — из „Настроек“».

### [LOW] Раздел 12 Outcome в task.md не заполнен; тест языка не в заявленном файле
- **file:** docs/tasks/2026-10-28-settings-hub/task.md
- **location:** раздел 11 (TESTS: `__tests__/language-screen.test.tsx`), раздел 12
- **problem:** тесты экрана «Язык» живут в `settings-screen.test.tsx` (describe «Язык (AC5)»), а не в заявленном
  `language-screen.test.tsx`; Outcome — «заполняется после реализации».
- **why_it_matters:** расхождение документа задачи и diff (Documentation Sync), мелкое.
- **evidence:** `git diff --stat` — `language-screen.test.tsx` отсутствует.
- **recommended_fix:** поправить раздел 11 и заполнить Outcome на finish-task.

### NOT VERIFIED
- AC7 (визуальная сверка в «Классике», «Навигации» тёмной, «Типографике») — нет запуска приложения; по коду все
  цвета — роли `theme.*`, отступы — токены.
- AC8 полный `pnpm check` и Playwright-сценарий `e2e/web.spec.ts` — не запускались (нужны API/БД); локаторы по коду
  совпадают с ролями и подписями (`heading`/`link`/`radio`/`button`).
