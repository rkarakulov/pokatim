# 1. Title

Шит «Райд опубликован» после создания кофе-райда; OG-картинка райда — сверка (follow-ups ride-invite-card).

# 2. Goal

Организатор сразу после публикации райда видит нижний шит: «Райд опубликован», «Пригласите друзей — карточкой для
сторис или ссылкой.», два пути — «Карточка-приглашение» (primary) и «Ссылка» (secondary, сразу системное меню) — и
явное «Закрыть». Сейчас вместо шита — баннер на детали.

Источники: прототип «Кофе-райды», кадр (d) «Сразу после публикации · светлая» (конфиденциальный, в репо не
копируется): шит поверх новой детали райда, под ним — вид организатора. `docs/product/rides.md`,
`docs/tasks/2026-10-28-ride-invite-card/pr.md` (follow-ups). Код сверен по `origin/develop` @ `8be34c55`.

# 3. Scope

Уровень **task2**: только приложение (`apps/app`), i18n, доки. API, контракты, миграции — без изменений.

## 3.1 Решения

- **R1. OG-картинка райда уже сделана** в og-images (#115, ADR-0018): `kind: 'ride'` рендерера `/v1/og/*`, шаблон
  «Классика», версионированный URL, пререндер `og.sync` по `RIDES_FOR_SHARING.ogChanged`, приватность (без
  организатора и описания, линия — только маршрута в каталоге, отменённый — бренд, скрытый/не найден — без картинки),
  мета `rides/[id].tsx` → `pageOgImage`. Покрыто `og-card.int.test.ts`, `og-sync.int.test.ts`,
  `rides-for-sharing.int.test.ts`, `public-metadata.test.ts`. В этой задаче кода нет — только строка в
  `docs/product/rides.md` («сделано»).
- **R2. Шит — модальный** (`Modal` RN: native и web) поверх детали, не шторка карты `BottomSheet` (та — для
  свёрнутого/развёрнутого слоя без затемнения). Общий продуктовый компонент `components/modal-sheet.tsx`:
  затемнение `overlay.scrim`, поверхность и верхние углы `sheetSurface(theme)`, заголовок `titleSm` (`role=heading`),
  нижний inset; закрытие — «Закрыть» (кнопка экрана), касание затемнения, «Назад» Android / Esc web
  (`onRequestClose`). Reduce motion — без анимации. Монтируется только после монтирования экрана (закрытый
  RN-web `Modal` рендерит портал — на SSR нельзя; образец — `InstallModal`).
- **R3. Когда показывается:** `?published=1` **и** райд будущий (`phase === 'upcoming'`) **и** зритель —
  организатор (`viewer.role === 'organizer'` сервера) **и** экран смонтирован. Чужой, гость, отменённый, ссылка
  с `?published=1` из истории — шита нет. Баннер `rides.detail.published` удаляется (заменён шитом).
- **R4. Действия:**
  - «Карточка-приглашение» — закрыть шит, `router.push('/rides/invite/<id>')` (существующий экран и `CardPanel`).
  - «Ссылка» — `shareLink` (как «Поделиться» детали). `shared` — шит закрывается; `dismissed` — остаётся;
    `copied` (web без Web Share) — баннер «Ссылка скопирована» в шите; ошибка — баннер-предупреждение. Нет
    web-origin (dev native) — кнопки «Ссылка» нет, текст — «Пригласите друзей карточкой для сторис.».
  - «Закрыть» — `TextAction`.
- **R5. Закрытие снимает параметр** `published` (`router.setParams({ published: undefined })`): «Назад» с экрана
  карточки и перезагрузка web шит не открывают снова.

## 3.2 Слои

- `packages/i18n`: `rides.published.{title,text,textNoLink,link,close}`; удалить `rides.detail.published`.
- `apps/app`: `components/modal-sheet.tsx` (+ тест), `features/rides/ride-published-sheet.tsx`, правка
  `ride-detail.tsx` (шит вместо баннера и снятие параметра `router.setParams`).
- e2e `web.spec.ts`: после «Опубликовать» — шит, «Закрыть», затем проверки детали.
- Доки: `docs/product/rides.md`, `.claude/rules/pokatim-app.md` (Кофе-райды).

# 4. Out of Scope

- Фото организатора на 4a (`media`).
- Новые варианты OG (тёмный шаблон), OG профиля и таблицы сезона.
- Шит после правки райда (`rides/edit`) — только создание.

# 5. Architecture Context

Только `apps/app`: деталь райда (`features/rides/ride-detail.tsx`) уже знает `published`, `viewer`, `mounted`.
Шеринг ссылкой — только `lib/share-link(.web).ts`; карточка — экран `rides/invite/[id]` (`features/sharing`).
Платформенных развилок нет: `Modal` RN работает на iOS, Android и web (RN-web).

# 6. Relevant Files

`apps/app/src/features/rides/ride-detail.tsx`, `apps/app/src/app/rides/[id].tsx`,
`apps/app/src/features/pwa-install/install-modal.web.tsx` (образец), `apps/app/src/components/bottom-sheet-props.ts`
(`sheetSurface`), `apps/app/src/__tests__/ride-detail.test.tsx`, `apps/app/e2e/web.spec.ts`.

# 7. Implementation Notes

TDD: сначала тесты в `ride-detail.test.tsx` (шит организатору с `?published=1`; нет — участнику, без параметра,
отменённому; «Карточка-приглашение» → `/rides/invite/<id>`; «Ссылка» → `shareLink`, `copied` — баннер; нет origin —
без «Ссылки»; «Закрыть» снимает параметр) и `modal-sheet.test.tsx`.

# 8. Risks / Assumptions / Open Questions

- [ASSUMPTION] Текст без web-origin («карточкой для сторис») — прототип такой ветки не рисует.
- RN-web `Modal` держит фокус внутри окна (focus trap) — a11y на web из коробки; native — `accessibilityViewIsModal`.

# 9. Acceptance Criteria

- AC1. Организатор после «Опубликовать» видит шит с заголовком, текстом и тремя действиями (iOS, Android, web).
- AC2. «Карточка-приглашение» открывает экран карточки; «Назад» возвращает на деталь без шита.
- AC3. «Ссылка» открывает системное меню; web без Web Share — «Ссылка скопирована» в шите; ошибка — баннер.
- AC4. «Закрыть», затемнение, «Назад»/Esc закрывают шит; параметр `published` снят.
- AC5. Не организатору, отменённому и прошедшему райду шит не показывается; SSR без шита.
- AC6. Строки — из i18n, оформление — токены и компоненты системы; заголовок — heading, окно — modal dialog.

# 10. Documentation Impact

`docs/product/rides.md` (таблица «Скрыто»: шит и OG — сделано), `.claude/rules/pokatim-app.md` (Кофе-райды: шит).

# 12. Outcome (заполняет coder)

См. `pr.md`.
