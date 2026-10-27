import { Inject, Injectable, Logger } from '@nestjs/common';
import { CLOCK, type Clock } from '@rkarakulov/api-kit/core';

import { NOTIFICATIONS_POLICY } from './notifications.policy';
import { type NotificationPosition, NotificationsRepository } from './notifications.repository';
import { DEVICE_NOT_REGISTERED, PUSH_SENDER, type PushSender } from './push-sender';

/**
 * Квитанции Expo (`notifications.receipts`, каждые 15 мин): тикеты старше 15 мин пачками ≤ 1000 → `getReceipts` →
 * `DeviceNotRegistered` снимает токен; тикеты с квитанцией удаляются, ещё не готовые ждут следующего прохода (TTL 24 ч
 * уберёт), а обход идёт дальше курсором `(createdAt, _id)` — неготовая пачка не закрывает следующие. Сбой сервиса — исключение, ретрай BullMQ; повтор безопасен (снятие токена и удаление тикета идемпотентны).
 */
@Injectable()
export class PushReceipts {
  private readonly logger = new Logger(PushReceipts.name);

  constructor(
    private readonly repository: NotificationsRepository,
    @Inject(PUSH_SENDER) private readonly sender: PushSender,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  async check(): Promise<{ checked: number; unregistered: number }> {
    const now = this.clock.now();
    const before = new Date(now.getTime() - NOTIFICATIONS_POLICY.receiptsAfterMs);
    let checked = 0;
    let unregistered = 0;
    let after: NotificationPosition | null = null;
    for (let batch = 0; batch < NOTIFICATIONS_POLICY.receiptsMaxBatches; batch += 1) {
      const tickets = await this.repository.dueTickets(
        before,
        now,
        NOTIFICATIONS_POLICY.receiptsBatch,
        after,
      );
      if (tickets.length === 0) break;
      const receipts = await this.sender.receipts(tickets.map((ticket) => ticket.ticketId));
      const done = tickets.filter((ticket) => receipts.has(ticket.ticketId));
      // снимок квитанции — токен и владелец на момент отправки; токен, перешедший к другому аккаунту, не снимается
      const dead = new Map(
        done
          .filter((ticket) => {
            const receipt = receipts.get(ticket.ticketId);
            return receipt?.status === 'error' && receipt.error === DEVICE_NOT_REGISTERED;
          })
          .map((ticket) => [ticket.tokenId, { _id: ticket.tokenId, userId: ticket.userId }]),
      );
      unregistered += await this.repository.deleteTokens([...dead.values()]);
      await this.repository.deleteTickets(done.map((ticket) => ticket._id));
      checked += done.length;
      // неполная пачка — всё просмотрено; иначе следующая — после последнего просмотренного
      const last = tickets.at(-1);
      if (!last || tickets.length < NOTIFICATIONS_POLICY.receiptsBatch) break;
      after = { createdAt: last.createdAt, id: last._id };
    }
    if (checked > 0) {
      this.logger.log(`notifications.receipts checked=${checked} unregistered=${unregistered}`);
    }
    return { checked, unregistered };
  }
}
