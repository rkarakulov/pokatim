# Findings — small-followups-api — pass 2 — reviewer: codex
base: origin/develop   commits: origin/develop..7be94d3f
verdict: APPROVE

### [MEDIUM] Инструкция очистки N8 не покрывает имена без согласия на показ

- **file:** docs/runbooks/deploy.md
- **location:** 586–588; apps/api/src/modules/profile/reserved-rider-lines.ts, `find`
- **problem:** CLI выбирает служебные имена независимо от `showNameInResults`, однако предложенный сброс через карточку панели недоступен для имени без согласия на показ.
- **why_it_matters:** Профиль с `publicName: 'Вы'` и `showNameInResults: false` попадает в отчёт CLI, но модератор не сможет очистить его описанным способом. Повторная выборка продолжит возвращать профиль.
- **evidence:** `ReservedRiderLines.find()` проверяет только содержимое `publicName`. `ProfileModerationService.detail()` возвращает `name: nameOf(doc)`, а `nameOf` скрывает имя непубличного профиля. В `apps/admin/src/features/rider-profiles/RiderProfileScreen.tsx:66` функция `canReset` разрешает сброс имени только при `profile.name !== null`. При этом существующий `POST /v1/admin/profiles/:userId/name-reset` и `ProfileRepository.resetPublicName()` поддерживают сброс без согласия на показ.
- **recommended_fix:** Дополнить runbook способом сброса скрытого имени через существующий авторизованный endpoint с причиной и журналированием. Сохранить запрет на раскрытие имени без согласия.

Проверено по коду:

- Прежняя находка HIGH об оставленной подмене `admitEntry` устранена: `onTestFinished` открывает ворота и вызывает `spy.mockRestore()`.
- HMAC ключей лимитов переведён на отдельный секрет; ключи ссылок, билетов и маркеров сохранены. Новый секрет предусмотрен в конфигурации, CI и деплое.
- `_` валидируется и удаляется до вызова сервиса; остальные лишние параметры запрещены. `fresh` передаётся на всех платформах; установленный `whatwg-fetch` добавляет числовую метку.
- Границы модулей, серверный авторитет и append-only аудит не нарушены. Миграции и очереди не изменены; UI, дизайн-система, состояния данных и SSR не затронуты.

Проверки:

- `git diff --check origin/develop...HEAD` — успешно.
- Тесты contracts — 57 файлов, 533 теста успешно.
- **NOT VERIFIED:** тесты API — запуск остановлен ошибкой `EPERM` при создании временного файла конфигурации Vite в read-only окружении. Интеграционные тесты, тесты приложения, полный `pnpm check` и проверка `NSURLCache` на iOS в этом проходе не выполнены.