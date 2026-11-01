import { Inject, Injectable } from '@nestjs/common';
import { CLOCK, type Clock, isDomainError } from '@rkarakulov/api-kit/core';

import { IdentityAccounts } from '../identity';
import { RIDES_FOR_SOCIAL, type RidesForSocial } from '../rides';
import { ACTIVITY_STARTS, type ActivityStarts, type TrackActivityReady } from '../tracks';
import { SocialAttendanceService } from './attendance.service';
import { autoAttendanceCheck, SOCIAL_POLICY } from './social.policy';

/** Итог автоявки по событию активности. */
export type AutoAttendanceOutcome =
  'marked' | 'unchanged' | 'no_activity' | 'not_cycling' | 'user_deleted' | 'no_rides';

/**
 * Автоявка по заезду (K2, P5, ADR-0027 п. 4): `tracks.activity-ready` → старт основной группы **сейчас** (порт
 * `ACTIVITY_STARTS`; `userId` payload не используется) → только `cycling` → живость владельца (RC-P5-6) → райды
 * участника по окну старта (`RIDES_FOR_SOCIAL.ridesOfParticipant`) → `autoAttendanceCheck` → `markByTrack` (P0,
 * транзакция явки и связей) по каждому подходящему. Райд сменил состояние после чтения (`404`/`409`) — пропуск
 * (RC-P5-5), остальные ошибки — ретрай задачи. Идемпотентно: повтор и новое событие той же группы — no-op без событий.
 */
@Injectable()
export class AutoAttendanceIntake {
  constructor(
    @Inject(ACTIVITY_STARTS) private readonly activityStarts: ActivityStarts,
    @Inject(RIDES_FOR_SOCIAL) private readonly rides: RidesForSocial,
    private readonly accounts: IdentityAccounts,
    private readonly attendance: SocialAttendanceService,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  async handle(event: Pick<TrackActivityReady, 'activityId'>): Promise<AutoAttendanceOutcome> {
    const start = await this.activityStarts.primaryStart(event.activityId);
    if (!start) return 'no_activity';
    if (start.sport !== 'cycling') return 'not_cycling';
    const live = await this.accounts.liveUserIds([start.userId]);
    if (!live.has(start.userId)) return 'user_deleted';
    const now = this.clock.now();
    const { beforeMs, afterMs } = SOCIAL_POLICY.autoAttendance;
    // «старт заезда ∈ [старт райда − before; + after]» — как окно по старту райда
    const rides = await this.rides.ridesOfParticipant(
      start.userId,
      new Date(start.startedAt.getTime() - afterMs),
      new Date(start.startedAt.getTime() + beforeMs),
      now,
    );
    if (rides.length === 0) return 'no_rides';
    let marked = false;
    for (const ride of rides) {
      if (autoAttendanceCheck(ride, start, start.userId, now) !== null) continue;
      try {
        if (await this.attendance.markByTrack(start.userId, ride.rideId)) marked = true;
      } catch (error) {
        if (isDomainError(error) && (error.status === 404 || error.status === 409)) continue;
        throw error;
      }
    }
    return marked ? 'marked' : 'unchanged';
  }
}
