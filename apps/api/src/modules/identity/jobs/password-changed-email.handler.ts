import { Inject, Injectable, Logger } from '@nestjs/common';
import { MAILER, type Mailer } from '@rkarakulov/api-kit/core';
import { MongoOutboxReader } from '@rkarakulov/api-kit/mongo';

import { PasswordChangedEmailRequested } from '../identity.events';
import { IdentityRepository } from '../identity.repository';
import { renderPasswordChangedEmail } from '../mail/password-changed-email';

export type PasswordChangedEmailOutcome = 'sent' | 'skipped';

/**
 * Уведомление «Пароль изменён» (Q3 слайса 3). At-least-once без захвата отправки: дубль уведомления безвреден.
 * Время смены — `usedAt` ссылки. Аккаунт удалён или документа нет (каскад очистки) — пропуск.
 */
@Injectable()
export class PasswordChangedEmailHandler {
  private readonly logger = new Logger(PasswordChangedEmailHandler.name);

  constructor(
    private readonly repository: IdentityRepository,
    private readonly outbox: MongoOutboxReader,
    @Inject(MAILER) private readonly mailer: Mailer,
  ) {}

  async handle(outboxEventId: string): Promise<PasswordChangedEmailOutcome> {
    const payload = PasswordChangedEmailRequested.safeParse(
      await this.outbox.payloadOf(outboxEventId),
    );
    if (!payload.success) {
      this.logger.warn(`event ${outboxEventId}: no valid payload, skipped`);
      return 'skipped';
    }
    const found = await this.repository.findPasswordResetById(payload.data.passwordResetTokenId);
    if (!found || found.user.deletedAt || !found.token.usedAt) return 'skipped';

    await this.mailer.send({
      to: found.user.email,
      ...renderPasswordChangedEmail({ changedAt: found.token.usedAt }),
    });
    this.logger.log(`password changed email sent for event ${outboxEventId}`);
    return 'sent';
  }
}
