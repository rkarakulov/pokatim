import { Inject, Injectable, Logger } from '@nestjs/common';
import { CLOCK, type Clock, MAILER, type Mailer } from '@rkarakulov/api-kit/core';

import { IdentityAccounts } from '../identity';
import { renderNotificationEmail } from './notification-email';
import { NOTIFICATIONS_POLICY } from './notifications.policy';
import { NotificationsRepository } from './notifications.repository';

export type EmailOutcome = 'sent' | 'skipped' | 'failed';

/**
 * Письмо уведомления (`notifications.email`, N2), по образцу `link-email.handler.ts`: захват `pending` (или истёкшего
 * `sending`) одним `findOneAndUpdate` → адрес `IdentityAccounts.emailsOf` в момент отправки (удалённый — `skipped`) →
 * `MAILER` → `sent`. Повтор отправленного — пропуск; живой чужой захват — ретрай BullMQ; сбой SMTP снимает захват,
 * последняя попытка — `failed`. Тихие часы письма не задерживают. В логах — id, без адреса.
 */
@Injectable()
export class EmailDelivery {
  private readonly logger = new Logger(EmailDelivery.name);

  constructor(
    private readonly repository: NotificationsRepository,
    private readonly identity: IdentityAccounts,
    @Inject(MAILER) private readonly mailer: Mailer,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  async deliver(notificationId: string, { final }: { final: boolean }): Promise<EmailOutcome> {
    const now = this.clock.now();
    const claimedUntil = new Date(now.getTime() + NOTIFICATIONS_POLICY.deliveryLeaseMs);
    const claim = await this.repository.claimEmail(notificationId, now, claimedUntil);
    if (!claim) return 'skipped';
    if (claim.status === 'busy') {
      throw new Error(`notification email ${notificationId}: send in progress`);
    }
    const { doc } = claim;
    const to = (await this.identity.emailsOf([doc.userId])).get(doc.userId);
    if (!to) {
      await this.repository.settleEmail(notificationId, claimedUntil, { state: 'skipped' });
      return 'skipped';
    }
    try {
      await this.mailer.send({ to, ...renderNotificationEmail(doc) });
    } catch (error) {
      await this.repository.settleEmail(notificationId, claimedUntil, {
        state: final ? 'failed' : 'pending',
      });
      if (final) this.logger.error(`notifications.email_failed id=${notificationId}`);
      throw error;
    }
    await this.repository.settleEmail(notificationId, claimedUntil, {
      state: 'sent',
      sentAt: this.clock.now(),
    });
    this.logger.log(`notifications.email_sent id=${notificationId} uid=${doc.userId}`);
    return 'sent';
  }
}
