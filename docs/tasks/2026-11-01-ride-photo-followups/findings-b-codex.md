# Findings — ride-photo-followups — pass 1 — reviewer: codex
base: origin/develop   commits: origin/develop..07531566
verdict: REQUEST CHANGES

### [HIGH] Фото шапки отсутствует в серверном HTML
- **file:** apps/app/src/features/rides/ride-detail.tsx
- **location:** 164–169, `SectionHero`
- **problem:** Передача `photo` существующему `SectionHero` показывает картинку только после монтирования клиента. SSR не рендерит требуемый `<img>`.
- **why_it_matters:** Нарушены AC1 и AGENTS.md §4.13: публичная карточка должна показывать фото при SSR. До гидрации сервер отдаёт затемнение и текст `onPhoto` без фотографии.
- **evidence:** `SectionHero` использует `Image` из `expo-image` без `placeholder`. Установленный `ExpoImage.web.tsx` передаёт в `AnimationManager` `initialNode = null`; тот инициализирует `nodes` пустым массивом и добавляет изображение только в `useEffect`. Проверка через `renderToStaticMarkup` установленного `AnimationManager` с такими параметрами вернула `{"html":"","hasImg":false}`. Существующий `section-hero.web.test.tsx` использует клиентский `render`, который выполняет эффекты.
- **recommended_fix:** Обеспечить SSR-совместимую отдачу декоративного изображения в общем `SectionHero` через платформенную реализацию рядом, сохранив токены, скрим и обработку ошибки. Добавить серверный тест, проверяющий наличие `<img src="…">` и `alt=""` до выполнения эффектов.
- **fixed (подтверждено):** серверный тест `section-hero.web.test.tsx` «серверный HTML» (`renderToString`, эффекты не
  выполняются) на прежнем `expo-image` — `expect(img).toBeDefined()` → `Received: undefined` (в HTML нет `<img>`).
  Исправление — платформенная картинка героя `components/hero-photo(.web).tsx`: native — прежний `expo-image`, web —
  обычный `<img src alt="" decoding="async">` `object-fit: cover` (в SSR и при гидрации одинаков); ошибка до гидрации —
  `complete && naturalWidth === 0` в эффекте после монтирования. Закрывает и героя ленты/Главной (общий `SectionHero`).
  Тесты web: SSR `<img src alt="">` + скрим, без фото — ничего; `error` → типографский; сломанная до гидрации →
  типографский; загруженная до гидрации — фото остаётся. Отрицательные доказательства: без `hero-photo.web.tsx`
  (web берёт `expo-image`) — 3 failed (SSR, `error`, до гидрации); без проверки `complete` — 1 failed (до гидрации).

### [LOW] Правила контрактов продолжают предписывать удалённый метод
- **file:** .claude/rules/pokatim-contracts.md
- **location:** 297
- **problem:** Перечень методов админского клиента по-прежнему содержит `ridePhotoUrl`, удалённый этим изменением.
- **why_it_matters:** Правила репозитория расходятся с публичным интерфейсом пакета и обновлённым `pokatim-web.md`.
- **evidence:** `admin — resetRidePhoto(id, body), ridePhotoUrl`; в `packages/api-client/src/admin.ts` остался только `moderationRidePhotoUrl`.
- **recommended_fix:** Удалить `ridePhotoUrl` из перечня методов админского клиента, сохранив упоминание для приложения.
- **fixed:** `pokatim-contracts.md` — у admin оставлен только `resetRidePhoto(id, body)` (`moderationRidePhotoUrl` — в той же
  строке ниже, ride-photo-followups); упоминание `ridePhotoUrl` у приложения сохранено.

NOT VERIFIED: тесты приложения остановились на ошибке прав Watchman; тесты панели и api-client — на `EPERM` записи временного конфига Vite. Полный `pnpm check`, браузерная проверка SSR и визуальные проверки платформ в этом проходе не выполнены.