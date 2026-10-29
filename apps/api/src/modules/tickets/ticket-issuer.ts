import { Inject, Injectable } from '@nestjs/common';
import type { TicketEventKind } from '@pokatim/contracts';
import { ENV } from '@rkarakulov/api-kit/core';
import { isDuplicateKey, MongoOutboxWriter, uuidv7 } from '@rkarakulov/api-kit/mongo';

import type { Env } from '../../config/env';
import { type DbSession, MongoTransactions } from '../../db';
import { qrHashOf, ticketQrToken } from './ticket-qr';
import type { TicketCategoryDoc, TicketDoc } from './tickets.collection';
import { TICKETS_ISSUED, type TicketsIssued } from './tickets.events';
import { generateTicketCode, TICKETS_POLICY } from './tickets.policy';
import { TicketsRepository } from './tickets.repository';

export interface IssueInput {
  kind: TicketEventKind;
  eventId: string;
  registrationId: string;
  userId: string;
  category: TicketCategoryDoc | null;
  now: Date;
}

/** Выпуск в транзакции вызывающего (передаётся в колбэк `inTransaction`). */
export type IssueTicket = (tx: DbSession, input: IssueInput) => Promise<TicketDoc>;

/**
 * Выпуск билета (event-tickets): uuidv7, случайный код, `qrHash` (токен — HMAC от id, в БД не хранится), письмо
 * `pending` и outbox `tickets.issued` — в транзакции выпуска. Дубль кода (`tickets_code_unique`, 50 бит) — вся
 * транзакция заново с новым кодом, не больше трёх раз.
 */
@Injectable()
export class TicketIssuer {
  constructor(
    private readonly repository: TicketsRepository,
    private readonly transactions: MongoTransactions,
    private readonly outbox: MongoOutboxWriter,
    @Inject(ENV) private readonly env: Pick<Env, 'EMAIL_TOKEN_SECRET'>,
  ) {}

  /** Транзакция с выпуском: колбэк получает `issue`; дубль кода — повтор колбэка в новой транзакции. */
  async inTransaction<T>(work: (tx: DbSession, issue: IssueTicket) => Promise<T>): Promise<T> {
    for (let attempt = 1; ; attempt += 1) {
      try {
        return await this.transactions.run((tx) =>
          work(tx, (session, input) => this.issue(session, input)),
        );
      } catch (error) {
        if (
          !isDuplicateKey(error, 'tickets_code_unique') ||
          attempt >= TICKETS_POLICY.issueAttempts
        ) {
          throw error;
        }
      }
    }
  }

  private async issue(tx: DbSession, input: IssueInput): Promise<TicketDoc> {
    const id = uuidv7();
    const doc: TicketDoc = {
      _id: id,
      code: generateTicketCode(),
      qrHash: qrHashOf(ticketQrToken(this.env.EMAIL_TOKEN_SECRET, id)),
      kind: input.kind,
      eventId: input.eventId,
      registrationId: input.registrationId,
      userId: input.userId,
      category: input.category,
      status: 'active',
      checkedInAt: null,
      checkedInBy: null,
      cancelledAt: null,
      email: { state: 'pending', claimedUntil: null, sentAt: null },
      createdAt: input.now,
      version: 0,
    };
    await this.repository.insertTicket(tx, doc);
    const payload: TicketsIssued = { ticketId: id };
    await this.outbox.append(tx, { type: TICKETS_ISSUED, payload });
    return doc;
  }
}
