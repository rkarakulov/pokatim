# Хеллоуинский декор поверх темы (halloween-decor)

Уровень: task2. Ветка `feature/halloween-overlay` → `develop`.

## 1. Цель

Сезонный декор приложения райдера (пауки, паутина, тыквы, ведьма, луна) — отдельный слой поверх активной темы
(показ — в «Классике»), который команда включает и выключает в панели одним действием, без релиза.

## 2. Решение (рычаг)

- Настройка `decor` в том же синглтоне `platform_settings/appearance`, что и тема (ADR-0016): `'none' | 'halloween'`,
  нет поля — `'none'`. Публичный `GET /v1/appearance` → `{ themeId, decor }`; старый клиент лишний ключ игнорирует,
  новый клиент без ключа / с незнакомым значением → `'none'`.
- `PUT /v1/admin/appearance` принимает `{ version, themeId?, decor? }` (хотя бы одно поле); общая `version`
  (оптимистичная блокировка). Смена декора — запись журнала `appearance.decor_changed` (`decorFrom/decorTo`).
- Панель «Оформление приложения»: блок «Сезонный декор» с одной кнопкой «Включить хеллоуинский декор» /
  «Выключить хеллоуинский декор» (одно нажатие = PUT); текущее состояние — текстом.
- Приложение: тот же запрос `['appearance']`; декор — только после монтирования (SSR и первый кадр гидрации без
  декора — рассинхрона нет); native — после ответа сервера (кэша нет: выключение применяется при следующем запросе).

## 3. Слой в приложении

- `features/decor/`: `HalloweenDecor` (native — `react-native-svg` через `useSvgLib`; web — inline SVG), таблица
  `DECOR_LAYER: Record<AppDecorId, компонент | null>`, хук `useAppDecor()`.
- Слой `absoluteFill`, `pointerEvents="none"`, скрыт от скринридеров (`importantForAccessibility`,
  `accessibilityElementsHidden`, `aria-hidden`). Элементы — по краям экрана, полупрозрачные: паутина в углу,
  паук на нити, луна с ведьмой, тыквы внизу; контент не перекрывают по центру.
- Цвета — только роли темы (`text.*`, `status.warning/success`, `surface.*`), без hex.
- Анимации: паук покачивается, ведьма пролетает; reduce motion (или неизвестно) — статично. Web — CSS
  `@media (prefers-reduced-motion: reduce)`.
- Показ: Главная (`(tabs)/index.tsx`). Таб-бар и `TopBar` не трогаем (параллельные сессии).

## 4. Критерии приёмки

- AC1 `decor` по умолчанию `none`; PUT `{decor:'halloween',version}` → публичный ответ `decor:'halloween'`, журнал.
- AC2 PUT без `themeId` и `decor` — 400; повтор того же значения — без записи.
- AC3 Панель: одна кнопка переключает декор; 409 — общий баннер конфликта.
- AC4 Приложение: `decor:'halloween'` → слой на Главной; `none` / ошибка / незнакомое — слоя нет.
- AC5 Слой: `pointerEvents none`, скрыт от a11y; SSR-рендер без слоя; reduce motion — без анимации.

## 5. Security checklist

- AuthN/AuthZ: PUT — тот же `PanelGuard` + `appearance.manage` (только admin); публичный GET — `PublicReadGuard`.
- Входные данные: `strictObject`, `decor` — enum, `themeId`/`decor` необязательны, но хотя бы одно; в `$set` — только
  значения после zod; операторы (`{ $ne: null }`) — 400 (int-тест).
- Данные наружу: публично — только `{ themeId, decor }`, без `version`, `updatedAt`, автора.
- Злоупотребления: IP-лимит `public-read`; панель — только сотрудники.
- Секреты и логи: лог — только «тема/декор → тема/декор», без id сотрудника.
- Аудит: `appearance.decor_changed` (`decorFrom/decorTo`) в транзакции действия, append-only.

## 8. Статус

- [x] UNDERSTAND / SPEC / PLAN
- [x] IMPLEMENT  - [x] VERIFY  - [x] REVIEW  - [ ] FINISH

## 10. Documentation Sync

`.claude/rules/pokatim-app.md` (декор, `react-native-svg` в `decor-svg`), `pokatim-backend.md` (ответ `{ themeId, decor }`,
тело PUT, журнал), `pokatim-db.md` (поле `decor?`), `pokatim-web.md` (блок «Сезонный декор»).

## 12. Evidence

- `TURBO_CONCURRENCY=1 pnpm check` (изолированные Mongo/Redis): 12/13 задач зелёные; `@pokatim/api#test` — 3 таймаута
  в `results-revisions.int.test.ts` под нагрузкой (параллельно шли jest-прогоны); файл отдельно — 6/6. Остальные
  1454 теста API зелёные, включая `appearance-*.int.test.ts`.
- Ревью `independent-reviewer` pass 1 — APPROVE (CRITICAL 0 / HIGH 0 / LOW 3): LOW-1 (живые таймеры анимации в тесте)
  и LOW-2 (ведьма на web через `left`) исправлены, LOW-3 — этот раздел.
- Не проверено: живой вид на iOS/Android-устройстве (симулятор не запускался).

## 9. Не делаем

Новая тема / правка палитры; декор на других экранах; расписание включения по датам; кэш декора на native.
