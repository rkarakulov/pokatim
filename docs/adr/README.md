# ADR — архитектурные решения

Файл: `NNNN-<slug>.md`, номера по порядку, не переиспользуются. Отменённое решение не удаляется —
статус `Superseded by NNNN`.

ADR нужен, когда решение: меняет инвариант `AGENTS.md` §4, добавляет внешний сервис или
инфраструктурный компонент, выбирает библиотеку на уровне всего проекта, расширяет рамки MVP
(push, GPS-запись, BLE и т.п.).

## Шаблон

```md
# NNNN. <Заголовок>

- Статус: Proposed | Accepted | Superseded by NNNN
- Дата: YYYY-MM-DD

## Контекст
Что вынуждает принять решение; ограничения.

## Решение
Что выбрали, коротко и однозначно.

## Альтернативы
Что рассмотрели и почему нет.

## Последствия
Плюсы, минусы, что становится сложнее, что пересмотреть и когда.
```

## Реестр

| № | Решение | Статус |
|---|---|---|
| [0001](0001-stack-and-monorepo.md) | Стек и монорепо | Accepted; частично заменён 0003 (гостевой веб) и 0007 (данные) |
| [0002](0002-registration-token.md) | Токен регистрации для входа после подтверждения e-mail | Accepted |
| [0003](0003-universal-rider-app.md) | Универсальное приложение райдера: iOS + Android + web/PWA + SSR | Accepted |
| [0004](0004-app-foundation.md) | База app-foundation: пакеты, шаблон и плагин для новых проектов | Accepted |
| [0005](0005-sign-in-and-refresh-lifecycle.md) | Вход по паролю и жизненный цикл refresh: окно повтора, reuse detection, лимиты входа | Accepted |
| [0006](0006-password-reset.md) | Сброс пароля: токен ссылки, нейтральный запрос, отзыв всех сессий, без автоматического входа | Accepted |
| [0007](0007-mongodb.md) | MongoDB вместо PostgreSQL + PostGIS: replica set, сериализация аккаунта `$inc version`, геостратегия | Accepted |
| [0008](0008-request-authorization.md) | Авторизация запросов: access JWT + живая сессия `sid`; авто-refresh access в приложении | Accepted |
| [0009](0009-admin-panel-access.md) | Доступ к панели «Протокол»: роль на аккаунте приложения, отдельная серверная сессия панели, штамп учётных данных, журнал; тот же домен `/admin/` — принятый риск | Accepted |
| [0010](0010-races-seasons-calendar.md) | Гонки по коридору, сезоны и календарь стартов: модули `races` (сезоны внутри) и `calendar`, время Минска, замок расписания, оптимистичная версия, `tolerantEnum` | Accepted |
| [0011](0011-tracks-and-devices.md) | Треки и устройства: ручная загрузка FIT/GPX (разбор в worker), импорт Garmin/Wahoo через агрегатор Open Wearables (порт, pull + Svix), активация по тикету под входом, хранилище файлов (порт), без биометрии | Accepted |
| [0012](0012-race-results.md) | Результаты гонок: коридор из маршрута `routes` + допуск, заявки и попытки, сверка по исходнику в worker (`matchCorridor`, версия алгоритма), протокол и пересчёты append-only | Proposed |
| [0013](0013-coffee-rides.md) | Кофе-райды: модуль `rides`, участники — встроенный массив и одна атомарная операция, лента под входом, публичная карточка `noindex`, город — справочник | Proposed |
| [0014](0014-maps-and-tiles.md) | Карты: MapLibre (RN + GL JS), тайлы по URL стиля из env (старт — OpenFreeMap), карта только на клиенте, коридор — ширина линии в метрах | Accepted |
| [0015](0015-account-deletion.md) | Удаление аккаунта: оркестратор `account`, порты стирания модулей, маркер стёртого e-mail (HMAC в `email`), повторный проход и регламент | Accepted |
| [0016](0016-app-themes.md) | Темы приложения: реестр в `@pokatim/design-tokens`, `AppThemeProvider` поверх базы, доставка — публичный GET, кэш native, SSR через `+middleware.ts` и `globalThis` | Accepted |
| [0017](0017-notifications-and-push.md) | Уведомления: модуль `notifications` (события outbox источников, порты получателей), push через Expo на iOS/Android (без web push), текст — снимок сервера, тихие часы, fan-out outbox — api-kit 0.6.0 (`mergeOutboxRoutes`) | Accepted |
| [0018](0018-story-cards.md) | Карточки для сторис: серверный рендер satori + resvg в worker, PNG в Redis по capability-URL, шаринг — системный лист native и Web Share API | Accepted |
| [0019](0019-rider-avatars.md) | Аватары райдеров: перекодирование `sharp` в HTTP-обработчике (ограниченное), байты в MongoDB `profile_avatars`, публичная отдача по случайному id с `immutable`, стирание при удалении аккаунта; перевыпуск id при уходе профиля из публичного доступа (profile-moderation) | Accepted |
| [0020](0020-achievements-reconcile-on-read.md) | Достижения: выдача сверкой при чтении (`GET` сверяет выдачи с фактами портов `results`/`route-rides`/`rides`), без outbox, worker и регламента; маркер первой сверки — тихая ретро-выдача | Proposed |
| [0021](0021-user-theme.md) | Личная тема райдера: `profiles.themeId`, `PUT /v1/profile/theme`, тема карточек — создателя (порт `RIDER_THEMES`), панель — только декор, SSR web из cookie через `requestHeaders()`; поправка к 0016 п. 4–5 и T1 | Accepted |
| [0022](0022-web-push.md) | Web Push в PWA: второй транспорт канала push (подписки в `push_tokens`, тот же pipeline), свой адаптер RFC 8291/8292, endpoint — только push-сервисы, VAPID из env, iOS — только установленная PWA | Accepted |
| [0023](0023-event-tickets.md) | Билеты на мероприятия: модуль `tickets` (потребитель `results`/`calendar`), билет гонки — сверкой (чтение + регламент), регистрация календаря со счётчиком мест, QR — HMAC от id (в БД хэш), check-in — условный переход + журнал, письмо через outbox | Proposed |
| [0025](0025-app-web-csp.md) | Строгий CSP web приложения: nonce на SSR-ответ (патч `@expo/router-server`, заголовок `x-pokatim-csp-nonce`), скрипты без `unsafe-inline`, стили — `unsafe-inline` (RN-web); закрывает пункт ADR-0009 | Accepted |
| [0024](0024-panel-totp.md) | 2FA (TOTP) панели: свой RFC 6238 на `node:crypto`, секрет — AES-256-GCM ключом `PANEL_TOTP_KEY`, вызов второго шага входа, коды восстановления (HMAC), «запомнить устройство» 30 дней, обязательность только для `admin` по флагу, сброс админом и CLI | Accepted |
| [0026](0026-panel-invitations.md) | Приглашения в команду панели: капабилити-ссылка (HMAC от id, в БД sha256, токен во фрагменте), принятие — шаг входа паролем без `lookup`, транзакция под замками аккаунта и приглашения; письма о выдаче, смене и снятии роли через outbox, база ссылок `PANEL_LINK_BASE` | Accepted |
| [0027](0027-social-connections.md) | «Свои»: модуль `social` (потребитель через порты), явка на райде (ручная и по второму событию `tracks`), данные зрителя — отдельные `no-store` эндпоинты, атрибуция приглашения через `identity`, имена в уведомлениях группы «Свои» при чтении, листовой журнал `product-events` | Proposed |
| [0028](0028-image-pipeline-and-ride-photos.md) | Конвейер изображений `media` (модуль-лист: сигнатура, пределы, sharp, один гейт обработки и общие слоты приёма на аватар и фото райда) и фото организатора кофе-райда: `ride_photos` у `rides`, отдача по случайному id только нескрытого райда (кэш сутки), коды `IMAGE_*`, 4a с фото под затемнением | Accepted |
