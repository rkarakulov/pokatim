/**
 * Имена очередей BullMQ: `{ имя: 'kebab-name' }`. Задачи обязаны быть идемпотентными — ретрай не должен
 * дублировать эффект (jobId = id события outbox, повторная отправка письма — проверка по состоянию в БД).
 */
export const QUEUE = {
  /** Разбор исходника загрузки в worker_threads (tracks-devices): jobId = id события outbox. */
  trackProcessing: 'track-processing',
  /** Разбор GPX маршрута коридора в worker_threads (race-results-01): jobId = id события outbox. */
  routeProcessing: 'route-processing',
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
} as const;
