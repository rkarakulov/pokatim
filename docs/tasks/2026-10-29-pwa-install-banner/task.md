# Плашка «Установить приложение» (PWA) и инструкция для iOS

## 1. Title

pwa-install-banner — в web-версии приложения (`apps/app`, Expo Router web/PWA): плашка установки на Главной,
инструкция установки для iOS и промо по ссылке. Образец — WebTrader.

## 2. Goal

Пользователи мобильного браузера не знают, что «Покатим» можно поставить на экран «Домой» и открывать без
адресной строки. Нужна ненавязчивая плашка: на Android она открывает нативный диалог установки, на iOS
показывает инструкцию («Поделиться» → «На экран „Домой“»).

## 3. Scope

Решения автора 2026-10-29:

- **P1 Экран.** Только Главная (вкладка `index`): полоса во всю ширину под лентой, над таб-баром. Слева иконка
  приложения и текст-ссылка «Установить приложение», справа «×». Сезонный декор живёт в области ленты, плашка —
  вне её и не перекрывается.
- **P2 Условия показа (все сразу):** мобильный браузер (iOS/iPadOS, Android, `Mobi`); не standalone
  (`navigator.standalone` / `display-mode: standalone`); PWA не установлено: `getInstalledRelatedApps` только в
  top-level, в try/catch, до ответа — «установлено»; установка возможна: iOS — всегда, Chromium — только после
  `beforeinstallprompt` (событие отложено, `preventDefault`); сработал счётчик. Фича-флага нет (механизма нет).
  Встраиваемых контейнеров (мини-аппы) у проекта нет.
- **P3 Детект iOS/iPadOS:** `/iPhone|iPad|iPod/` или `MacIntel` + `maxTouchPoints > 1`.
- **P4 Счётчик.** `localStorage` `pokatim.pwaDialog` (`visitsCountAfterClosing`, `closedTimestamp`). При старте
  `showDialog = false`. Визит — первая за загрузку страницы Главная вошедшего (явный вход и восстановление по
  cookie; гость Главную не видит). На визите `visits += 1`. Показываем при `visits >= 5` или если с
  `closedTimestamp` прошло ≥ 7 дней. «×» сохраняет `closedTimestamp = now` и `visits = 0`. Константы
  `VISITS_BEFORE_PROMPT`, `REMIND_AFTER_CLOSE_MS = 7 * MS_IN_DAY`.
- **P5 Нажатие.** iOS → инструкция. Иначе → `deferredPrompt.prompt()`; событие одноразовое. Аналитики в проекте
  нет.
- **P6 Инструкция iOS** — шторка снизу: шапка `header.png`, заголовок, шаг 1, картинка `share-button-26` /
  `-old`, шаг 2, картинка `footer-26` / `-old`. Для Safari iOS 26+ — `_26`. Safari — `AppleWebKit` без
  `CriOS|FxiOS|OPiOS|EdgiOS`, версия из `Version/N`. «×», затемнение и Esc закрывают окно, счётчик не меняется.
- **P7 Промо `?show-pwa-modal`.** Параметр убирается через `replaceState`, состояние истории сохраняется. Окно по
  центру: шапка, заголовок, текст, кнопка «Установить» — то же действие, что нажатие на плашку. Счётчик
  игнорируется; P2 проверяется, кроме «мобильный браузер». Ссылка ведёт на Главную, поэтому промо видит только
  вошедший.
- **P8 Только web.** `install-banner.tsx` (native) → `null`; всё остальное — `.web` и чистые модули. SSR и гидрация
  без плашки и окон: условия читаются в эффекте. Закрытый RN-web `Modal` рендерит портал, а на SSR портала быть не
  может, поэтому окна монтируются только открытыми.

Тексты (`pwaInstall.*`, `packages/i18n/src/ru.ts`): «Установить приложение», «Закрыть», «Установите Покатим на
iPhone», «1. Нажмите «Поделиться» в панели браузера», «2. Выберите «На экран „Домой“»», «Установите приложение»,
промо-текст, «Установить». Язык — только `ru` (единственная локаль).

## 4. Out of Scope

- Перерисовка картинок под бренд «Покатим»: в репо лежат картинки WebTrader как есть, замена — только файлов.
- `related_applications` в manifest для точного `getInstalledRelatedApps` (нужен абсолютный URL от `WEB_ORIGIN`).
  Сейчас Chromium не шлёт `beforeinstallprompt` установленному PWA, поэтому плашки и так нет.
- Аналитика клика (в проекте её нет).

## 5. Architecture / Placement

- Фича `apps/app/src/features/pwa-install/`:
  - `install-prompt-state.ts` — чистый счётчик;
  - `install-platform.ts` — чистые детекты и выбор картинок;
  - `install-store.web.ts` — zustand-стор. Слушатели `beforeinstallprompt` / `appinstalled` вешаются при загрузке
    модуля в браузере, потому что событие приходит раньше монтирования Главной. Там же `localStorage`,
    `getInstalledRelatedApps` и `?show-pwa-modal`;
  - `install-banner(.web).tsx` — плашка и окна;
  - `install-modal.web.tsx` — окно на RN `Modal` с поверхностью шторки темы (`sheetSurface`);
  - `install-close-button.tsx`, `install-images.ts`.
- Картинки — `apps/app/assets/images/pwa-install/` (kebab-case), иконка плашки — `/icons/icon-192.png` из
  manifest.
- Иконка `close` (`xmark` / `close`) — `components/icon.tsx`.
- Переиспользуем `sheetSurface` (`components/bottom-sheet-props.ts`), `Button` и `textStyle` из `@rkarakulov/ui`, роли
  темы (`surface.*`, `border.subtle`, `overlay.scrim`, `text.primary`) и `size` / `space` / `stroke`. Сама
  `BottomSheet` не подходит: это шторка поверх карты без модальности.

## 6. PWA-готовность (проверено до кода)

Ничего добавлять не нужно, всё уже есть:

- manifest `/manifest.webmanifest` (API-маршрут): `name`, `short_name`, иконки 192/512 и maskable, `start_url`,
  `display: standalone`;
- `<link rel="manifest">`, `apple-touch-icon` и `apple-mobile-web-app-capable` в `+html.tsx`;
- service worker `/sw.js` (только production).

## 7. Test Matrix

| Что | Где |
|---|---|
| Счётчик: 5 визитов, 7 дней (fake timers), сброс «×», `showDialog=false` при старте, битое хранилище | `install-prompt-state.test.ts` |
| Детект iOS/iPadOS, мобильный, standalone, версия Safari, `ios26` / `legacy` | `install-platform.test.ts` |
| SSR пусто; iOS 26 / 17 → нужные картинки; «×» плашки и инструкции; 7 дней; standalone; десктоп; Android только после `beforeinstallprompt` + `prompt()`; установлено; `?show-pwa-modal` | `install-banner.web.test.tsx` |
| Браузер: production-сборка, мобильная эмуляция (iPhone Safari 26 и 17, Android Chrome, standalone) | VERIFY, pr.md |

## 8. Acceptance

- Lint, typecheck, `arch:check`, jest приложения и i18n зелёные; CI зелёный.
- В браузере: iPhone — плашка → шторка с правильными картинками; Android — плашка только после
  `beforeinstallprompt`; standalone — плашки нет; SSR Главной без ошибок гидрации.
- Реальная установка на устройство — NOT VERIFIED (вне эмуляции).

## 8.2 Решение пользователя 2026-10-29 (после #107)

Пользователь открыл dev с iPhone и не увидел плашку: до первого показа нужно было 5 визитов. Решение:

- **P1′ Экраны.** Главная вошедшего (как было) и гостевой лендинг `/welcome`. На лендинге полоса стоит внизу экрана,
  под прокруткой.
- **P4′ Счётчик.** Показываем с первого визита, счётчика визитов нет. После «×» — пауза 7 дней
  (`REMIND_AFTER_CLOSE_MS`), без условия «5 визитов после закрытия». В `pokatim.pwaDialog` хранится только
  `closedTimestamp`. Старое значение с `visitsCountAfterClosing` читается, поле отбрасывается.
- **Визит** — первая за загрузку страницы Главная вошедшего или лендинг гостя. Гость, который вошёл в той же
  вкладке, второго визита не даёт.
- **Промо `?show-pwa-modal`** работает и на `/welcome`. Плашка под окном промо может быть видна — это допустимо.
- Остальные условия (P2, P3, P5–P8) не меняются.

Тесты:

- `install-prompt-state.test.ts` — первый визит, 7 дней, старое значение хранилища;
- `install-banner.web.test.tsx` — первый визит, «×» меньше 7 дней назад;
- `landing-screen.web.test.tsx` — SSR лендинга без плашки, гость на iPhone видит её после монтирования.
