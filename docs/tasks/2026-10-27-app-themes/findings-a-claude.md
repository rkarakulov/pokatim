# Findings — app-themes-slice-a-foundation — pass 1 — reviewer: claude
base: origin/main   commits: 18b6a1d (feature/theme-shape-provider, app-foundation)
verdict: APPROVE

Проверено: `pnpm check` (все 12 задач зелёные; ui — 18 suites / 96 tests, native + web), `pnpm build && pnpm smoke`
(импорт из dist, import-isolation, smoke jest ui.web — зелёные). Рабочее дерево чистое.

Измерения: correctness — ок (кольцо фокуса: border + padding = 2 × indicator, радиус `radius + 2·indicator`
верен; `textTransform: 'none'` перекрывает uppercase из `textStyle('button')`). Обратная совместимость — ок:
`defaultShape` = нули + `upper`, без провайдера `useTheme` = `themeFor(useColorScheme())`, существующие тесты не
правлены; новые CSS-строки `--radius-{button,field,chip,card,sheet}` не конфликтуют с примитивами `radius`
(`none`, `pill`); `shape` исключён из `--color-*`. Хуки в `useTheme` безусловны. StrictMode (двойной рендер и
mount→cleanup→mount эффекта) — по коду корректно, итог `fonts`. Размонтирование — сброс в `undefined`, покрыто
тестом. Memo-потребитель — тест с сохранением `useState`. Web-развилки (§4.12) — новых нет; web-тест провайдера
есть (prefers-color-scheme, SSR, Button). Экспорты корня и changeset (minor, обе группы fixed) — по контракту.
Безопасность, миграции, очереди, аудит, i18n — не затронуты (новых строк UI нет).

### [MEDIUM] Вложенный ThemeProvider или провайдер без `fonts` глобально сбрасывает шрифты внешнего
- **file:** packages/ui/src/theme/theme-provider.tsx
- **location:** `ThemeProvider`, `setActiveFonts(fonts)` на рендере и cleanup `setActiveFonts(undefined)`
- **problem:** провайдер безусловно пишет свой `fonts` (в т. ч. `undefined`) в глобальное значение процесса, а
  при размонтировании ставит `undefined`, не восстанавливая предыдущее. Вложенный `<ThemeProvider theme={dark}>`
  (типичный приём «инвертированный участок»: оверлей карты, шторка) без `fonts` переключает на шрифты
  `configureDesignSystem` всё, что отрендерится после него, включая соседей вне поддерева; размонтирование
  вложенного оставляет приложение без шрифтов темы до следующего рендера корневого провайдера.
- **why_it_matters:** публичный API, единственная защита — фраза JSDoc «провайдер один, у корня». Ошибка тихая:
  смешанные шрифты зависят от порядка рендера.
- **evidence:** `setActiveFonts(fonts); useEffect(() => { setActiveFonts(fonts); return () => setActiveFonts(undefined); }, [fonts]);`
- **recommended_fix:** брать `fonts ?? useContext(ThemeContext)?.fonts` (вложенный наследует шрифты внешнего) и
  в cleanup восстанавливать значение родителя (`parent?.fonts`), а не `undefined`; тест на вложенный провайдер
  без `fonts`. Либо явно запретить вложенность (dev-warning при наличии родительского контекста) и описать в README.

### [MEDIUM] SegmentedControl: радиус чипа на сегменте-вкладке с одной нижней границей искривляет индикатор
- **file:** packages/ui/src/components/ui/segmented-control.tsx
- **location:** стиль сегмента, `borderRadius: radius` при `styles.segment.borderBottomWidth: stroke.indicator`
- **problem:** сегмент — вкладка без заливки, активность показана только нижней границей. При `chip: 18` и высоте
  44 px нижняя граница рисуется дугой с загнутыми вверх концами (iOS — неравномерные границы с радиусом, web —
  `border-radius` + `border-bottom`), а не скруглённой «таблеткой».
- **why_it_matters:** первая же тема с формой (у pokatim chip ≈ 18) получит визуальный дефект в табах; тест лишь
  фиксирует `borderRadius: 18` и не ловит это.
- **evidence:** `borderBottomColor: active ? theme.text.primary : 'transparent', borderRadius: radius` при
  `segment: { borderBottomWidth: stroke.indicator, … }`.
- **recommended_fix:** не скруглять сегмент-подчёркивание (или скруглять только концы индикатора отдельным View
  высотой `stroke.indicator` с `borderRadius: stroke.indicator / 2`); если форма сегмента нужна — согласовать
  с дизайном вид «чипов» (заливка активного) и тогда применять `chip`.

### [LOW] Skeleton берёт радиус карточки для всех заглушек
- **file:** packages/ui/src/components/ui/skeleton.tsx
- **location:** `Skeleton` → `borderRadius: shapeOf(theme).card`; `SkeletonHeroCard` (`height={size.buttonHeight}`), `SkeletonText`
- **problem:** заглушка кнопки получает радиус `card`, а не `button`; строки текста (высота = кегль, 11–17 px) —
  радиус 16, т. е. «таблетки».
- **why_it_matters:** скелетон должен повторять раскладку (§4.12); при `card ≠ button` заглушка кнопки не
  совпадёт с кнопкой.
- **evidence:** `<Skeleton height={size.buttonHeight} width="45%" />` в `SkeletonHeroCard`.
- **recommended_fix:** необязательный проп `shape?: 'card' | 'button' | 'field' | 'text'` у `Skeleton`, в
  `SkeletonHeroCard` — `button` для кнопки.

### [LOW] Web-CSS не использует новые переменные формы
- **file:** packages/design-tokens/src/css.ts
- **location:** `typographyCss()` / `skeletonCss()` (не в diff)
- **problem:** `--button-text-transform` и `--radius-*` выводятся, но классы `.t-button`, `.skeleton` по-прежнему
  с зашитыми uppercase / без радиуса. Потребителей переменных в базе нет.
- **why_it_matters:** HTML-разметка с классами базы (SSR-заглушки, админка) не последует форме темы; переменные
  пока «мёртвые».
- **evidence:** `grep -rn 'radius-\|--button-text' packages` — только места вывода.
- **recommended_fix:** в `.t-button` — `text-transform: var(--button-text-transform, uppercase)`, в `.skeleton` —
  `border-radius: var(--radius-card, 0)`; либо зафиксировать в JSDoc, что переменные — для CSS проекта.

### [LOW] `buttonCase: 'none'` оставляет трекинг заглавных
- **file:** packages/ui/src/components/ui/button.tsx
- **location:** `shape.buttonCase === 'none' && styles.caseNone`
- **problem:** `typography.button = text(600, 13, 16, caps(0.08))` — letterSpacing 0.08 em подобран под
  заглавные; строчная подпись остаётся разреженной.
- **why_it_matters:** визуальное качество тем со строчными кнопками.
- **evidence:** `caps = (letterSpacing) => ({ letterSpacing, uppercase: true })`.
- **recommended_fix:** в `caseNone` — `letterSpacing: 0` (или согласовать трекинг с дизайном).

### [LOW] Тесты: нет StrictMode/вложенности, SSR-тест оставляет глобальные шрифты
- **file:** packages/ui/src/theme/theme-provider.test.tsx, packages/ui/src/theme/theme-provider.web.test.tsx
- **location:** describe `ThemeProvider`; тест «SSR: тема и шрифты провайдера»
- **problem:** (1) явно требуемая корректность в StrictMode не закреплена тестом (`<StrictMode>` + проверка
  `textStyle` после mount и после unmount); (2) `renderToString` не запускает эффекты — `activeFonts = brandFonts`
  остаётся на последующие тесты файла (сейчас не влияет, но порядок-зависимо); (3) нет теста смены только `fonts`
  у memo-потребителя `useTheme`.
- **why_it_matters:** регрессия в эффекте/рендер-фазе пройдёт незамеченной.
- **recommended_fix:** добавить тесты StrictMode и смены `fonts`; в web-файле `afterEach(() => setActiveFonts(undefined))`.

### [LOW] Нестабильный `fonts` пересоздаёт значение контекста на каждом рендере
- **file:** packages/ui/src/theme/theme-provider.tsx
- **location:** `useMemo(() => ({ theme, fonts }), [theme, fonts])`, `useEffect(…, [fonts])`
- **problem:** инлайн-объект `fonts={{…}}` у вызывающего → каждый рендер провайдера перерисовывает всех
  потребителей `useTheme` и перезапускает эффект (cleanup → `undefined` → `fonts`).
- **recommended_fix:** JSDoc у `fonts`: «стабильная ссылка (константа модуля / useMemo)».

## Заметка вне вердикта (spec-уровень, к слайсу D)
Глобальный набор шрифтов на процесс принят в контракте. При SSR с разной темой на запрос (слайс D: тема
пользователя) и потоковом рендере с Suspense (`renderToPipeableStream`/`ReadableStream`) запросы чередуются, и
дорисовка границы запроса A возьмёт шрифты запроса B. Для `renderToString` проблемы нет. Учесть при проектировании
SSR в слайсе D (например, на web не брать `fontFamily` из `textStyle`, а отдавать CSS-переменную стека шрифтов темы).

## Итог
CRITICAL/HIGH нет → **APPROVE**. Рекомендую до релиза закрыть MEDIUM про вложенный провайдер (дешёвый фикс,
публичный API) и про SegmentedControl (виден в первой же теме pokatim).

---

# Findings — app-themes-slice-a-foundation — pass 2 — reviewer: claude
base: origin/main   commits: 18b6a1d..21bc9ee (feature/theme-shape-provider, app-foundation; фокус — 21bc9ee)
verdict: APPROVE

Проверено: `pnpm check --force --continue` — lint/typecheck/build зелёные; ui — 18 suites / 100 tests (native + web)
зелёные; design-tokens зелёные. Падают только интеграционные тесты `api-kit` и `test-kit` с `ECONNREFUSED
127.0.0.1:5433`: локально нет Postgres, пакеты diff не затрагивает (без `--force` turbo отдаёт их из кэша зелёными).

Закрытие pass 1:
- **M1 (вложенный провайдер/шрифты) — закрыт.** `effective = fonts ?? parent?.fonts` — вложенный без `fonts`
  наследует шрифты внешнего и на рендере, и в реестре. Реестр `mounted` по глубине: запись создаётся внутри эффекта
  и удаляется в его очистке. Значит, в StrictMode (mount → cleanup → mount) и при Fast Refresh записи не текут, а
  объект записи не делится между повторными запусками. Выбор «самого глубокого» не зависит от порядка очистки при
  размонтировании дерева: React сначала выполняет все очистки passive-эффектов, потом все установки, поэтому при смене
  `fonts` у внешнего итог — внутренний. SSR: эффектов нет, реестр на сервере пуст, работает только запись на рендере
  (как в pass 1). Web-тест теперь сбрасывает шрифты в `afterEach`. Тест «размонтирование внутреннего возвращает
  шрифты» честный: на старом коде (очистка → `undefined`) он падает. `ThemeContext`/`depth` из корня пакета не
  экспортируются (`packages/ui/src/index.ts`), поэтому обязательное поле в `ThemeContextValue` публичный API не ломает.
- **M2 (радиус SegmentedControl) — закрыт.** Скругления сегмента нет, импорт `shapeOf` удалён, тест проверяет,
  что `borderRadius` не 18.
- **LOW из pass 1.** `letterSpacing: 0` при `buttonCase: 'none'` (native) и `--button-letter-spacing` в CSS
  согласованы: `0em` / `0.08em`, fallback в `.t-button` — значения токена. Строки `SkeletonText` без скругления —
  закрыто. `.t-button` CSS — закрыто. Сброс шрифтов в SSR-тесте — закрыто. Остались открытыми, по желанию: радиус
  заглушки кнопки в `SkeletonHeroCard` (`card`, а не `button`), JSDoc про стабильную ссылку `fonts`, тест смены одних
  `fonts` у memo-потребителя.

Регрессий не найдено. Без `shape` и без вложенности поведение прежнее. Changeset обновлён и соответствует diff.

### [LOW] Вложенный провайдер со своими `fonts`: на рендере реестр не учитывается
- **file:** packages/ui/src/theme/theme-provider.tsx
- **location:** `ThemeProvider`, `setActiveFonts(effective)` на рендере; `activateDeepest()` только в эффекте с `[depth, effective]`
- **problem:** правило «активны шрифты самого глубокого» соблюдается только в эффектах. На рендере провайдер
  безусловно пишет свой набор. (1) Внешний `A` перерисовался с тем же `theme`/`fonts`, а внутренний `B` отсечён
  memo-границей (`<Outer><MemoScreen/></Outer>`, внутри `MemoScreen` — `<Inner fonts={B}>`). Тогда глобально
  остаётся `A`, а эффекты не перезапускаются, потому что зависимости не изменились. Следующий локальный рендер внутри
  поддерева `B` получит шрифты `A`. (2) Сосед внутреннего провайдера под внешним (`<Outer fonts=A><Inner fonts=B/><Y/></Outer>`)
  рендерится после поддерева `Inner` и получает `B`, а после коммита `B` остаётся активным для всего процесса.
- **why_it_matters:** это ограничение глобального набора шрифтов. Вложенность «тёмный участок» без своих `fonts`
  (сценарий M1) после фикса корректна, затронут только вложенный провайдер с другими шрифтами. JSDoc обещает
  «активны шрифты самого глубокого смонтированного», но в случаях (1) и (2) это не так.
- **evidence:** `setActiveFonts(effective);` на рендере; эффект `}, [depth, effective]);` не перезапускается при
  повторном рендере с теми же значениями.
- **recommended_fix:** на рендере писать шрифты, только если нет смонтированной записи глубже (`[...mounted].some(e =>
  e.depth > depth)`), или вызывать `activateDeepest()` ещё и в эффекте без зависимостей. В JSDoc явно указать, что
  вложенный провайдер со своими `fonts` меняет шрифты всего процесса (соседи вне поддерева тоже), либо dev-warning
  при `fonts` у вложенного.

## Итог pass 2
M1 и M2 закрыты корректно, CRITICAL/HIGH нет → **APPROVE**.
