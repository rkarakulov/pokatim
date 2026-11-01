# Findings — route-rides-07-delete — pass 1 — reviewer: codex
base: origin/develop   commits: origin/develop..fc6a38f5
verdict: REQUEST CHANGES

### [HIGH] Автопроверка восстанавливает заезд после удаления во время обработки
- **file:** apps/api/src/modules/route-rides/route-rides.repository.ts
- **location:** deleteOwn, строки 294–298; RouteRideAutoProcessor.run/checkRoute
- **problem:** `$pull` меняет сохранённый план, но процессор продолжает обход массива `planned`, прочитанного до удаления. Перед вставкой план не перечитывается.
- **why_it_matters:** Например, повторная попытка обрабатывает маршрут A, а райдер удаляет уже созданный заезд маршрута B из того же плана. Когда процессор доходит до B, заезда уже нет, поэтому он создаёт его заново после успешного `204`. Это нарушает явно предусмотренную в Scope защиту удаления во время прогона.
- **evidence:** `RouteRideAutoProcessor.run`, строки 90–99: план читается один раз и передаётся в цикл; `checkRoute` не получает `eventId` и вызывает `insertChecked` без сверки плана. Новый тест AC5 запускает повтор только после завершения удаления и не проверяет эту гонку.
- **recommended_fix:** Передавать идентификатор события до операции вставки и проверять актуальное присутствие маршрута в плане. Сериализовать проверку плана и вставку с удалением, чтобы между ними также не оставалось гонки. Добавить интеграционный тест с приостановленной обработкой: чтение плана → удаление заезда → продолжение обработки → заезд отсутствует.

### [HIGH] Новый циклический импорт ломает completion gate
- **file:** apps/api/test/route-rides.ts
- **location:** строка 18
- **problem:** Импорт `seedActivity` из `./achievements` замыкает цикл: `achievements.ts` уже импортирует `routeRidesDb` из `./route-rides`.
- **why_it_matters:** `pnpm check` завершается с кодом 1 на `arch:check`; AC7 и completion gate не выполнены.
- **evidence:** Фактический вывод: `error no-circular: apps/api/test/achievements.ts → apps/api/test/route-rides.ts → apps/api/test/achievements.ts`. Обратный импорт находится в `apps/api/test/achievements.ts:6`.
- **recommended_fix:** Вынести `seedActivity` в подходящий тестовый модуль активностей без зависимости от `route-rides` и использовать его из обоих файлов. Повторить `pnpm check`.

Проверки: `git diff --check`, `format:check` и `lint` прошли; `arch:check` упал на указанном цикле. **NOT VERIFIED:** typecheck и тесты — выполнение `pnpm check` остановилось до этих этапов.