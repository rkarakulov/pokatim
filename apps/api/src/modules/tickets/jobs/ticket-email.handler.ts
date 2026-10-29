import { Inject, Injectable, Logger } from '@nestjs/common';
import { CLOCK, type Clock, ENV, MAILER, type Mailer } from '@rkarakulov/api-kit/core';
import { MongoOutboxReader } from '@rkarakulov/api-kit/mongo';

import type { Env } from '../../../config/env';
import { IdentityAccounts } from '../../identity';
import { renderTicketEmail } from '../mail/ticket-email';
import { MaterialsRead } from '../materials-read';
import { TicketEvents } from '../ticket-events';
import { TicketsIssued } from '../tickets.events';
import { TICKETS_POLICY } from '../tickets.policy';
import type { TicketDoc } from '../tickets.collection';
import { TicketsRepository } from '../tickets.repository';

export type TicketEmailOutcome = 'sent' | 'skipped';

/** Письмо сейчас отправляет другой захват — повторить после `until` (процессор откладывает задачу). */
export class TicketEmailBusyError extends Error {
  constructor(
    ticketId: string,
    readonly until: Date,
  ) {
    super(`ticket email ${ticketId}: send in progress`);
  }
}

/**
 * Письмо «Вы зарегистрированы» (RC-T11, по образцу `EmailDelivery`): захват `email.state` `pending` (или истёкшего
 * `sending`) одним `findOneAndUpdate` → адрес `IdentityAccounts.emailsOf` в момент отправки (удалённый — `skipped`) →
 * `MAILER` → `sent`. Повтор отправленного — пропуск; живой чужой захват — ретрай BullMQ; сбой SMTP снимает захват,
 * любой сбой после захвата снимает свой захват (`pending`), последняя попытка — `failed` (видно в списке участников панели) и лог `tickets.email_failed`. Отменённый к отправке
 * билет и событие — `skipped`. В логах — id, без адреса.
 */
@Injectable()
export class TicketEmailHandler {
  private readonly logger = new Logger(TicketEmailHandler.name);

  constructor(
    private readonly repository: TicketsRepository,
    private readonly events: TicketEvents,
    private readonly materials: MaterialsRead,
    private readonly identity: IdentityAccounts,
    private readonly outbox: MongoOutboxReader,
    @Inject(MAILER) private readonly mailer: Mailer,
    @Inject(ENV) private readonly env: Pick<Env, 'APP_WEB_ORIGIN'>,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  async handle(outboxEventId: string, { final }: { final: boolean }): Promise<TicketEmailOutcome> {
    const ticketId = TicketsIssued.safeParse(await this.outbox.payloadOf(outboxEventId)).data
      ?.ticketId;
    if (!ticketId) {
      this.logger.warn(`event ${outboxEventId}: no valid payload, skipped`);
      return 'skipped';
    }
    const now = this.clock.now();
    const claimedUntil = new Date(now.getTime() + TICKETS_POLICY.emailLeaseMs);
    const claim = await this.repository.claimEmail(ticketId, now, claimedUntil);
    if (!claim) return 'skipped';
    // чужой живой захват (параллельная доставка или упавший worker) — повтор после истечения захвата
    if (claim.status === 'busy') throw new TicketEmailBusyError(ticketId, claim.until);
    try {
      const outcome = await this.deliver(claim.doc, claimedUntil);
      if (outcome === 'sent') this.logger.log(`tickets.email_sent ticket=${ticketId}`);
      return outcome;
    } catch (error) {
      // любой сбой после захвата (чтение события, адреса, SMTP) снимает свой захват: ретрай не ждёт срока захвата
      await this.repository.settleEmail(ticketId, claimedUntil, {
        state: final ? 'failed' : 'pending',
      });
      if (final) this.logger.error(`tickets.email_failed ticket=${ticketId}`);
      throw error;
    }
  }

  private async deliver(doc: TicketDoc, claimedUntil: Date): Promise<TicketEmailOutcome> {
    const skip = async () => {
      await this.repository.settleEmail(doc._id, claimedUntil, { state: 'skipped' });
      return 'skipped' as const;
    };
    if (doc.status === 'cancelled') return skip();
    const event = await this.events.resolve(doc.kind, doc.eventId);
    if (!event || event.state !== 'scheduled') return skip();
    const to = (await this.identity.emailsOf([doc.userId])).get(doc.userId);
    if (!to) return skip();
    const mail = renderTicketEmail({
      event,
      code: doc.code,
      category: doc.category,
      instructions: event.ticketing?.instructions ?? null,
      link: this.env.APP_WEB_ORIGIN ? `${this.env.APP_WEB_ORIGIN}/tickets/${doc.code}` : null,
      materials: await this.materials.of(doc.kind, doc.eventId),
      fileBase: this.env.APP_WEB_ORIGIN ?? null,
    });
    await this.mailer.send({ to, ...mail });
    await this.repository.settleEmail(doc._id, claimedUntil, {
      state: 'sent',
      sentAt: this.clock.now(),
    });
    return 'sent';
  }
}
