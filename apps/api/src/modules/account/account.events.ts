import { z } from 'zod';

import { QUEUE } from '../../queues';

/** Аккаунт удалён (транзакция удаления) — фоновая очистка данных модулей. В payload — только id пользователя. */
export const ACCOUNT_DELETION_REQUESTED = 'account.deletion-requested';
export const AccountDeletionRequested = z.object({ userId: z.uuid() });
export type AccountDeletionRequested = z.infer<typeof AccountDeletionRequested>;

/**
 * Повторный проход очистки (R5): ставится первым проходом с задержкой и регламентом resume. Дедупликация BullMQ по
 * `account-sweep:<userId>` (свой jobId с `:` BullMQ не принимает).
 */
export const ACCOUNT_DELETION_SWEEP_JOB = 'account.deletion-sweep';
export const AccountDeletionSweep = z.object({ userId: z.uuid() });
export type AccountDeletionSweep = z.infer<typeof AccountDeletionSweep>;

/** Регламент: повторный проход удалённым без завершённой очистки (финальный провал не застревает навсегда). */
export const ACCOUNT_ERASURE_RESUME_JOB = 'account.erasure-resume';

export const sweepDeduplicationId = (userId: string) => `account-sweep:${userId}`;

/** Маршруты событий account для публикатора outbox (подключает worker.module.ts). */
export const accountOutboxRoutes = {
  [ACCOUNT_DELETION_REQUESTED]: QUEUE.accountDeletion,
} as const;
