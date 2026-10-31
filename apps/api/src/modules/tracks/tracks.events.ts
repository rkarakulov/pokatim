import { z } from 'zod';

import { QUEUE } from '../../queues';

/** Загрузка принята (файл или поток агрегатора) — разобрать в worker. В payload — только id загрузки. */
export const TRACK_UPLOAD_RECEIVED = 'tracks.upload-received';
export const TrackUploadReceived = z.object({ uploadId: z.uuid() });
export type TrackUploadReceived = z.infer<typeof TrackUploadReceived>;

/**
 * Загрузка провайдера удалена (пользователем или с отключением) — модуль-источник помечает свой импорт, чтобы
 * следующая синхронизация не вернула заезд. Только для `sourceRef ≠ null`; маршрут события задаёт подписчик.
 */
export const TRACK_UPLOAD_DELETED = 'tracks.upload-deleted';
export const TrackUploadDeleted = z.object({
  uploadId: z.uuid(),
  userId: z.uuid(),
  source: z.string(),
  sourceRef: z.string(),
});
export type TrackUploadDeleted = z.infer<typeof TrackUploadDeleted>;

/**
 * Активность записана (основная или дубль — состав группы мог смениться): в транзакции записи активности. Подписчик
 * читает состояние группы **сейчас** (`ActivitySource.group`), не из payload: порядок и повтор событий не важны.
 * Маршрут очереди задаёт подписчик (race-results-03: `results`).
 */
export const TRACK_ACTIVITY_READY = 'tracks.activity-ready';
export const TrackActivityReady = z.object({
  activityId: z.uuid(),
  uploadId: z.uuid(),
  userId: z.uuid(),
});
export type TrackActivityReady = z.infer<typeof TrackActivityReady>;

/**
 * Активность образовала **новую** группу дублей (route-rides-03, 8.1 AC-1/AC-2): кандидатов-дублей не было — в той же
 * транзакции записи под `lockUserActivities`, вместе с `tracks.activity-ready`. Дубль, поздний источник, перехвативший
 * основную, и дубль, ставший основным при удалении другого, события не дают. Отдельный тип: признак «новая группа»
 * известен только под замком активностей, подписчик `activity-ready`, читающий группу «сейчас», его не восстановит
 * (поздний дубль успевает перехватить основную). Маршрут очереди задаёт подписчик (`route-rides`: автопроверка).
 */
export const TRACK_ACTIVITY_GROUP_CREATED = 'tracks.activity-group-created';
export const TrackActivityGroupCreated = z.object({
  activityId: z.uuid(),
  uploadId: z.uuid(),
  userId: z.uuid(),
});
export type TrackActivityGroupCreated = z.infer<typeof TrackActivityGroupCreated>;

/**
 * Загрузка с активностью удалена: в транзакции удаления; `primaryActivityId` — основная оставшейся группы: новая
 * (удалена основная — бывший дубль) или прежняя (удалён дубль); группы не осталось — `null`. Маршрут очереди задаёт
 * подписчик.
 */
export const TRACK_ACTIVITY_REMOVED = 'tracks.activity-removed';
export const TrackActivityRemoved = z.object({
  activityId: z.uuid(),
  uploadId: z.uuid(),
  userId: z.uuid(),
  primaryActivityId: z.uuid().nullable(),
});
export type TrackActivityRemoved = z.infer<typeof TrackActivityRemoved>;

/** Маршруты событий tracks для публикатора outbox (подключает worker.module.ts). */
export const tracksOutboxRoutes = {
  [TRACK_UPLOAD_RECEIVED]: QUEUE.trackProcessing,
} as const;
