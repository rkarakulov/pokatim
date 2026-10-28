import { Inject, Injectable } from '@nestjs/common';
import {
  isCityCode,
  type RateLimitedDetails,
  RIDE_MAP_MAX_POINTS,
  RIDE_NEAR_RADIUS_KM,
  type RideCard,
  type RideCities,
  type RideDetail,
  type RideListQuery,
  type RideMap,
  type RideMapQuery,
  type RidePage,
  type RideRoute,
  type RideView,
} from '@pokatim/contracts';
import { CLOCK, type Clock, RateLimiter } from '@rkarakulov/api-kit/core';
import { z } from 'zod';

import { domainError } from '../../error-messages';
import { decodeCursor, encodeCursor } from '../../page-cursor';
import { RIDE_ROUTES, type RideRouteRef, type RideRoutes } from '../routes';
import { RideReportsRepository } from './ride-reports.repository';
import type { RideDoc, RidePublicDoc } from './rides.collection';
import { rideFull, ridePhase, RIDES_POLICY, rideViewer, visibleTo } from './rides.policy';
import { type NearFilter, RidesRepository } from './rides.repository';

/** Видимые зрителю маршруты райдов страницы (порт `RideRoutes`, одним вызовом, без кэша). */
export type RouteLookup = ReadonlyMap<string, RideRouteRef>;

/**
 * Маршруты райдов для зрителя (`null` — гость, публичная карточка): в каталоге — всем; свой непубличный — только
 * если зритель его владелец (дальше `routeOf` ещё сверяет организатора райда).
 */
export function lookupRoutes(
  port: RideRoutes,
  docs: readonly Pick<RideDoc, 'routeId'>[],
  viewerUserId: string | null,
): Promise<RouteLookup> {
  const ids = docs.map((doc) => doc.routeId ?? null).filter((id): id is string => id !== null);
  return port.visible(ids, viewerUserId);
}

/**
 * Маршрут райда для зрителя (05c, 8.3 п. 1): только видимый сейчас; `private` — только организатору этого райда
 * (двойная проверка: владелец в запросе порта и организатор здесь). Висячий `routeId` — `null`.
 */
function routeOf(
  doc: Pick<RideDoc, 'routeId'> & Partial<Pick<RideDoc, 'organizerUserId'>>,
  routes: RouteLookup,
  viewerUserId: string | null,
): RideRouteRef | null {
  const ref = doc.routeId ? routes.get(doc.routeId) : undefined;
  if (!ref) return null;
  if (ref.access === 'private' && (viewerUserId === null || doc.organizerUserId !== viewerUserId)) {
    return null;
  }
  return ref;
}

/** Маршрут в ответе — явным списком (без старта и владельца). */
const routeView = (ref: RideRouteRef): RideRoute => ({
  id: ref.id,
  title: ref.title,
  distanceM: ref.distanceM,
  elevationGainM: ref.elevationGainM,
  access: ref.access,
});

/**
 * Публичные поля ответа — явным списком (не `...doc`): без организатора, участников, `version`, `createdAt`, точки
 * «Рядом». `start` — старт видимого зрителю маршрута (8.1 RC-1), не снимок из райда.
 */
function summaryOf(doc: RidePublicDoc, now: Date, route: RideRouteRef | null) {
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
    route: route ? routeView(route) : null,
    start: route ? route.start : null,
  };
}

function rideDetailOf(doc: RidePublicDoc, now: Date, route: RideRouteRef | null): RideDetail {
  return { ...summaryOf(doc, now, route), description: doc.description };
}

/** Участник ли зритель: в документе зрителя участники — только он (`$elemMatch`), в ответе мутации — все. */
const isParticipant = (doc: RideDoc, userId: string) =>
  doc.participants?.some((participant) => participant.userId === userId) ?? false;

const viewerOf = (doc: RideDoc, userId: string, now: Date, reported: boolean) =>
  rideViewer(doc, { userId, participant: isParticipant(doc, userId) }, now, reported);

/**
 * Карточка + зритель; организатору — `version` для формы правки. `reported` — зритель уже жаловался (05b): у
 * организатора — всегда `false`. `routes` — `lookupRoutes` с этим зрителем.
 */
export function rideViewOf(
  doc: RideDoc,
  userId: string,
  now: Date,
  routes: RouteLookup,
  reported = false,
): RideView {
  const viewer = viewerOf(doc, userId, now, reported);
  const ride = rideDetailOf(doc, now, routeOf(doc, routes, userId));
  return {
    ride: viewer.role === 'organizer' ? { ...ride, version: doc.version } : ride,
    viewer,
  };
}

const CursorKey = z.iso.datetime();

/** Фильтр «Рядом» запроса: `near` уже округлён схемой, без `radiusKm` — 25 км. */
const nearOf = (query: { near?: [number, number]; radiusKm?: number }): NearFilter | null =>
  query.near
    ? { center: query.near, radiusKm: query.radiusKm ?? RIDE_NEAR_RADIUS_KM.default }
    : null;

/**
 * Чтение кофе-райдов: лента, карта ленты и города зависят от зрителя (роль, отменённые свои, свой маршрут) — под
 * `AuthGuard`, `no-store`; публичная карточка — без зрителя; `me` — карточка + состояние зрителя. Маршрут райда и
 * старт — на каждом чтении через порт `RideRoutes` (05c). Координаты «Рядом» не логируются.
 */
@Injectable()
export class RidesFeedService {
  constructor(
    private readonly repository: RidesRepository,
    private readonly reports: RideReportsRepository,
    private readonly rateLimiter: RateLimiter,
    @Inject(RIDE_ROUTES) private readonly rideRoutes: RideRoutes,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  /** Лента с «Рядом» и карта ленты (8.3 п. 4): `rides-near:<uid>` — 60 в минуту. */
  private async limitNear(userId: string): Promise<void> {
    const result = await this.rateLimiter.consume(
      `rides-near:${userId}`,
      RIDES_POLICY.nearLimit,
      this.clock.now(),
    );
    if (!result.allowed) {
      const details: RateLimitedDetails = { retryAfterSec: result.retryAfterSec };
      throw domainError('RATE_LIMITED', 429, details);
    }
  }

  async list(userId: string, query: RideListQuery): Promise<RidePage> {
    const cursor = query.cursor ? decodeCursor(query.cursor, CursorKey) : null;
    const near = nearOf(query);
    if (near) await this.limitNear(userId);
    const now = this.clock.now();
    const docs = await this.repository.listFeed(
      userId,
      now,
      query.city,
      cursor ? { startsAt: new Date(cursor.k), id: cursor.id } : null,
      query.limit + 1,
      near,
    );
    const page = docs.slice(0, query.limit);
    const last = page.at(-1);
    const [reported, routes] = await Promise.all([
      this.reports.reportedRideIds(
        userId,
        page.map((doc) => doc._id),
      ),
      lookupRoutes(this.rideRoutes, page, userId),
    ]);
    return {
      items: page.map((doc): RideCard => ({
        ...summaryOf(doc, now, routeOf(doc, routes, userId)),
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

  /**
   * Карта ленты (05c): будущие опубликованные райды с точной точкой, у которых маршрут виден зрителю сейчас (точка —
   * старт маршрута); `withoutStart` — остальные райды того же фильтра (без точки, снятый маршрут, сверх предела).
   */
  async map(userId: string, query: RideMapQuery): Promise<RideMap> {
    // карта считается всегда (и без «Рядом»): тот же ключ, что у ленты с `near`
    await this.limitNear(userId);
    const near = nearOf(query);
    const now = this.clock.now();
    const [docs, total] = await Promise.all([
      this.repository.listMapPoints(now, query.city, near, RIDE_MAP_MAX_POINTS),
      this.repository.countMap(now, query.city, near),
    ]);
    const routes = await lookupRoutes(this.rideRoutes, docs, userId);
    const items: RideMap['items'] = [];
    for (const doc of docs) {
      const route = routeOf(doc, routes, userId);
      if (!route) continue;
      items.push({
        id: doc._id,
        title: doc.title,
        startsAt: doc.startsAt.toISOString(),
        start: route.start,
        goingCount: doc.goingCount,
        limit: doc.limit,
        full: rideFull(doc),
      });
    }
    return { items, withoutStart: Math.max(0, total - items.length) };
  }

  /** Публичная (кэшируемая) карточка без зрителя: маршрут — только из каталога (`public`, RC-13). */
  async get(id: string): Promise<RideDetail> {
    const doc = await this.repository.findPublic(id);
    if (!doc) throw domainError('NOT_FOUND', 404);
    const routes = await lookupRoutes(this.rideRoutes, [doc], null);
    return rideDetailOf(doc, this.clock.now(), routeOf(doc, routes, null));
  }

  /** Скрытый (05b) — 404 всем, кроме организатора (ему — `phase: 'hidden'`, действия выключены). */
  async me(userId: string, id: string): Promise<RideView> {
    const doc = await this.repository.findForViewer(id, userId);
    if (!doc || !visibleTo(doc, userId)) throw domainError('NOT_FOUND', 404);
    const [reported, routes] = await Promise.all([
      this.reports.exists(id, userId),
      lookupRoutes(this.rideRoutes, [doc], userId),
    ]);
    return rideViewOf(doc, userId, this.clock.now(), routes, reported);
  }
}
