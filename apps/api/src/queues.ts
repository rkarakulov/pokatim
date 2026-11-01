/**
 * Имена очередей BullMQ: `{ имя: 'kebab-name' }`. Задачи обязаны быть идемпотентными — ретрай не должен
 * дублировать эффект (jobId = id события outbox, повторная отправка письма — проверка по состоянию в БД).
 */
export const QUEUE = {
  /** Разбор исходника загрузки в worker_threads (tracks-devices): jobId = id события outbox. */
  trackProcessing: 'track-processing',
  /** Разбор GPX маршрута коридора в worker_threads (race-results-01): jobId = id события outbox. */
  routeProcessing: 'route-processing',
  /**
   * Регламент маршрутов (routes-03): бэкфилл производных данных готовых маршрутов (профиль высоты, очищенный GPX) по
   * росту `ROUTE_DERIVED_VERSION` — по расписанию, при старте worker и продолжением полной пачки (RC-13).
   */
  routesMaintenance: 'routes-maintenance',
  /** Регламент треков: уборка отбракованных исходников и файлов без документа. */
  tracksMaintenance: 'tracks-maintenance',
  /** Синхронизация устройств через агрегатор: pull, история, отзыв подключения, надгробия удалённых загрузок. */
  devicesSync: 'devices-sync',
  /** Регламент устройств: расписание pull, уборка неподтверждённых подключений, сверка с агрегатором. */
  devicesMaintenance: 'devices-maintenance',
  /**
   * Письма модуля identity: подтверждение e-mail, ссылка сброса пароля, «Пароль изменён». Один процессор разбирает
   * задачи по имени (BullMQ раздаёт задачи очереди любому процессору); jobId = id события outbox.
   */
  identityEmail: 'identity-email',
  /** Регламентные задачи identity по расписанию (очистка неподтверждённых). */
  identityMaintenance: 'identity-maintenance',
  /**
   * Приём попыток гонок (race-results-03): события `tracks.activity-ready/-removed` и `results.entry-created` →
   * попытки заявок; jobId = id события outbox.
   */
  resultsIntake: 'results-intake',
  /** Сверка попытки с коридором (`analyzeAttempt` в потоке разбора): jobId = id события outbox. */
  attemptCheck: 'attempt-check',
  /** Регламент результатов: повторная постановка зависших проверок. */
  resultsMaintenance: 'results-maintenance',
  /**
   * Ряды пульса и мощности для разбора спора (race-results-06b, `analyzeSeries` в потоке разбора): итог — кэш Redis с
   * TTL; дедупликация — ключ постановки в Redis (`DisputeSeriesCache`), не jobId.
   */
  disputeSeries: 'dispute-series',
  /**
   * Фоновая очистка удалённого аккаунта (account-deletion, ADR-0015): событие `account.deletion-requested` (jobId = id
   * события outbox), повторный проход `account.deletion-sweep` (дедупликация `account-sweep:<userId>`) и регламент
   * `account.erasure-resume`. Один процессор разбирает задачи по имени.
   */
  accountDeletion: 'account-deletion',
  /**
   * Приём событий для уведомлений (ADR-0017): события outbox модулей-источников → уведомления получателям; jobId = id
   * события outbox, повтор не дублирует (уникальный `(sourceEventId, userId)`).
   */
  notificationsIntake: 'notifications-intake',
  /**
   * Доставка уведомлений: `notifications.push` — по пользователю (jobId `push-<userId>-<notBeforeMs>`, с задержкой до
   * конца тихих часов), `notifications.email` — по уведомлению (jobId `email-<id>`). Состояние доставки — в документе
   * уведомления (захват), повтор не шлёт второй push или письмо.
   */
  notificationsDelivery: 'notifications-delivery',
  /** Регламент уведомлений: квитанции Expo (`DeviceNotRegistered` снимает токен), перепостановка зависших доставок. */
  notificationsMaintenance: 'notifications-maintenance',
  /**
   * Рейтинг сезона (race-results-08, standings-outbox-events): события `results.protocol-published`/`result-revised`
   * (сезон гонки) и регламент-страховка сверки отпечатков каждые 15 мин и при старте worker; пересчёт изменившихся
   * сезонов целиком (запись снимка под условием версии).
   */
  standingsRecalc: 'standings-recalc',
  /**
   * Рендер карточки для сторис (story-cards, satori + resvg): итог — PNG в Redis с TTL 24 ч по капабилити-токену;
   * дедупликация — ключ постановки NX по хэшу входов (`StoryCardCache`), jobId `story-card-<hash>` — вторая линия.
   */
  storyCard: 'story-card',
  /**
   * Пререндер OG-картинок публичных страниц (og-images, DV-1): `og.sync` каждую минуту и при старте worker, без
   * событий outbox — изменившиеся публичные объекты по курсорам `updatedAt` → задачи `og-card.render` очереди
   * `story-card` (NX по хэшу); параллелизм по умолчанию (1).
   */
  ogSync: 'og-sync',
  /**
   * Сверка заезда по маршруту вне гонки (route-rides-01, `analyzeAttempt` в потоке разбора): jobId = id события outbox
   * `route-rides.check-requested`, параллелизм 1.
   */
  routeRideCheck: 'route-ride-check',
  /**
   * Приём событий `route-rides` (fan-out outbox, ADR-0017 п. 5): `tracks.activity-removed` → удаление заездов активности
   * по всем маршрутам; jobId = id события outbox, повтор удаляет 0. Отдельно от `route-ride-check` — не ждёт сверок.
   */
  routeRidesIntake: 'route-rides-intake',
  /**
   * Автопроверка новой активности по маршрутам (route-rides-03): событие outbox `tracks.activity-group-created`
   * (маршрут объявляет `route-rides`), jobId = id события; одна задача на активность — до 20 прогонов движка
   * последовательно, параллелизм 1, отдельно от `route-ride-check` (ручная проверка не ждёт за автопроверкой).
   * Сбой окружения — ретрай всей задачи; на последней попытке маршрут тихо пропускается (лог), остальные проверяются.
   */
  routeRideAuto: 'route-ride-auto',
  /**
   * Письмо «Вы зарегистрированы» (event-tickets): событие outbox `tickets.issued` (jobId = id события); одно письмо на
   * билет — захват состояния письма в документе билета (RC-T11).
   */
  ticketsEmail: 'tickets-email',
  /**
   * Регламент билетов (event-tickets): сверка билетов гонок с заявками каждую минуту и при старте worker, без событий
   * outbox (`results.*` маршрутизированы в `results-intake`).
   */
  ticketsMaintenance: 'tickets-maintenance',
  /**
   * Письма панели «Протокол» (panel-invitations, ADR-0026): приглашение в команду и письма о выдаче, смене и снятии
   * роли; jobId = id события outbox, один процессор разбирает задачи по имени. Дубль безвреден (та же ссылка, тот же
   * текст); провал письма-приглашения виден в блоке «Приглашения» (`emailState`).
   */
  panelEmail: 'panel-email',
  /**
   * Серверная сверка достижений (achievements-push N2, ADR-0020): регламент `achievements.sweep` каждую минуту и при
   * старте worker, без событий outbox — райдеры изменившихся фактов по курсорам портов владельцев (Redis
   * `achievements:cursor:<source>`) → задачи `achievements.rider` (jobId `ach-rider-<uid>-<прогонMs>`, 3 попытки) →
   * `AchievementsReconciler.reconcile(uid, 'server')`; прогоны — по одному (замок-аренда Redis, курсоры пишет владелец).
   */
  achievementsSync: 'achievements-sync',
  /**
   * Приём событий «Свои» (ADR-0027, P5–P7): `tracks.activity-ready` → автоявка (fan-out с `results-intake`),
   * `identity.account-confirmed` → связь `invite`; jobId = id события outbox, повтор идемпотентен (явка и связи —
   * условные записи).
   */
  socialIntake: 'social-intake',
  /**
   * Регламент «Свои» (P5): `social.ride-ask` раз в 30 мин и при старте worker — «Как прошёл райд?» через 4 ч после
   * старта (захват `askedAt`, отправка — P7); без событий outbox.
   */
  socialMaintenance: 'social-maintenance',
} as const;
