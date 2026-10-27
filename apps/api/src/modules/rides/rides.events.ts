import { z } from 'zod';

/*
 * События кофе-райдов (ADR-0017): пишутся в транзакции условной записи райда; потребитель — `notifications`, маршрут
 * объявляет он (`notificationsOutboxRoutes`). Только id и время — без названий, `userId` и id жалоб (RC-3).
 */

export const RideEventPayload = z.object({ rideId: z.uuid() });
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
