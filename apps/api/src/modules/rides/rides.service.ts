import { Inject, Injectable, Logger } from '@nestjs/common';
import type {
  CancelRideRequest,
  CreateRideRequest,
  FieldErrorCode,
  RateLimitedDetails,
  RideQuotaDetails,
  RideView,
  UpdateRideRequest,
  ValidationErrorDetails,
} from '@pokatim/contracts';
import { CLOCK, type Clock, RateLimiter } from '@rkarakulov/api-kit/core';
import { MongoOutboxWriter, uuidv7 } from '@rkarakulov/api-kit/mongo';

import { type DbSession, MongoTransactions } from '../../db';
import { domainError } from '../../error-messages';
import { RideReportsRepository } from './ride-reports.repository';
import { rideViewOf } from './rides-feed.service';
import type { RideDoc } from './rides.collection';
import {
  RIDES_PARTICIPANT_JOINED,
  RIDES_RIDE_CANCELLED,
  RIDES_RIDE_RESCHEDULED,
  type RideEventPayload,
} from './rides.events';
import { changesStart, ridePhase, RIDES_POLICY, validateStartsAt, visibleTo } from './rides.policy';
import { type RidePatch, RidesRepository } from './rides.repository';

const fieldFailure = (path: string, code: FieldErrorCode) => {
  const details: ValidationErrorDetails = { fields: [{ path, code }] };
  return domainError('VALIDATION_FAILED', 400, details);
};

const quotaExceeded = (quota: RideQuotaDetails['quota'], limit: number) => {
  const details: RideQuotaDetails = { quota, limit };
  return domainError('RIDE_QUOTA_EXCEEDED', 409, details);
};

/** Поля правки, которые сравниваются со значением документа (неизменённые не пишутся). */
const PATCH_FIELDS = [
  'title',
  'organizerName',
  'description',
  'cityCode',
  'place',
  'distanceKm',
  'paceMinKmh',
  'paceMaxKmh',
  'limit',
] as const;

/**
 * Мутации кофе-райдов: создание, правка, отмена организатором и участие. Права и инварианты — атомарные операции
 * `RidesRepository`; здесь — лимиты частоты, квоты, окно времени старта и классификация отказов по свежему чтению.
 * Логи — id райда и пользователя, без UGC-текста.
 */
@Injectable()
export class RidesService {
  private readonly logger = new Logger(RidesService.name);

  constructor(
    private readonly repository: RidesRepository,
    private readonly reports: RideReportsRepository,
    private readonly rateLimiter: RateLimiter,
    private readonly transactions: MongoTransactions,
    private readonly outbox: MongoOutboxWriter,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  /**
   * Условная запись райда (одна операция над документом, как раньше) в транзакции с событием outbox (ADR-0016 п. 6):
   * событие — только если запись прошла и `emit` её признал.
   */
  private writeWithEvent(
    type: string,
    write: (tx: DbSession) => Promise<RideDoc | null>,
    emit: (doc: RideDoc) => boolean = () => true,
  ): Promise<RideDoc | null> {
    return this.transactions.run(async (tx) => {
      const doc = await write(tx);
      if (doc && emit(doc)) {
        const payload: RideEventPayload = { rideId: doc._id };
        await this.outbox.append(tx, { type, payload });
      }
      return doc;
    });
  }

  private async limit(
    kind: 'rides-create' | 'rides-manage' | 'rides-rsvp',
    userId: string,
    rule: { limit: number; windowSec: number },
  ): Promise<void> {
    const result = await this.rateLimiter.consume(`${kind}:${userId}`, rule, this.clock.now());
    if (!result.allowed) {
      const details: RateLimitedDetails = { retryAfterSec: result.retryAfterSec };
      throw domainError('RATE_LIMITED', 429, details);
    }
  }

  async create(userId: string, body: CreateRideRequest): Promise<RideView> {
    await this.limit('rides-create', userId, RIDES_POLICY.createLimit);
    const now = this.clock.now();
    const startsAt = new Date(body.startsAt);
    const startError = validateStartsAt(startsAt, now);
    if (startError) throw fieldFailure('startsAt', startError);
    if (
      (await this.repository.countUpcomingOrganized(userId, now)) >=
      RIDES_POLICY.maxUpcomingOrganized
    ) {
      throw quotaExceeded('organized', RIDES_POLICY.maxUpcomingOrganized);
    }
    const doc: RideDoc = {
      _id: uuidv7(),
      status: 'published',
      organizerUserId: userId,
      organizerName: body.organizerName,
      title: body.title,
      description: body.description,
      startsAt,
      cityCode: body.cityCode,
      place: body.place,
      distanceKm: body.distanceKm,
      paceMinKmh: body.paceMinKmh,
      paceMaxKmh: body.paceMaxKmh,
      limit: body.limit,
      participants: [{ userId, joinedAt: now }],
      goingCount: 1,
      cancelReason: null,
      cancelledAt: null,
      rescheduledAt: null,
      createdAt: now,
      updatedAt: now,
      version: 0,
      hiddenAt: null,
      hiddenFromStatus: null,
      openReportCount: 0,
      lastReportAt: null,
    };
    await this.repository.insert(doc);
    this.logger.log(`rides.created ride=${doc._id} uid=${userId}`);
    return rideViewOf(doc, userId, now);
  }

  async update(userId: string, id: string, body: UpdateRideRequest): Promise<RideView> {
    await this.limit('rides-manage', userId, RIDES_POLICY.manageLimit);
    const now = this.clock.now();
    const current = await this.ownRide(userId, id);
    this.assertUpcoming(current, now);
    if (current.version !== body.version) throw domainError('CONFLICT', 409);

    const patch: RidePatch = {};
    for (const field of PATCH_FIELDS) {
      const value = body[field];
      if (value !== undefined && value !== current[field]) Object.assign(patch, { [field]: value });
    }
    if (body.startsAt !== undefined) {
      const startsAt = new Date(body.startsAt);
      if (startsAt.getTime() !== current.startsAt.getTime()) {
        const startError = validateStartsAt(startsAt, now);
        if (startError) throw fieldFailure('startsAt', startError);
        patch.startsAt = startsAt;
      }
    }
    if ((patch.paceMinKmh ?? current.paceMinKmh) > (patch.paceMaxKmh ?? current.paceMaxKmh)) {
      throw fieldFailure('paceMaxKmh', 'RIDE_PACE_ORDER');
    }
    if (patch.limit !== undefined && patch.limit !== null && patch.limit < current.goingCount) {
      throw fieldFailure('limit', 'RIDE_LIMIT_BELOW_GOING');
    }
    const reschedule = changesStart(current, patch);
    // перенос при других участниках: `rescheduledAt` поставила именно эта запись
    const updated = await this.writeWithEvent(
      RIDES_RIDE_RESCHEDULED,
      (tx) => this.repository.update(id, userId, body.version, now, patch, reschedule, tx),
      (doc) => reschedule && doc.rescheduledAt?.getTime() === now.getTime(),
    );
    if (!updated) {
      // условие фильтра не выполнено между чтением и записью: причину — по свежему документу
      const fresh = await this.ownRide(userId, id);
      this.assertUpcoming(fresh, now);
      if (fresh.version !== body.version) throw domainError('CONFLICT', 409);
      throw fieldFailure('limit', 'RIDE_LIMIT_BELOW_GOING');
    }
    this.logger.log(`rides.updated ride=${id} uid=${userId}`);
    return rideViewOf(updated, userId, now);
  }

  async cancel(userId: string, id: string, body: CancelRideRequest): Promise<RideView> {
    await this.limit('rides-manage', userId, RIDES_POLICY.manageLimit);
    const now = this.clock.now();
    // повторная отмена фильтр не проходит — без второго события
    const cancelled = await this.writeWithEvent(RIDES_RIDE_CANCELLED, (tx) =>
      this.repository.cancel(id, userId, body.reason, now, tx),
    );
    if (cancelled) {
      this.logger.log(`rides.cancelled ride=${id} uid=${userId}`);
      return rideViewOf(cancelled, userId, now);
    }
    const fresh = await this.ownRide(userId, id);
    // повторная отмена — идемпотентный успех (прежняя причина остаётся)
    if (fresh.status === 'cancelled') return rideViewOf(fresh, userId, now);
    throw domainError('RIDE_INVALID_STATE', 409);
  }

  async join(userId: string, id: string): Promise<RideView> {
    await this.limit('rides-rsvp', userId, RIDES_POLICY.rsvpLimit);
    const now = this.clock.now();
    if (
      (await this.repository.countUpcomingJoined(userId, now)) >= RIDES_POLICY.maxUpcomingJoined
    ) {
      const doc = await this.repository.findForViewer(id, userId);
      if (doc) this.assertVisible(doc, userId);
      if (doc && doc.participants?.length) return this.viewOf(doc, userId, now);
      throw quotaExceeded('joined', RIDES_POLICY.maxUpcomingJoined);
    }
    // «уже участник» фильтр не проходит — без второго события
    const joined = await this.writeWithEvent(RIDES_PARTICIPANT_JOINED, (tx) =>
      this.repository.join(id, userId, now, tx),
    );
    if (joined) return this.viewOf(joined, userId, now);
    const doc = await this.repository.findForViewer(id, userId);
    if (!doc) throw domainError('NOT_FOUND', 404);
    this.assertVisible(doc, userId);
    // уже участник (или организатор) — идемпотентный успех без двойного счёта
    if (doc.participants?.length) return this.viewOf(doc, userId, now);
    if (ridePhase(doc, now) !== 'upcoming') throw domainError('RIDE_INVALID_STATE', 409);
    throw domainError('RIDE_FULL', 409);
  }

  async leave(userId: string, id: string): Promise<RideView> {
    await this.limit('rides-rsvp', userId, RIDES_POLICY.rsvpLimit);
    const now = this.clock.now();
    const left = await this.repository.leave(id, userId, now);
    if (left) return this.viewOf(left, userId, now);
    const doc = await this.repository.findForViewer(id, userId);
    if (!doc) throw domainError('NOT_FOUND', 404);
    this.assertVisible(doc, userId);
    if (doc.organizerUserId === userId) throw domainError('RIDE_INVALID_STATE', 409);
    // не участник — идемпотентный успех
    if (!doc.participants?.length) return this.viewOf(doc, userId, now);
    throw domainError('RIDE_INVALID_STATE', 409);
  }

  /**
   * Скрытый райд (05b, 8.1 A5) — первой проверкой после чтения, до идемпотентных веток: чужому и участнику — 404
   * (существование не раскрывается), организатору — 409 `RIDE_INVALID_STATE`.
   */
  private assertVisible(doc: RideDoc, userId: string): void {
    if (!visibleTo(doc, userId)) throw domainError('NOT_FOUND', 404);
    if (doc.status === 'hidden') throw domainError('RIDE_INVALID_STATE', 409);
  }

  /** Ответ участия: `reported` — по жалобам зрителя. */
  private async viewOf(doc: RideDoc, userId: string, now: Date): Promise<RideView> {
    return rideViewOf(doc, userId, now, await this.reports.exists(doc._id, userId));
  }

  /** Свой райд организатора; чужой и неизвестный — 404 (не 403: существование чужого не раскрывается). */
  private async ownRide(userId: string, id: string): Promise<RideDoc> {
    const doc = await this.repository.findForViewer(id, userId);
    if (!doc || doc.organizerUserId !== userId) throw domainError('NOT_FOUND', 404);
    return doc;
  }

  private assertUpcoming(doc: RideDoc, now: Date): void {
    if (ridePhase(doc, now) !== 'upcoming') throw domainError('RIDE_INVALID_STATE', 409);
  }
}
