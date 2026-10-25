import { z } from 'zod';

import { QUEUE } from '../../queues';

/** Нужно отправить письмо со ссылкой подтверждения. В payload — только id ссылки. */
export const VERIFICATION_EMAIL_REQUESTED = 'identity.verification-email-requested';

export const VerificationEmailRequested = z.object({ verificationTokenId: z.uuid() });
export type VerificationEmailRequested = z.infer<typeof VerificationEmailRequested>;

/** Нужно отправить письмо со ссылкой сброса пароля. В payload — только id ссылки: ни токена, ни e-mail. */
export const PASSWORD_RESET_EMAIL_REQUESTED = 'identity.password-reset-email-requested';

/** Пароль сменён по ссылке — уведомить владельца (без ссылки с токеном). Id — использованной ссылки. */
export const PASSWORD_CHANGED_EMAIL_REQUESTED = 'identity.password-changed-email-requested';

export const PasswordResetEmailRequested = z.object({ passwordResetTokenId: z.uuid() });
export type PasswordResetEmailRequested = z.infer<typeof PasswordResetEmailRequested>;

export const PasswordChangedEmailRequested = z.object({ passwordResetTokenId: z.uuid() });
export type PasswordChangedEmailRequested = z.infer<typeof PasswordChangedEmailRequested>;

/** Маршруты событий identity для публикатора outbox (подключает worker.module.ts). */
export const identityOutboxRoutes = {
  [VERIFICATION_EMAIL_REQUESTED]: QUEUE.identityEmail,
  [PASSWORD_RESET_EMAIL_REQUESTED]: QUEUE.identityEmail,
  [PASSWORD_CHANGED_EMAIL_REQUESTED]: QUEUE.identityEmail,
} as const;
