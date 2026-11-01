# routes-08: название маршрута в окне публикации панели (RC-14)

Задача — `docs/tasks/2026-11-01-routes-08-publish-title/task.md`. Закрывает follow-up `docs/product/routes.md`
«Правка названия при публикации (RC-14)».

## Что сделано

- `PublishRouteInput.title?: RouteTitle` (3–120, одна строка, trim). Без поля название прежнее (T1, старые вкладки
  панели не получают 400).
- `POST /v1/admin/routes/:id/publish` пишет название тем же `updateOne`, что каталог, в транзакции с журналом:
  `route.published` / `route.catalog_updated` с `changedFields`, где есть `title`; подпись записи — новое название,
  значений в `details` нет. Повтор с тем же названием (после trim) — без записи и журнала.
- Панель: поле «Название маршрута» в окне «Опубликовать в каталоге» / «Изменить» (по умолчанию текущее), ошибки под
  полем; журнал показывает «Название».
- `docs/product/routes.md` — публикация с названием; в «Что не входит» остался скраббинг компактной карты.

## Проверки

- int `routes-catalog-admin` (AC1–AC3, откат с названием), `route.schema.test`, `RoutesScreen.test`, `AuditScreen.test`.
- Полный `pnpm check` — перед push.

## Не сделано

- Скраббинг в компактной карте панели — нужно продуктовое решение (у компактной карты нет профиля по A1 routes-05).

## Не проверено

- Вручную в панели на dev.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
