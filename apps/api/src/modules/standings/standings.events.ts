import { QUEUE } from '../../queues';
import { RESULTS_PROTOCOL_PUBLISHED, RESULTS_RESULT_REVISED } from '../results';

/**
 * Подписка рейтинга сезона на события протокола (standings-outbox-events, ADR-0017 п. 5): тип → `standings-recalc`;
 * те же типы слушает `notifications` — fan-out (`mergeOutboxRoutes`, `src/outbox-routes.ts`).
 */
export const standingsOutboxRoutes = {
  [RESULTS_PROTOCOL_PUBLISHED]: QUEUE.standingsRecalc,
  [RESULTS_RESULT_REVISED]: QUEUE.standingsRecalc,
} as const;
