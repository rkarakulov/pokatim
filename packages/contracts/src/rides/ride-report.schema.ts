import { z } from 'zod';

import { fieldError, MULTI_LINE, optionalText } from '../common.ts';

/*
 * Жалоба на кофе-райд (05b, ADR-0013 п. 7): вошедший райдер (не организатор) один раз жалуется на райд; очередь и
 * решения — в панели «Протокол» (`ride-moderation.schema.ts`).
 */

/** Причины жалобы — без свободного выбора; подписи — `domain.rideReportReason.*`. Только в конец. */
export const RIDE_REPORT_REASONS = ['spam', 'offensive', 'dangerous', 'fake', 'other'] as const;
export const RideReportReason = z.enum(RIDE_REPORT_REASONS, { error: fieldError('REQUIRED') });
export type RideReportReason = z.infer<typeof RideReportReason>;

export const RIDE_REPORT_COMMENT_MAX = 500;

/**
 * `POST /v1/rides/:id/reports` → 200 `RideView` с `viewer.reported = true`. Повтор — идемпотентный успех (комментарий
 * второй попытки не сохраняется). Комментарий необязателен, пустой — `null`.
 */
export const CreateRideReportRequest = z.strictObject({
  reason: RideReportReason,
  comment: optionalText(RIDE_REPORT_COMMENT_MAX, MULTI_LINE).optional(),
});
export type CreateRideReportRequest = z.infer<typeof CreateRideReportRequest>;
