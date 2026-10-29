# «Поделиться» с картинкой файлом

- Уровень: task2 (приложение `apps/app`, аддитивно `@pokatim/api-client`; контракты и API без изменений)
- Ветка: `feature/share-with-image` → PR в `develop`
- Основание: жалоба — PWA, Chrome на Android, страница маршрута → Telegram: пришла только ссылка (превью ссылки
  мессенджер не построил или взял из кэша).

## 1. Цель

Кнопки «Поделиться» (маршрут, кофе-райд, билет на событие) отправляют вместе с текстом и ссылкой OG-PNG страницы
1200×630 файлом: в Telegram и др. приходит фото с подписью и ссылкой независимо от кэша превью ссылки. Где файлы с
текстом недоступны — прежнее поведение (ссылка; без Web Share — копирование).

## 2. Что было

- `lib/share-link.web.ts` → `navigator.share({ title, text, url })`, без Web Share — `clipboard.writeText(url)`.
- `lib/share-link.ts` (native) → `Share.share({ title, message: text + url, url })`.
- OG-картинки рендерит API (og-images, ADR-0018): `GET /v1/og/cards/<kind>/<id>` → `{ version }`,
  `GET /v1/og/images/<kind>/<id>/<version>.png`; виды `race | ride | route | calendar`. Клиентских методов в
  `api-client` не было (версию брал только SSR через `lib/og-image.ts`).
- Образец подготовки файла заранее — `features/sharing/card-panel.tsx` + `lib/share-story(.web).ts` (RC-13).

## 3. Решения

| # | Решение | Почему |
|---|---|---|
| D1 | `api-client`: `getOgCard(kind, id)` (публичный GET, схема `OgCardMeta`) и `ogImageUrl(kind, id, version)` (без запроса). Контракты и API не меняются. | Ручки уже есть; версию считает только API (правило `pokatim-app.md`). |
| D2 | `features/sharing/use-share-image.ts` — TanStack Query `['share-image', kind, id]`: версия → PNG → `ShareImage`; `retry: false`, `staleTime` 60 с. Пока не готово / ошибка / 404 / офлайн / платформа без файлов — `undefined`, кнопка не ждёт и не блокируется, ошибок на экране нет. | «Загрузка упала или не успела — фолбэк на ссылку без блокировки». |
| D3 | Развилка платформ — файлами `lib/share-image(.web).ts`: web — `fetch` → `File('pokatim.png', image/png)`, готовим только при `navigator.canShare`; native — `File.downloadFileAsync` в кэш (`og-<вид>-<id>-<версия>.png`). | Как `share-story(.web).ts`. |
| D4 | Web: `shareLink({ …, image })` — синхронно в обработчике (до любого `await`); `canShare({ files })` → `share({ files: [file], title, text: \`${text}\n${url}\` })` (Android Chrome с файлами игнорирует `url`); иначе `share({ title, text, url })`; без Web Share — копирование. | RC-13: жест пользователя теряется после `await`. |
| D5 | Native: только iOS — `Share.share({ title, message: \`${text}\n${url}\`, url: fileUri })`. Android — прежняя ссылка (картинку не грузим). | См. 8.2. |
| D6 | Виды: маршрут — `route`, кофе-райд — `ride`, билет — `race`/`calendar` (`eventOgKind`, `unknown` — без картинки). Рендер OG райда не трогаем: нет картинки (404) — ссылка. | Все места `shareLink`. |

## 4. Acceptance

- AC1 Web с `canShare({ files })`: в `navigator.share` — `files: [PNG]`, `title`, `text` = текст + `\n` + ссылка.
- AC2 Web без поддержки файлов (`canShare` нет или `false`) — `share({ title, text, url })`; без Web Share — копирование.
- AC3 `navigator.share` вызывается синхронно в обработчике нажатия.
- AC4 Картинка не загрузилась (404, сеть) или ещё грузится — «Поделиться» работает ссылкой, ошибок на экране нет.
- AC5 iOS — файл в `url`, ссылка в `message`; Android — как раньше.
- AC6 Маршрут, райд и билет передают картинку своего вида; версия — от API.

## 8. Решения в ходе работы

### 8.2 Native: файл + текст

- **iOS.** RN `Share.share` на iOS передаёт `url` и `message` в `UIActivityViewController` как два элемента; `url`
  может быть локальным `file://` — лист получает картинку и подпись (Telegram — фото с подписью). Решение:
  `Share.share({ title, message: текст + ссылка, url: fileUri })`.
- **Android.** RN `Share.share` шлёт только `text/plain` (`message`, `title`; `url` — «iOS only»), файла не
  передать. `expo-sharing` (`shareAsync(uri, { mimeType, dialogTitle })`) шлёт только файл — без подписи и ссылки:
  потеря ссылки хуже, чем нет картинки. Своего нативного модуля (`ACTION_SEND` с `EXTRA_STREAM` + `EXTRA_TEXT`) в
  MVP не пишем. Решение: на Android — прежнее поведение, картинку даже не загружаем (`shareImageSupported() = false`).
- Источник: исходники `react-native@0.88` (`Libraries/Share/Share.js`: «`url` (iOS)», Android — `message`/`title`) и
  типы `expo-sharing@58` (`SharingOptions` без текста). context7 в сессии недоступен (ошибка подключения).

## 9. Тесты

- `lib/share-link.web.test.ts`: `canShare` с файлами → файл + текст со ссылкой; синхронный вызов `share`; `canShare`
  `false`/нет → ссылка; без Web Share → копирование.
- `lib/share-link.test.ts`: iOS с картинкой — файл в `url`, ссылка в `message`.
- `lib/share-image(.web).test.ts`: подготовка файла, поддержка платформы, отказ при ошибке загрузки.
- `__tests__/route-detail.test.tsx`: версия от API → PNG заранее → картинка в `shareLink`; 404 картинки → ссылка без
  ошибок на экране. `__tests__/ride-detail.test.tsx`: картинка вида `ride`.
- `features/tickets/ticket-format.test.ts`: `eventOgKind`. `api-client/src/sharing.test.ts`: `getOgCard`, `ogImageUrl`.

## 12. Outcome

- Сделано по D1–D6; контракты, API и рендер OG не менялись.
- Проверки: см. PR (`pnpm check`).
- Риски: PNG ещё не отрендерен — API отдаёт бренд-PNG (`no-store`), уйдёт бренд-картинка с текстом и ссылкой; на
  Android native картинки нет (8.2); ручная проверка Android Chrome → Telegram — после деплоя на dev.
