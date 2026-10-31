import { Inject, Injectable } from '@nestjs/common';
import type { AttendanceVia } from '@pokatim/contracts';
import { CLOCK, type Clock } from '@rkarakulov/api-kit/core';

import { type DbSession, MongoTransactions } from '../../db';
import { domainError } from '../../error-messages';
import { PRODUCT_EVENTS, type ProductEvents } from '../product-events';
import { RIDES_FOR_SOCIAL, type RidesForSocial, type SocialRideFacts } from '../rides';
import { AttendanceRepository } from './attendance.repository';
import { ConnectionsRepository } from './connections.repository';
import { attendanceCheck, rideConnectionDiff, SOCIAL_POLICY, socialBlocked } from './social.policy';

type AttendanceWrite = (
  tx: DbSession,
  rideId: string,
  userId: string,
  now: Date,
) => Promise<boolean>;

/**
 * Явка на райде (K2, RC-2a, RC-3a) и пересчёт связей `ride`. Каждое изменение — одна транзакция: условная запись в
 * документ явки райда (конфликт сериализует параллельные отметки) → чтение явившихся → разница с парами райда →
 * запись связей → события. Повтор той же операции не меняет состояние и событий не пишет; `removedAt` пересчёт не
 * трогает. Отказы: райда нет — `404 NOT_FOUND`, иначе `409 SOCIAL_ACTION_BLOCKED` (`attendanceCheck`).
 */
@Injectable()
export class SocialAttendanceService {
  constructor(
    private readonly attendance: AttendanceRepository,
    private readonly connections: ConnectionsRepository,
    private readonly transactions: MongoTransactions,
    @Inject(RIDES_FOR_SOCIAL) private readonly rides: RidesForSocial,
    @Inject(PRODUCT_EVENTS) private readonly events: ProductEvents,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  /** «Я был на райде» (K2): участник «Иду» или организатор, от старта до +7 дней. `true` — явка изменилась. */
  markManual(userId: string, rideId: string): Promise<boolean> {
    return this.change(userId, rideId, 'manual', (tx, ride, user, now) =>
      this.attendance.markManual(tx, ride, user, now),
    );
  }

  /** «Меня не было» (RC-3a): снимает любую явку в окне ручной правки и закрывает автоявку. */
  unmark(userId: string, rideId: string): Promise<boolean> {
    return this.change(userId, rideId, 'manual', (tx, ride, user, now) =>
      this.attendance.decline(tx, ride, user, now),
    );
  }

  /** Явка по треку (P5): без окна ручной правки; запись с `declinedAt` не перекрывает. */
  markByTrack(userId: string, rideId: string): Promise<boolean> {
    return this.change(userId, rideId, 'track', (tx, ride, user, now) =>
      this.attendance.markByTrack(tx, ride, user, now),
    );
  }

  private async change(
    userId: string,
    rideId: string,
    via: AttendanceVia,
    write: AttendanceWrite,
  ): Promise<boolean> {
    const now = this.clock.now();
    const facts = await this.rides.rideFacts(rideId, now);
    if (!facts) throw domainError('NOT_FOUND', 404);
    const reason = attendanceCheck(facts, userId, now, via);
    if (reason) throw socialBlocked(reason);
    return this.transactions.run(async (tx) => {
      if (!(await write(tx, rideId, userId, now))) return false;
      const attendees = await this.attendance.attendees(rideId, tx);
      await this.recalculate(tx, facts, attendees, now);
      if (attendees.includes(userId)) {
        await this.events.record({ type: 'attendance-marked', userId, props: { via } }, tx);
      }
      return true;
    });
  }

  /** Связи `ride` райда по явившимся (`rideConnectionDiff`); события — по созданным документам. */
  private async recalculate(
    tx: DbSession,
    facts: SocialRideFacts,
    attendees: readonly string[],
    now: Date,
  ): Promise<void> {
    const existing = await this.connections.pairsOfRide(facts.rideId, tx);
    const diff = rideConnectionDiff(attendees, existing);
    if (diff.add.length === 0 && diff.remove.length === 0) return;
    const created = await this.connections.applyRideDiff(
      tx,
      facts.rideId,
      facts.startsAt,
      diff,
      now,
      SOCIAL_POLICY.bulkBatch,
    );
    for (const pair of created) {
      await this.events.record(
        { type: 'connection-created', userId: pair.ownerId, props: { source: 'ride' } },
        tx,
      );
    }
  }
}
