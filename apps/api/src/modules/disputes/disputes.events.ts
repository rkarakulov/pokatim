import { DISPUTE_OUTCOMES } from '@pokatim/contracts';
import { z } from 'zod';

/*
 * События споров (race-results-06): потребитель — модуль `notifications` (A11, ADR-0016), маршрут объявляет он
 * (`notificationsOutboxRoutes`). Только id и коды — без описания, ответа, заметки и `userId` райдеров.
 */

export const DisputeEventPayload = z.object({ disputeId: z.uuid(), raceId: z.uuid() });
export type DisputeEventPayload = z.infer<typeof DisputeEventPayload>;

export const DISPUTES_DISPUTE_FILED = 'disputes.dispute-filed';
export const DISPUTES_DISPUTE_WITHDRAWN = 'disputes.dispute-withdrawn';
export const DISPUTES_DISPUTE_RESPONDED = 'disputes.dispute-responded';

/** Решение по спору: исход (шаблон и заметка — не в событии). */
export const DISPUTES_DISPUTE_DECIDED = 'disputes.dispute-decided';
export const DisputeDecidedPayload = DisputeEventPayload.extend({
  outcome: z.enum(DISPUTE_OUTCOMES),
});
export type DisputeDecidedPayload = z.infer<typeof DisputeDecidedPayload>;
