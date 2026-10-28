# Findings — ride-invite-card — pass 1 — reviewer: codex
base: origin/develop   commits: aa857ba..0ddd4d0
verdict: REQUEST CHANGES

### [HIGH] Отступ единицы измерения задан вне дизайн-системы
- **file:** apps/api/src/modules/sharing/ride-invite.render.ts
- **location:** 44
- **problem:** Отступ между значением и единицей измерения задан литералом `marginLeft: 12`.
- **why_it_matters:** Нарушен AGENTS.md §4.11: отступы оформления должны браться из токенов. Контракт ревью относит это нарушение к HIGH.
- **evidence:** `text(storyCard.text.statUnit, colors.muted, item.unit, { marginLeft: 12 })`; остальные размеры шаблона берутся из `storyCard`.
- **recommended_fix:** Добавить семантический токен отступа единицы измерения в `storyCard` и использовать его в разметке.

### [MEDIUM] Действие «К райду» возвращает на произвольный предыдущий экран
- **file:** apps/app/src/features/rides/invite/ride-invite-screen.tsx
- **location:** 28–36
- **problem:** Действие пустого состояния вызывает `router.back()`, если история навигации непустая, независимо от предыдущего маршрута.
- **why_it_matters:** При открытии приглашения по deep link поверх другого экрана после 404/409 кнопка «К райду» уведёт на этот экран вместо детали райда.
- **evidence:** `action={{ label: t('rideInvite.empty.action'), onPress: back }}` использует обработчик с `if (router.canGoBack()) router.back()`. Для аналогичного действия гонки `useBackToRace` применяет `router.dismissTo(racePath(raceId))`.
- **recommended_fix:** Для «К райду» использовать `router.dismissTo(ridePath(rideId))`, для некорректного id — переход в `/rides`. Добавить тест с предыдущим экраном, отличным от детали райда.

### [MEDIUM] Новый маршрут не добавлен в обязательный web-smoke
- **file:** apps/app/src/app/rides/invite/[id].tsx
- **location:** RideInviteRoute; apps/app/e2e/web.spec.ts
- **problem:** Добавлен новый маршрут приложения, но браузерный smoke для него отсутствует.
- **why_it_matters:** Правила приложения требуют добавлять новый маршрут в web-smoke. Тесты через `expo-router/testing-library` не проверяют реальную web-сборку, гидрацию и работу браузерного гарда.
- **evidence:** `.claude/rules/app.md`, раздел «Все платформы»: «новый маршрут — шаг смоука»; в `apps/app/e2e/web.spec.ts` отсутствует `/rides/invite/`.
- **recommended_fix:** Добавить браузерный smoke нового маршрута: открытие без сессии и переход на вход после гидрации; с сессией — открытие экрана и отображение состояния карточки.

Проверки: `pnpm format:check` и `pnpm lint` — PASS. Полный `pnpm check`, интеграционные тесты, запуск на платформах и визуальная проверка PNG — **NOT VERIFIED**: в этом проходе не выполнялись; среда доступна только для чтения.