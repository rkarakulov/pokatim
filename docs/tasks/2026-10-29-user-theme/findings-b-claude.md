# Findings — user-theme (PR B, app) — pass 1 — reviewer: claude
base: origin/develop   commits: origin/develop..HEAD (8ae7b01f, 42b2936c, merge d53dbec3)
verdict: APPROVE

Проверено: выбор активной темы (сплэш native, гидрация web при `status: 'unknown'` на сервере и клиенте, выход
любым путём через `status === 'signedOut'`, включая `applyAccessRefresh` и удаление аккаунта), cookie (атрибуты
`Path=/; Max-Age; SameSite=Lax; Secure` на https, запись только в эффекте, значение — id закрытого списка; SSR
валидирует точным совпадением, в HTML — `JSON.stringify(theme.id)` из реестра, инъекции нет), SSR-безопасность
(`ssr-theme.ts`/`theme-cookie.ts` без `document`/`window` на уровне модуля), `expo-server` в клиентском бандле
(`index.js` → `runtime/api` → `scope`/`ImmutableRequest`/`error` — без `node:*`; `node:stream` только в
`utils/createReadableStreamFromReadable` и `vendor/http`, из индекса не достижимы; native-вариант
`initial-theme-id.ts` `ssr-theme` не импортирует), service worker не кэширует HTML (зависимость HTML от cookie
безопасна), мутация D4, a11y, i18n (ключи `settings.theme*`, `theme.<id>.*` есть в `ru.ts`), маршрут в
`Stack.Protected` и `app-routes.ts`, документация (pokatim-app.md, profile.md, README, ADR-0016 «Поправка»).
Таргетные тесты: `npx jest src/features/appearance src/__tests__/settings-theme.test.tsx
src/__tests__/settings-screen.test.tsx src/features/settings` — 15 наборов / 104 теста зелёные. `pnpm check`,
`pnpm e2e:web` и `E2E_API=1` — NOT VERIFIED мной (полагаюсь на отчёт в task.md; E2E_API=1 не прогонялся и автором).

CRITICAL/HIGH — нет.

### [LOW] Решение «первая смена в очереди» принимается после `await` — окно гонки
- **file:** apps/app/src/features/appearance/theme-mutation.ts
- **location:** 40-43 (`onMutate`)
- **problem:** `pendingThemeChanges(...) <= 1` и снимок `confirmed` считаются после `await cancelQueries(...)`. Если
  второй `mutate` успел перейти в `pending` за время этого `await`, обе мутации видят счётчик 2, `confirmed` остаётся
  `undefined`, и `onError` последней выходит по `confirmed.current === undefined` — отката нет.
- **why_it_matters:** при ошибке сохранения отметка и тема корня остаются на несохранённой теме (расхождение с
  сервером до следующего перезапроса профиля). На практике окно — микрозадачи (fetchProfile не слушает `signal`, cancel
  мгновенный), поэтому LOW.
- **evidence:** `await queryClient.cancelQueries(...); const current = ...; if (pendingThemeChanges(queryClient) <= 1) confirmed.current = current?.themeId;`
- **recommended_fix:** считать `pendingThemeChanges` и снимок до `await` (синхронно в начале `onMutate`), либо
  инициализировать `confirmed` из кэша, если он `undefined`.

### [LOW] `confirmed` живёт в экземпляре хука — после ухода с экрана во время сохранения откат теряется
- **file:** apps/app/src/features/appearance/theme-mutation.ts
- **location:** 30 (`useRef`), 57-63 (`onError`)
- **problem:** ушёл с «Темы» и вернулся, пока ранняя смена в полёте → новая смена создаётся новым экземпляром хука с
  `confirmed = undefined` (счётчик > 1 на `onMutate`), её `onError` отката не делает; успех ранней пишет в старый ref.
- **why_it_matters:** тот же эффект, что выше (тема без сохранения до перезапроса профиля); сценарий редкий.
- **evidence:** `const confirmed = useRef<...>(undefined);` + `if (... || confirmed.current === undefined) return;`
- **recommended_fix:** держать подтверждённую тему вне компонента (например, в `meta`/модульном `WeakMap` по
  `queryClient`) или при `undefined` откатывать к `themeId` последнего успешного ответа из кэша мутаций.

### [LOW] Описание темы не доходит до скринридера на web
- **file:** apps/app/src/features/settings/settings-row.tsx
- **location:** 79-83 (`accessibilityHint={description}`), 66-72
- **problem:** RN-web не поддерживает `accessibilityHint` (нет в `createDOMProps`), а `aria-label` = название
  перекрывает видимый текст описания внутри радио. На web описание темы скринридеру недоступно; комментарий
  «описание — подсказкой» верен только для native. Радиогруппа также без имени (`accessibilityLabel`).
- **why_it_matters:** паритет платформ (§4.13) для a11y; не блокирует — название несёт смысл.
- **evidence:** `node_modules/react-native-web/dist/modules/createDOMProps/index.js` — есть `aria-describedby`, нет
  `accessibilityHint`.
- **recommended_fix:** на web — `aria-describedby` на `nativeID` текста описания (или включить описание в label);
  `accessibilityLabel={t('settings.theme')}` у `radiogroup`.

### [LOW] Ответ PUT после выхода кладёт профиль в очищенный кэш
- **file:** apps/app/src/features/appearance/theme-mutation.ts
- **location:** 49-58 (`onSuccess`)
- **problem:** если «Выйти» нажат, пока PUT в полёте, `onSuccess` после `queryClient.clear()` создаёт `['profile']`
  прошлого райдера. Тема корня не страдает (`signedOut` → «Классика»), но при входе другим аккаунтом
  `useRideReasons`/`useOwnAvatarId` (`staleTime: Infinity`) коротко видят чужой профиль до перезапроса корневого
  наблюдателя.
- **why_it_matters:** краткий показ данных прошлой сессии; редкий сценарий.
- **evidence:** `queryClient.setQueryData(PROFILE_QUERY_KEY, view)` без проверки сессии.
- **recommended_fix:** в `onSuccess` писать в кэш только если `isSignedIn(useSessionStore.getState())` (или через
  `setQueryData` с апдейтером, не создающим запись при пустом кэше, как в `onError`).

### [LOW] Мёртвая опция `cache: false` в `fetchPublicForSsr`
- **file:** apps/app/src/lib/public-ssr.ts
- **location:** 80-84 (`PublicSsrOptions.cache`), тест `public-ssr.test.ts:110`
- **problem:** единственный вызывающий (`refreshSsrTheme`) удалён; комментарий сам говорит «сейчас таких нет».
- **why_it_matters:** лишняя ветка и тест без потребителя (в PR A по той же логике удалён `CardRadioGroup`, D1).
- **recommended_fix:** удалить опцию и её тест или явно оставить с обоснованием в 8.2.

## Разбор автора (fix)

- LOW 1 — исправлено: число смен в очереди считается до `await cancelQueries` (`theme-mutation.ts`).
- LOW 4 — исправлено: `onSuccess` не пишет профиль в кэш, очищенный выходом; тест «ответ после выхода» (без фикса — красный).
- LOW 2, 3, 5 — follow-up (не блокируют): откат при уходе с экрана во время сохранения; описание темы для скринридера на
  web и имя `radiogroup`; неиспользуемая опция `cache: false` в `public-ssr.ts`.
