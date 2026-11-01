import { Inject, Injectable, Logger } from '@nestjs/common';
import { CLOCK, type Clock } from '@rkarakulov/api-kit/core';

import type { ChangedCursor } from '../../changed-since';
import { MongoTransactions } from '../../db';
import { IdentityAccounts } from '../identity';
import { RIDES_FOR_SOCIAL, type RidesForSocial, type SocialStartedRide } from '../rides';
import { AttendanceRepository } from './attendance.repository';
import { RIDE_ASK_DUE, type RideAskDue } from './ride-ask.port';
import { rideAskRecipients, SOCIAL_POLICY } from './social.policy';

/** Итог прогона регламента «Как прошёл райд?». */
export interface RideAskRun {
  /** райды окна, захваченные этим прогоном */
  rides: number;
  /** из них — с вызовом точки P7 (есть адресаты) */
  asked: number;
  recipients: number;
  failed: number;
}

/**
 * Регламент «Как прошёл райд?» (K10, P5, ADR-0027 п. 4): опубликованные райды со стартом в
 * `[now − askAfterMs − askCatchUpMs; now − askAfterMs]` (порт `RIDES_FOR_SOCIAL.startedRidesWithin`, полный проход
 * окна за прогон, курсор не хранится) → без уже спрошенных (`askedAmong`) → на райд транзакция: захват `askedAt`
 * (`claimAsk`; `false` — уже спрошен) → записи явки на том же снимке → адресаты `rideAskRecipients` среди живых →
 * точка P7 `RIDE_ASK_DUE.due(tx, …)`, если адресаты есть. Один раз на райд: повтор, параллельные прогоны и boot + cron —
 * без дублей (захват). Старше окна догона не спрашиваются (RC-P5-10). Сбой райда — лог, остальные идут, в конце —
 * исключение (failed-набор), следующий прогон повторит.
 */
@Injectable()
export class RideAskSweep {
  private readonly logger = new Logger(RideAskSweep.name);

  constructor(
    @Inject(RIDES_FOR_SOCIAL) private readonly rides: RidesForSocial,
    private readonly attendance: AttendanceRepository,
    private readonly accounts: IdentityAccounts,
    private readonly transactions: MongoTransactions,
    @Inject(RIDE_ASK_DUE) private readonly askDue: RideAskDue,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  async run(): Promise<RideAskRun> {
    const now = this.clock.now();
    const until = new Date(now.getTime() - SOCIAL_POLICY.askAfterMs);
    let cursor: ChangedCursor = {
      at: new Date(until.getTime() - SOCIAL_POLICY.askCatchUpMs),
      id: '',
    };
    const run: RideAskRun = { rides: 0, asked: 0, recipients: 0, failed: 0 };
    for (;;) {
      const page = await this.rides.startedRidesWithin(cursor, until, SOCIAL_POLICY.askPageRows);
      const asked = await this.attendance.askedAmong(page.rides.map((ride) => ride.rideId));
      for (const ride of page.rides) {
        if (asked.has(ride.rideId)) continue;
        try {
          const count = await this.ask(ride, now);
          if (count === null) continue;
          run.rides += 1;
          if (count > 0) run.asked += 1;
          run.recipients += count;
        } catch (error) {
          run.failed += 1;
          this.logger.error(`social.ride_ask_failed ride=${ride.rideId}`, error);
        }
      }
      if (!page.next || page.rides.length < SOCIAL_POLICY.askPageRows) break;
      cursor = page.next;
    }
    if (run.failed > 0) throw new Error(`social.ride-ask: ${run.failed} ride(s) failed`);
    return run;
  }

  /** Захват и адресаты райда; `null` — уже спрошен (параллельный прогон или раньше). */
  private async ask(ride: SocialStartedRide, now: Date): Promise<number | null> {
    const live = await this.accounts.liveUserIds(ride.participantIds);
    const participants = ride.participantIds.filter((userId) => live.has(userId));
    return this.transactions.run(async (tx) => {
      if (!(await this.attendance.claimAsk(tx, ride.rideId, now))) return null;
      const recipients = rideAskRecipients(
        participants,
        await this.attendance.entriesIn(ride.rideId, tx),
      );
      if (recipients.length > 0) {
        await this.askDue.due(tx, { rideId: ride.rideId, userIds: recipients });
      }
      return recipients.length;
    });
  }
}
