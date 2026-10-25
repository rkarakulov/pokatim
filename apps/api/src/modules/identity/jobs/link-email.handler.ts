import { Inject, Injectable, Logger } from '@nestjs/common';
import {
  CLOCK,
  type Clock,
  ENV,
  MAILER,
  type Mailer,
  type MailMessage,
} from '@rkarakulov/api-kit/core';
import { MongoOutboxReader } from '@rkarakulov/api-kit/mongo';

import type { Env } from '../../../config/env';
import { PasswordResetEmailRequested, VerificationEmailRequested } from '../identity.events';
import { IDENTITY_POLICY } from '../identity.policy';
import { IdentityRepository, type LinkKind } from '../identity.repository';
import { renderPasswordResetEmail } from '../mail/password-reset-email';
import { renderVerificationEmail } from '../mail/verification-email';
import { derivePasswordResetToken, deriveVerificationToken } from '../tokens';

export type LinkEmailOutcome = 'sent' | 'skipped';

interface LinkEmail {
  /** id ссылки из payload события; `undefined` — payload не по схеме. */
  tokenId: (payload: unknown) => string | undefined;
  /** Путь экрана ссылки в приложении и вывод токена из id ссылки. */
  path: string;
  derive: (secret: string, id: string) => string;
  render: (input: { link: string }) => Omit<MailMessage, 'to'>;
}

const LINK_EMAILS: Record<LinkKind, LinkEmail> = {
  verification: {
    tokenId: (payload) => VerificationEmailRequested.safeParse(payload).data?.verificationTokenId,
    path: 'auth/verify/',
    derive: deriveVerificationToken,
    render: renderVerificationEmail,
  },
  passwordReset: {
    tokenId: (payload) => PasswordResetEmailRequested.safeParse(payload).data?.passwordResetTokenId,
    path: 'auth/reset/',
    derive: derivePasswordResetToken,
    render: renderPasswordResetEmail,
  },
};

/**
 * Письмо со ссылкой (подтверждение e-mail, сброс пароля). Ссылка пересобирается из id ссылки (HMAC) — ретрай даёт
 * ту же ссылку. Заменённая, использованная, истёкшая ссылка, удалённый (для подтверждения — и уже подтверждённый)
 * аккаунт — письмо не нужно. Одно письмо на ссылку: отправку захватывает атомарный `findOneAndUpdate` с ограниченным
 * сроком (`sendClaimedAt`), факт отправки — `sentAt` после ответа SMTP. Повтор отправленного — пропуск; параллельная
 * доставка и живой захват упавшего worker — ретрай BullMQ; сбой SMTP снимает захват. Остаточный риск
 * (at-least-once): SMTP принял письмо, а worker упал до записи `sentAt` — по истечении захвата уйдёт дубль с той же
 * ссылкой.
 */
@Injectable()
export class LinkEmailHandler {
  private readonly logger = new Logger(LinkEmailHandler.name);

  constructor(
    private readonly repository: IdentityRepository,
    private readonly outbox: MongoOutboxReader,
    @Inject(MAILER) private readonly mailer: Mailer,
    @Inject(ENV) private readonly env: Env,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  async handle(kind: LinkKind, outboxEventId: string): Promise<LinkEmailOutcome> {
    const email = LINK_EMAILS[kind];
    const tokenId = email.tokenId(await this.outbox.payloadOf(outboxEventId));
    if (!tokenId) {
      this.logger.warn(`event ${outboxEventId}: no valid payload, skipped`);
      return 'skipped';
    }
    const now = this.clock.now();
    const claim = await this.repository.claimLinkSend(
      kind,
      tokenId,
      now,
      IDENTITY_POLICY.emailSendLeaseMs,
    );
    if (!claim) return 'skipped';
    // другой worker отправляет прямо сейчас (или упал с живым захватом) — ретрай BullMQ с backoff
    if (claim.status === 'busy') {
      throw new Error(`${kind} email for event ${outboxEventId}: send in progress`);
    }

    const token = email.derive(this.env.EMAIL_TOKEN_SECRET, claim.id);
    const mail = email.render({ link: `${this.env.APP_LINK_BASE}${email.path}${token}` });
    try {
      await this.mailer.send({ to: claim.email, ...mail });
    } catch (error) {
      await this.repository.releaseLinkSend(kind, claim.id, now);
      throw error;
    }
    await this.repository.completeLinkSend(kind, claim.id, now, this.clock.now());
    this.logger.log(`${kind} email sent for event ${outboxEventId}`);
    return 'sent';
  }
}
