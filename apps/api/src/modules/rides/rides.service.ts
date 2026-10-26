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
import { uuidv7 } from '@rkarakulov/api-kit/mongo';

import { domainError } from '../../error-messages';
import { rideViewOf } from './rides-feed.service';
import type { RideDoc } from './rides.collection';
import { isReschedule, ridePhase, RIDES_POLICY, validateStartsAt } from './rides.policy';
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
    private readonly rateLimiter: RateLimiter,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

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
    if (isReschedule(current, patch)) patch.rescheduledAt = now;

    const updated = await this.repository.update(id, userId, body.version, now, patch);
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
    const cancelled = await this.repository.cancel(id, userId, body.reason, now);
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
      if (doc && doc.participants?.length) return rideViewOf(doc, userId, now);
      throw quotaExceeded('joined', RIDES_POLICY.maxUpcomingJoined);
    }
    const joined = await this.repository.join(id, userId, now);
    if (joined) return rideViewOf(joined, userId, now);
    const doc = await this.repository.findForViewer(id, userId);
    if (!doc) throw domainError('NOT_FOUND', 404);
    // уже участник (или организатор) — идемпотентный успех без двойного счёта
    if (doc.participants?.length) return rideViewOf(doc, userId, now);
    if (ridePhase(doc, now) !== 'upcoming') throw domainError('RIDE_INVALID_STATE', 409);
    throw domainError('RIDE_FULL', 409);
  }

  async leave(userId: string, id: string): Promise<RideView> {
    await this.limit('rides-rsvp', userId, RIDES_POLICY.rsvpLimit);
    const now = this.clock.now();
    const left = await this.repository.leave(id, userId, now);
    if (left) return rideViewOf(left, userId, now);
    const doc = await this.repository.findForViewer(id, userId);
    if (!doc) throw domainError('NOT_FOUND', 404);
    if (doc.organizerUserId === userId) throw domainError('RIDE_INVALID_STATE', 409);
    // не участник — идемпотентный успех
    if (!doc.participants?.length) return rideViewOf(doc, userId, now);
    throw domainError('RIDE_INVALID_STATE', 409);
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
