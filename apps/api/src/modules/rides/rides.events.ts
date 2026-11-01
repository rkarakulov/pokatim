import { z } from 'zod';

/*
 * События кофе-райдов (ADR-0017): пишутся в транзакции условной записи райда; потребитель — `notifications`, маршрут
 * объявляет он (`notificationsOutboxRoutes`). Только id и время — без названий, `userId` и id жалоб (RC-3).
 */

/**
 * `seq` — `noticeSeq` райда после записи события (порядок схлопывания уведомлений, N7); у событий до него и у отмены
 * поля нет.
 */
export const RideEventPayload = z.object({
  rideId: z.uuid(),
  seq: z.number().int().nonnegative().optional(),
});
export type RideEventPayload = z.infer<typeof RideEventPayload>;

/** Райд отменён: организатором или при удалении его аккаунта (`RideErasure`, только опубликованные — RC-8). */
export const RIDES_RIDE_CANCELLED = 'rides.ride-cancelled';
/** Перенос времени, города или места старта при других участниках (`rescheduledAt` поставлен этой правкой). */
export const RIDES_RIDE_RESCHEDULED = 'rides.ride-rescheduled';
/** Новый участник «Я иду» (идемпотентный повтор — без события). */
export const RIDES_PARTICIPANT_JOINED = 'rides.participant-joined';

/** Модерация закрыла открытые жалобы райда («Скрыть», «Отклонить жалобы»): авторы — по `resolvedAt` (RC-3). */
export const RIDES_REPORTS_RESOLVED = 'rides.reports-resolved';
export const RidesReportsResolved = z.object({ rideId: z.uuid(), resolvedAt: z.iso.datetime() });
export type RidesReportsResolved = z.infer<typeof RidesReportsResolved>;

/**
 * Модератор удалил фото организатора (ride-photo-followups R10): пишется в транзакции сброса; `seq` — `noticeSeq` райда
 * после записи сброса (порядок схлопывания, N7). Без id фото и причины модератора (RC-3, N12).
 */
export const RIDES_PHOTO_RESET = 'rides.photo-reset';
export const RidesPhotoReset = z.strictObject({
  rideId: z.uuid(),
  seq: z.number().int().positive(),
});
export type RidesPhotoReset = z.infer<typeof RidesPhotoReset>;
