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
import { RIDE_ROUTES, type RideRouteRef, type RideRoutes } from '../routes';
import { RideReportsRepository } from './ride-reports.repository';
import { lookupRoutes, rideViewOf } from './rides-feed.service';
import type { RideDoc } from './rides.collection';
import {
  RIDES_PARTICIPANT_JOINED,
  RIDES_RIDE_CANCELLED,
  RIDES_RIDE_RESCHEDULED,
  type RideEventPayload,
} from './rides.events';
import {
  changesStart,
  ridePhase,
  RIDES_POLICY,
  rideStartOf,
  validateStartsAt,
  visibleTo,
} from './rides.policy';
import { type RidePatch, RidesRepository } from './rides.repository';

const fieldFailure = (path: string, code: FieldErrorCode) => {
  const details: ValidationErrorDetails = { fields: [{ path, code }] };
  return domainError('VALIDATION_FAILED', 400, details);
};

const samePoint = (a: [number, number], b: [number, number]) => a[0] === b[0] && a[1] === b[1];

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
    @Inject(RIDE_ROUTES) private readonly rideRoutes: RideRoutes,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  /**
   * Маршрут для прикрепления (05c, 8.3 п. 1): в каталоге или свой готовый. Иначе — один ответ на «нет», «чужой
   * непубличный» и «не готов» (без оракула существования).
   */
  private async attachable(routeId: string, userId: string): Promise<RideRouteRef> {
    const route = await this.rideRoutes.attachable(routeId, userId);
    if (!route) throw fieldFailure('routeId', 'RIDE_ROUTE_UNAVAILABLE');
    return route;
  }

  /**
   * Условная запись райда (одна операция над документом, как раньше) в транзакции с событием outbox (ADR-0017 п. 6):
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
        const payload: RideEventPayload = { rideId: doc._id, seq: doc.noticeSeq ?? 0 };
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
    const route = body.routeId === null ? null : await this.attachable(body.routeId, userId);
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
      routeId: body.routeId,
      ...rideStartOf(route, body.cityCode),
    };
    await this.repository.insert(doc);
    this.logger.log(`rides.created ride=${doc._id} uid=${userId}`);
    return this.viewOf(doc, userId, now, false);
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
    await this.patchStart(userId, current, body, patch);
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
    return this.viewOf(updated, userId, now, false);
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
      return this.viewOf(cancelled, userId, now, false);
    }
    const fresh = await this.ownRide(userId, id);
    // повторная отмена — идемпотентный успех (прежняя причина остаётся)
    if (fresh.status === 'cancelled') return this.viewOf(fresh, userId, now, false);
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

  /**
   * Маршрут и точка «Рядом» правки (05c, §7.3): смена `routeId` — проверка прикрепления; точка пересчитывается при
   * смене маршрута или города и при прикреплённом маршруте без точной точки (свой маршрут стал публичным —
   * «повышение» любой правкой, RC-3). Прежний маршрут, ставший недоступным, не отклоняется — точка центра города.
   * В `patch` — только изменённое.
   */
  private async patchStart(
    userId: string,
    current: RideDoc,
    body: UpdateRideRequest,
    patch: RidePatch,
  ): Promise<void> {
    const currentRouteId = current.routeId ?? null;
    const currentPrecise = current.startPrecise ?? false;
    let route: RideRouteRef | null | undefined;
    if (body.routeId !== undefined && body.routeId !== currentRouteId) {
      route = body.routeId === null ? null : await this.attachable(body.routeId, userId);
      patch.routeId = body.routeId;
    }
    const nextRouteId = patch.routeId !== undefined ? patch.routeId : currentRouteId;
    const recompute =
      patch.routeId !== undefined ||
      patch.cityCode !== undefined ||
      (nextRouteId !== null && !currentPrecise) ||
      current.geo === undefined;
    if (!recompute) return;
    if (route === undefined) {
      route = nextRouteId === null ? null : await this.rideRoutes.attachable(nextRouteId, userId);
    }
    const next = rideStartOf(route, patch.cityCode ?? current.cityCode);
    if (!current.geo || !samePoint(current.geo.coordinates, next.geo.coordinates)) {
      patch.geo = next.geo;
    }
    if (next.startPrecise !== currentPrecise || current.startPrecise === undefined) {
      patch.startPrecise = next.startPrecise;
    }
  }

  /** Ответ мутации: маршрут — видимый организатору сейчас; `reported` — по жалобам зрителя (если не задан). */
  private async viewOf(
    doc: RideDoc,
    userId: string,
    now: Date,
    reported?: boolean,
  ): Promise<RideView> {
    const [isReported, routes] = await Promise.all([
      reported ?? this.reports.exists(doc._id, userId),
      lookupRoutes(this.rideRoutes, [doc], userId),
    ]);
    return rideViewOf(doc, userId, now, routes, isReported);
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
