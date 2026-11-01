import { Inject, Injectable, Logger } from '@nestjs/common';
import type { RideParticipants } from '@pokatim/contracts';
import { CLOCK, type Clock, RateLimiter } from '@rkarakulov/api-kit/core';

import { domainError } from '../../error-messages';
import { consumeUserLimit } from '../../user-limit';
import {
  RIDER_NAMES,
  RIDER_PROFILES,
  type RiderNameDirectory,
  type RiderProfileDirectory,
} from '../profile';
import { RIDES_FOR_SOCIAL, type RidesForSocial, type SocialRideFacts } from '../rides';
import { AttendanceRepository } from './attendance.repository';
import { SocialAttendanceService } from './attendance.service';
import { SocialReactionsService } from './reactions.service';
import { rideParticipantsView } from './ride-participants.view';
import { SOCIAL_POLICY } from './social.policy';

/** Скрытый райд — только организатору (как `visibleTo` в `rides.policy`); фаза — из фактов `rides`. */
const visibleTo = (facts: SocialRideFacts | null, viewerId: string): facts is SocialRideFacts =>
  facts !== null && (facts.phase !== 'hidden' || facts.organizerUserId === viewerId);

/**
 * Участники райда, ручная явка зрителя (P2, K4, K5) и «Спасибо за компанию» (P4). Видимость — до вызова P0 (RC-1): нет
 * райда или скрытый не организатору — `404`; отметки — `SocialAttendanceService`, «спасибо» — `SocialReactionsService`
 * (P0, отказы `409 SOCIAL_ACTION_BLOCKED`). Лимиты `social-attendance:<uid>` и `social-thanks:<uid>` — первой
 * проверкой на каждую попытку (RC-2). Ответ мутаций — свежий `view`.
 */
@Injectable()
export class SocialRideParticipantsService {
  private readonly logger = new Logger(SocialRideParticipantsService.name);

  constructor(
    private readonly attendance: SocialAttendanceService,
    private readonly entries: AttendanceRepository,
    private readonly reactions: SocialReactionsService,
    private readonly rateLimiter: RateLimiter,
    @Inject(RIDES_FOR_SOCIAL) private readonly rides: RidesForSocial,
    @Inject(RIDER_NAMES) private readonly names: RiderNameDirectory,
    @Inject(RIDER_PROFILES) private readonly profiles: RiderProfileDirectory,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  async view(viewerId: string, rideId: string): Promise<RideParticipants> {
    const now = this.clock.now();
    const facts = await this.visibleFacts(viewerId, rideId, now);
    const [entries, cards] = await Promise.all([
      this.entries.entriesOf(rideId),
      // явившиеся — подмножество участников: одной картой и для «Ехали N»
      this.names.publicRiders(facts.participantIds),
    ]);
    const attended = entries.some(
      (entry) => entry.userId === viewerId && entry.declinedAt === null,
    );
    // «спасибо» зрителя — только для «Ехали N», т. е. при его явке
    const thanked = attended ? await this.reactions.thankedBy(viewerId, rideId) : new Set<string>();
    return rideParticipantsView(facts, entries, cards, viewerId, now, thanked);
  }

  /**
   * «Спасибо за компанию» (P4, K5): лимит → видимость (`404`) → с `publicId` — одному (`findPublic`: нет или
   * непубличный — `404`; `409 self` / `not_attended` — P0), без — «Поблагодарить всех» (`409 not_attended`). Повтор —
   * no-op. Ответ — свежий `view`.
   */
  async thank(viewerId: string, rideId: string, publicId?: string): Promise<RideParticipants> {
    const now = this.clock.now();
    await consumeUserLimit(
      this.rateLimiter,
      `social-thanks:${viewerId}`,
      SOCIAL_POLICY.thanksLimit,
      now,
    );
    await this.visibleFacts(viewerId, rideId, now);
    let added: number;
    if (publicId === undefined) {
      added = await this.reactions.thankAll(viewerId, rideId);
    } else {
      const recipient = await this.profiles.findPublic(publicId);
      if (!recipient) throw domainError('NOT_FOUND', 404);
      added = (await this.reactions.thank(viewerId, rideId, recipient.userId)) ? 1 : 0;
    }
    this.logger.log(`social.thanks ride=${rideId} uid=${viewerId} added=${added}`);
    return this.view(viewerId, rideId);
  }

  /** «Я был на райде». */
  mark(viewerId: string, rideId: string): Promise<RideParticipants> {
    return this.change('mark', viewerId, rideId);
  }

  /** «Меня не было». */
  decline(viewerId: string, rideId: string): Promise<RideParticipants> {
    return this.change('decline', viewerId, rideId);
  }

  private async change(
    action: 'mark' | 'decline',
    viewerId: string,
    rideId: string,
  ): Promise<RideParticipants> {
    const now = this.clock.now();
    await consumeUserLimit(
      this.rateLimiter,
      `social-attendance:${viewerId}`,
      SOCIAL_POLICY.attendanceLimit,
      now,
    );
    await this.visibleFacts(viewerId, rideId, now);
    const changed =
      action === 'mark'
        ? await this.attendance.markManual(viewerId, rideId)
        : await this.attendance.unmark(viewerId, rideId);
    this.logger.log(
      `social.attendance action=${action} ride=${rideId} uid=${viewerId} changed=${changed}`,
    );
    return this.view(viewerId, rideId);
  }

  private async visibleFacts(
    viewerId: string,
    rideId: string,
    now: Date,
  ): Promise<SocialRideFacts> {
    const facts = await this.rides.rideFacts(rideId, now);
    if (!visibleTo(facts, viewerId)) throw domainError('NOT_FOUND', 404);
    return facts;
  }
}
