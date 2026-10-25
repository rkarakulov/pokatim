---
paths:
  - "packages/contracts/**"
  - "packages/api-client/**"
---

# pokatim — контракты (дополняет `contracts.md`)

- Структура pokatim: `src/<context>/<entity>.schema.ts` (например, `src/auth/registration.schema.ts`), публичный
  экспорт — `src/index.ts`.
- Кластеры, места, правдоподобие результата — бизнес-правила сервера: в схемах запросов их нет, клиент их
  не присылает.
- Коды ошибок pokatim добавляются в конец `defineErrorCodes` / `defineFieldErrorCodes` (`common.ts`): установленные
  приложения знают прежний состав.
- Enum-ы в **ответах приложения** (класс, покрытие, фаза, причина, дисциплина) — `tolerantEnum(values)` (`common.ts`):
  незнакомое значение — `'unknown'`, UI приложения показывает нейтральный вариант. Запросы и ответы панели — строгий
  `z.enum`. Значения справочников — только в конец. Массив кодов в ответе, где фиктивное `'unknown'` не нужно
  (ответы опроса в `ProfileView`), — неизвестные коды отбрасываются (`transform`), запрос остаётся строгим.
- Время платформы — только `src/time.ts`: `LocalDate`, `LocalTime`, `YearMonth`, `UtcMinute`, `minskWallTimeToUtc`,
  `utcToMinskWallTime`, `minskDayStartUtc`, `minskToday`, `addLocalDays`. Перевод «по месту» (`+3 ч`,
  `new Date(local)`) — нет.
- Массив фильтра в query — `queryArray(item, max)` (одна строка → массив, длина ограничена).
