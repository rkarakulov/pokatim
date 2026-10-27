/**
 * Порт `disputes` для модуля `notifications` (ADR-0016; через `modules/disputes/index.ts`): стороны спора — получатели
 * уведомлений. Без описания, ответа и заметки модератора (N12, D-51).
 */
export const DISPUTE_NOTICES = Symbol('DISPUTE_NOTICES');

export interface DisputeParties {
  raceId: string;
  complainantUserId: string;
  targetUserId: string;
}

export interface DisputeNotices {
  parties(disputeId: string): Promise<DisputeParties | null>;
}
