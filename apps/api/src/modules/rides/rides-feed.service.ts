import { Inject, Injectable } from '@nestjs/common';
import {
  isCityCode,
  type RideCard,
  type RideCities,
  type RideDetail,
  type RideListQuery,
  type RidePage,
  type RideView,
} from '@pokatim/contracts';
import { CLOCK, type Clock } from '@rkarakulov/api-kit/core';
import { z } from 'zod';

import { domainError } from '../../error-messages';
import { decodeCursor, encodeCursor } from '../../page-cursor';
import { RideReportsRepository } from './ride-reports.repository';
import type { RideDoc, RidePublicDoc } from './rides.collection';
import { rideFull, ridePhase, rideViewer, visibleTo } from './rides.policy';
import { RidesRepository } from './rides.repository';

/** Публичные поля ответа — явным списком (не `...doc`): без организатора, участников, `version`, `createdAt`. */
function summaryOf(doc: RidePublicDoc, now: Date) {
  return {
    id: doc._id,
    title: doc.title,
    organizerName: doc.organizerName ?? null,
    startsAt: doc.startsAt.toISOString(),
    city: doc.cityCode,
    place: doc.place,
    distanceKm: doc.distanceKm,
    paceMinKmh: doc.paceMinKmh,
    paceMaxKmh: doc.paceMaxKmh,
    limit: doc.limit,
    goingCount: doc.goingCount,
    full: rideFull(doc),
    phase: ridePhase(doc, now),
    cancelReason: doc.cancelReason,
    rescheduledAt: doc.rescheduledAt?.toISOString() ?? null,
  };
}

export function rideDetailOf(doc: RidePublicDoc, now: Date): RideDetail {
  return { ...summaryOf(doc, now), description: doc.description };
}

/** Участник ли зритель: в документе зрителя участники — только он (`$elemMatch`), в ответе мутации — все. */
const isParticipant = (doc: RideDoc, userId: string) =>
  doc.participants?.some((participant) => participant.userId === userId) ?? false;

const viewerOf = (doc: RideDoc, userId: string, now: Date, reported: boolean) =>
  rideViewer(doc, { userId, participant: isParticipant(doc, userId) }, now, reported);

/**
 * Карточка + зритель; организатору — `version` для формы правки. `reported` — зритель уже жаловался (05b): у
 * организатора — всегда `false`.
 */
export function rideViewOf(doc: RideDoc, userId: string, now: Date, reported = false): RideView {
  const viewer = viewerOf(doc, userId, now, reported);
  const ride = rideDetailOf(doc, now);
  return {
    ride: viewer.role === 'organizer' ? { ...ride, version: doc.version } : ride,
    viewer,
  };
}

const CursorKey = z.iso.datetime();

/**
 * Чтение кофе-райдов: лента и города зависят от зрителя (роль, отменённые свои) — под `AuthGuard`, `no-store`;
 * публичная карточка — без зрителя; `me` — карточка + состояние зрителя.
 */
@Injectable()
export class RidesFeedService {
  constructor(
    private readonly repository: RidesRepository,
    private readonly reports: RideReportsRepository,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  async list(userId: string, query: RideListQuery): Promise<RidePage> {
    const cursor = query.cursor ? decodeCursor(query.cursor, CursorKey) : null;
    const now = this.clock.now();
    const docs = await this.repository.listFeed(
      userId,
      now,
      query.city,
      cursor ? { startsAt: new Date(cursor.k), id: cursor.id } : null,
      query.limit + 1,
    );
    const page = docs.slice(0, query.limit);
    const last = page.at(-1);
    const reported = await this.reports.reportedRideIds(
      userId,
      page.map((doc) => doc._id),
    );
    return {
      items: page.map((doc): RideCard => ({
        ...summaryOf(doc, now),
        viewer: viewerOf(doc, userId, now, reported.has(doc._id)),
      })),
      nextCursor:
        docs.length > query.limit && last
          ? encodeCursor(last.startsAt.toISOString(), last._id)
          : null,
    };
  }

  async cities(userId: string): Promise<RideCities> {
    const codes = await this.repository.cities(userId, this.clock.now());
    return { cities: codes.filter(isCityCode) };
  }

  async get(id: string): Promise<RideDetail> {
    const doc = await this.repository.findPublic(id);
    if (!doc) throw domainError('NOT_FOUND', 404);
    return rideDetailOf(doc, this.clock.now());
  }

  /** Скрытый (05b) — 404 всем, кроме организатора (ему — `phase: 'hidden'`, действия выключены). */
  async me(userId: string, id: string): Promise<RideView> {
    const doc = await this.repository.findForViewer(id, userId);
    if (!doc || !visibleTo(doc, userId)) throw domainError('NOT_FOUND', 404);
    return rideViewOf(doc, userId, this.clock.now(), await this.reports.exists(id, userId));
  }
}
