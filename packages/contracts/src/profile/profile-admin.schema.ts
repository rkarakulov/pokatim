import { z } from 'zod';

import { ActionReason } from '../admin/members.schema.ts';

/**
 * `POST /v1/admin/profiles/:userId/name-reset` (`profiles.moderate`, profile-02): сброс публичного имени райдера
 * модератором. Причина — в журнал действий; само имя туда не пишется (ПДн).
 */
export const ResetRiderNameRequest = z.strictObject({ reason: ActionReason });
export type ResetRiderNameRequest = z.infer<typeof ResetRiderNameRequest>;

/** `reset: false` — имени уже не было (идемпотентный успех, записи журнала нет; D2). */
export const RiderNameResetResult = z.object({ reset: z.boolean() });
export type RiderNameResetResult = z.infer<typeof RiderNameResetResult>;
