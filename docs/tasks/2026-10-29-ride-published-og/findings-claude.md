# Findings — ride-published-og — pass 1 — reviewer: claude
base: origin/develop   commits: origin/develop..0cf0c178 (1 commit; working tree clean)
verdict: APPROVE

Проверено мной: `jest src/__tests__/ride-detail.test.tsx src/components/modal-sheet.test.tsx` — 2 suites, 41 passed;
`tsc --noEmit` (apps/app) — чисто; `eslint` по изменённым файлам — чисто.

NOT VERIFIED: e2e `web.spec.ts` (нужны API и web-сервер); поведение на устройствах iOS/Android (нет симулятора в
сессии). Android edge-to-edge проверен по исходникам: в RN 0.88 `ReactModalHostView` принудительно включает
`statusBarTranslucent`/`navigationBarTranslucent` при `isEdgeToEdgeFeatureFlagOn`, так что `insets.bottom` в шите не
удваивается — замечания нет.

Сверка по измерениям (без замечаний): условия показа (`published && sheetOpen && mounted && upcoming && organizer`,
роль — с сервера, `mounted` — после монтирования, на SSR `Modal` не рендерится); снятие `published` через
`router.setParams` при любом закрытии, включая «Карточку-приглашение» (повторно шит не откроется: и состояние,
и URL); состояния «Ссылки» (`shared` — закрыть, `dismissed` — остаётся, `copied` — баннер, ошибка — предупреждение,
кнопка `disabled` на время шеринга, нет origin — без кнопки и с другим текстом); a11y (`role=heading`,
`role=dialog` + `aria-label`, `accessibilityViewIsModal`, Esc — `onRequestClose` в RN-web `ModalContent`, focus trap
RN-web, затемнение вне a11y и Tab); дизайн-система (только роли темы, `textStyle`, `space`/`size`/`stroke`,
`Button`/`TextAction`/`Banner` из `@rkarakulov/ui`; без hex/px; `SCRIM_OPACITY`/`'90%'` — как в существующем
`InstallModal`); i18n (новые ключи, старый `rides.detail.published` удалён, других ссылок нет); Documentation Sync
(`docs/product/rides.md`, `.claude/rules/pokatim-app.md` — по разделу 10). Серверный авторитет, аудит, миграции,
очереди, контракты — изменение их не трогает.

Утверждение R1 (OG-картинка райда сделана в #115) подтверждено по коду: `og-card.inputs.ts` (`kind: 'ride'`, поля:
id, title, startsAt, place, distanceKm, pace, routeId), `rides-for-sharing.ts#ogFacts` (только `status ===
'published'`; скрытый/отменённый — `null`; `routeId` — только маршрут, публичный в каталоге сейчас); организатора и
описания в фактах нет, гость видит те же поля, что и на публичной странице. `rides/[id].tsx#generateMetadata` →
`ogCardIfOrigin('ride', id)` + `pageOgImage` (не найден — без картинки; нет карточки — бренд).

### [LOW] Тесты закрытия «Назад»/Esc полагаются на устаревший bubbling `requestClose`
- **file:** apps/app/src/components/modal-sheet.test.tsx, apps/app/src/__tests__/ride-detail.test.tsx
- **location:** `fireEvent(screen.getByTestId('sheet'), 'requestClose')`; тест «Назад Android / Esc (onRequestClose)»
- **problem:** событие стреляется по внутреннему `View`, обработчик — на `Modal`; RNTL уже предупреждает, что
  `requestClose` не всплывает и всплытие будет убрано в следующей мажорной версии.
- **why_it_matters:** при обновлении RNTL оба теста AC4 сломаются (или, хуже, станут проверять не то).
- **evidence:** вывод jest: `fireEvent: "requestClose" does not bubble in React Native. fireEvent will stop bubbling it
  in the next major version. Fire it on: <Modal />` (дважды).
- **recommended_fix:** стрелять событием прямо по `Modal` (например, `screen.UNSAFE_getByType(Modal)`, или `testID`
  на `Modal`, если его пробрасывает тестовый рендер).

### [LOW] На web два вложенных `role="dialog"`, внешний — без имени
- **file:** apps/app/src/components/modal-sheet.tsx
- **location:** `<Modal visible transparent …>` и внутренний `<View role="dialog" aria-label={title}>`
- **problem:** RN-web `ModalContent` сам рендерит `View` с `role="dialog"` и `aria-modal` (и пробрасывает `rest`-пропсы),
  внутри — второй dialog с именем. Скринридер может объявить безымянный диалог, а потом ещё один.
- **why_it_matters:** a11y-шум (AC6 «окно — modal dialog»); тот же паттерн уже есть в `InstallModal`, не регрессия.
- **evidence:** `node_modules/react-native-web/dist/exports/Modal/ModalContent.js`: `role: active ? 'dialog' : null`,
  `"aria-modal": true`, `_extends({}, rest, …)`.
- **recommended_fix:** передать `aria-label={title}` в сам `Modal` (на web он попадёт на внешний dialog); внутреннюю
  роль оставить для native или снять на web. Можно отложить вместе с `InstallModal`.

### [LOW] `ModalSheet` дублирует шит-ветку `InstallModal`
- **file:** apps/app/src/components/modal-sheet.tsx
- **location:** `SCRIM_OPACITY`, `MAX_HEIGHT`, затемнение `Pressable`, панель с `sheetSurface` и `insets.bottom + space.s5`
- **problem:** почти построчная копия `features/pwa-install/install-modal.web.tsx` (placement `sheet`), константы
  продублированы.
- **why_it_matters:** два источника вида модального шита разойдутся (прозрачность затемнения, отступы, a11y-фиксы
  вроде предыдущего пункта придётся делать дважды).
- **evidence:** `install-modal.web.tsx`: `const SCRIM_OPACITY = 0.4; const MAX_HEIGHT = '90%';`, тот же `Pressable`
  с `accessible={false} importantForAccessibility="no" tabIndex={-1}`.
- **recommended_fix:** follow-up: `InstallModal` (sheet) поверх `ModalSheet` или общие константы/скрим в
  `components/`.

### [LOW] Пробелы в тестах AC5 / R5
- **file:** apps/app/src/__tests__/ride-detail.test.tsx
- **location:** describe «шит «Райд опубликован»: организатор»
- **problem:** нет кейса «прошедший райд» (`phase: 'past'`) из AC5; тест «Карточка-приглашение → Назад» не отличает
  снятие параметра от локального `sheetOpen=false` (тот же экземпляр экрана), а проверка
  `not.toHaveProperty('published', '1')` пропустит любое другое значение.
- **why_it_matters:** регрессия условия `upcoming` или снятия параметра на этом пути не поймается юнитами (частично
  страхуют тест «Закрыть» и e2e по URL).
- **evidence:** кейсы есть для гостя, участника, без параметра, отменённого; `past` — нет.
- **recommended_fix:** добавить `organizerView({ phase: 'past' })` с `?published=1`; в «Назад» —
  `expect(router.getSearchParams().published).toBeUndefined()`.

### [LOW] task.md расходится с реализацией
- **file:** docs/tasks/2026-10-29-ride-published-og/task.md
- **location:** §3.2 («правка … `app/rides/[id].tsx` (снятие параметра)»), §12 («См. `pr.md`»)
- **problem:** параметр снимается в `ride-detail.tsx`, `[id].tsx` не менялся (это нормально); `pr.md` в каталоге
  задачи нет.
- **why_it_matters:** Outcome задачи ссылается на несуществующий файл; следующий читатель будет искать правку
  маршрута.
- **evidence:** `git diff origin/develop...HEAD --stat` — `[id].tsx` нет; `ls docs/tasks/2026-10-29-ride-published-og/`
  — только `task.md`, `findings-*.md`.
- **recommended_fix:** поправить §3.2 и добавить `pr.md` (или заполнить §12) на finish.

CRITICAL/HIGH: нет.
