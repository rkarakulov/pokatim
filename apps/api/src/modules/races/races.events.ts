import { RACE_CANCEL_REASONS } from '@pokatim/contracts';
import { z } from 'zod';

/**
 * Гонка отменена панелью (race-cancelled): пишется в транзакции отмены после журнала; потребитель — `notifications`,
 * маршрут объявляет он (`notificationsOutboxRoutes`). Только id и код причины (отмена необратима — причину не
 * перечитывают).
 */
export const RACES_RACE_CANCELLED = 'races.race-cancelled';
export const RacesRaceCancelled = z.object({
  raceId: z.uuid(),
  reason: z.enum(RACE_CANCEL_REASONS),
});
export type RacesRaceCancelled = z.infer<typeof RacesRaceCancelled>;
