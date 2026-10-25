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

/** Маршруты событий tracks для публикатора outbox (подключает worker.module.ts). */
export const tracksOutboxRoutes = {
  [TRACK_UPLOAD_RECEIVED]: QUEUE.trackProcessing,
} as const;
