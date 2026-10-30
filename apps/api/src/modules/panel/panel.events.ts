import { z } from 'zod';

import { QUEUE } from '../../queues';

/**
 * Письмо-приглашение (ADR-0026): пишется в транзакции приглашения; jobId задачи = id события. Без захвата отправки —
 * дубль письма даёт ту же ссылку (токен — HMAC от id) и безвреден; итог письма — `emailState` приглашения.
 */
export const PANEL_INVITATION_EMAIL_REQUESTED = 'panel.invitation-email-requested';
export const PanelInvitationEmailRequested = z.object({ invitationId: z.uuid() });
export type PanelInvitationEmailRequested = z.infer<typeof PanelInvitationEmailRequested>;

/**
 * Письмо о выдаче, смене или снятии роли: пишется в транзакции действия; payload — только id записи журнала (адрес —
 * в момент отправки через порт identity, без e-mail в outbox).
 */
export const PANEL_ROLE_EMAIL_REQUESTED = 'panel.role-email-requested';
export const PanelRoleEmailRequested = z.object({ auditId: z.uuid() });
export type PanelRoleEmailRequested = z.infer<typeof PanelRoleEmailRequested>;

/** Маршруты outbox модуля (composition root — `worker.module.ts`). */
export const panelOutboxRoutes = {
  [PANEL_INVITATION_EMAIL_REQUESTED]: QUEUE.panelEmail,
  [PANEL_ROLE_EMAIL_REQUESTED]: QUEUE.panelEmail,
} as const;
