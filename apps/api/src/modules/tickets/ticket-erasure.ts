import { Inject, Injectable } from '@nestjs/common';
import { CLOCK, type Clock } from '@rkarakulov/api-kit/core';

import { MongoTransactions } from '../../db';
import { TicketsRepository } from './tickets.repository';

/**
 * Порт стирания `tickets` (RC-T1, ADR-0015): активные регистрации календаря удалённого → `cancelled` (с билетом и
 * местом — одна транзакция на регистрацию), активные билеты гонок → `cancelled`. Документы остаются псевдонимными
 * (как `race_entries`): счётчики мест и журнал check-in не ломаются. Повторяемо; сверка гонок удалённому не выпускает
 * (`liveUserIds`) и отменённое не «воскрешает» (уникальный `registrationId`).
 */
@Injectable()
export class TicketErasure {
  constructor(
    private readonly repository: TicketsRepository,
    private readonly transactions: MongoTransactions,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  async erase(userId: string): Promise<{ registrations: number; tickets: number }> {
    const now = this.clock.now();
    let registrations = 0;
    for (const registration of await this.repository.activeRegistrationsOf(userId)) {
      const cancelled = await this.transactions.run(async (tx) => {
        if (!(await this.repository.cancelRegistration(tx, registration._id, now))) return false;
        await this.repository.cancelTicketOfRegistration(tx, registration._id, now);
        await this.repository.releaseSeat(tx, registration.eventId);
        return true;
      });
      if (cancelled) registrations += 1;
    }
    const tickets = await this.repository.cancelRaceTicketsOf(userId, now);
    return { registrations, tickets };
  }
}
