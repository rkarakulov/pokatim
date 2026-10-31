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
import {
  citiesNear,
  distanceKm,
  rideFull,
  ridePhase,
  ridePointNow,
  RIDES_POLICY,
  rideViewer,
  visibleTo,
} from './rides.policy';
import { type NearFilter, type RideMapDoc, RidesRepository } from './rides.repository';

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
 * Фото организатора во view (ride-photo, ADR-0028): у скрытого райда — `null` всем, включая организатора (как 404
 * отдачи байтов); только id.
 */
export const ridePhotoOf = (doc: Pick<RideDoc, 'status' | 'photoId'>) =>
  doc.status !== 'hidden' && doc.photoId ? { id: doc.photoId } : null;

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
    photo: ridePhotoOf(doc),
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

/**
 * Фильтр «Рядом» запроса: `near` уже округлён схемой, без `radiusKm` — 25 км; города с центром в круге и маршруты
 * каталога со стартом в круге (порт, ≤ `PUBLIC_STARTS_CAP`) — кандидаты только по публичным данным (pass 2).
 */
async function nearOf(
  port: RideRoutes,
  query: { near?: [number, number]; radiusKm?: number },
): Promise<NearFilter | null> {
  if (!query.near) return null;
  const radiusKm = query.radiusKm ?? RIDE_NEAR_RADIUS_KM.default;
  return {
    center: query.near,
    radiusKm,
    cities: citiesNear(query.near, radiusKm),
    publicRouteIds: await port.publicStartsWithin(query.near, radiusKm),
  };
}

/**
 * Пачек выборки не больше (лента «Рядом» и карта, 05c RC-1): строки с точкой, которой сейчас нет в круге (маршрут
 * снят), отбрасываются после чтения; короче страница — допустима, курсор — по последней прочитанной строке.
 */
const MAX_SCAN_BATCHES = 5;

/** Id маршрутов в запросе порта `RideRoutes.visible` (контракт порта — ≤ 200). */
const ROUTE_LOOKUP_CHUNK = 200;

/** Точка райда сейчас (`ridePointNow`) — в круге «Рядом»; без «Рядом» — всегда. */
function inNear(
  doc: Pick<RideDoc, 'cityCode' | 'routeId'> & Partial<Pick<RideDoc, 'geo' | 'startPrecise'>>,
  routes: RouteLookup,
  near: NearFilter | null,
): boolean {
  if (!near) return true;
  const point = ridePointNow(doc, doc.routeId ? routes.get(doc.routeId) : undefined);
  return distanceKm(point.coordinates, near.center) <= near.radiusKm;
}

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

  /**
   * Лента по `(startsAt, _id)`. С «Рядом» — по точке райда сейчас (`ridePointNow`, RC-1): строка, чья точка вне круга
   * (маршрут снят — точка центр города), отбрасывается после чтения, страница добирается пачками (≤ `MAX_SCAN_BATCHES`).
   * Курсор — по последней строке страницы; упёрлись в предел пачек — по последней прочитанной (страница короче или
   * пустая, продолжение не теряется).
   */
  async list(userId: string, query: RideListQuery): Promise<RidePage> {
    const cursor = query.cursor ? decodeCursor(query.cursor, CursorKey) : null;
    if (query.near) await this.limitNear(userId);
    const near = await nearOf(this.rideRoutes, query);
    const now = this.clock.now();
    // принятые строки: `limit + 1`-я — признак продолжения (как раньше `limit + 1` выборки)
    const accepted: RideDoc[] = [];
    const routes = new Map<string, RideRouteRef>();
    let after = cursor ? { startsAt: new Date(cursor.k), id: cursor.id } : null;
    let exhausted = false;
    for (let batch = 0; batch < MAX_SCAN_BATCHES && accepted.length <= query.limit; batch++) {
      const need = query.limit + 1 - accepted.length;
      const docs = await this.repository.listFeed(userId, now, query.city, after, need, near);
      for (const [id, ref] of await lookupRoutes(this.rideRoutes, docs, userId)) {
        routes.set(id, ref);
      }
      accepted.push(...docs.filter((doc) => inNear(doc, routes, near)));
      const last = docs.at(-1);
      if (last) after = { startsAt: last.startsAt, id: last._id };
      exhausted = docs.length < need;
      if (exhausted) break;
    }
    const page = accepted.slice(0, query.limit);
    const lastItem = page.at(-1);
    // страница полна и есть следующая — курсор по последней строке; предел пачек — по последней прочитанной
    const next =
      accepted.length > query.limit && lastItem
        ? { startsAt: lastItem.startsAt, id: lastItem._id }
        : exhausted
          ? null
          : after;
    const reported = await this.reports.reportedRideIds(
      userId,
      page.map((doc) => doc._id),
    );
    return {
      items: page.map((doc): RideCard => ({
        ...summaryOf(doc, now, routeOf(doc, routes, userId)),
        viewer: viewerOf(doc, userId, now, reported.has(doc._id)),
      })),
      nextCursor: next ? encodeCursor(next.startsAt.toISOString(), next.id) : null,
    };
  }

  async cities(userId: string): Promise<RideCities> {
    const codes = await this.repository.cities(userId, this.clock.now());
    return { cities: codes.filter(isCityCode) };
  }

  /**
   * Карта ленты (05c): будущие опубликованные райды, чья точка сейчас точная (`ridePointNow`: маршрут в каталоге, RC-1;
   * свой непубличный маршрут организатора — тоже не точка) и в круге «Рядом»; точка — старт маршрута. Кандидаты —
   * пачками по `(startsAt, _id)` до 200 точек (≤ `MAX_SCAN_BATCHES`). `withoutStart` — остальные райды того же фильтра
   * (без точки, снятый маршрут — по центру города, сверх предела).
   */
  async map(userId: string, query: RideMapQuery): Promise<RideMap> {
    // карта считается всегда (и без «Рядом»): тот же ключ, что у ленты с `near`
    await this.limitNear(userId);
    const near = await nearOf(this.rideRoutes, query);
    const now = this.clock.now();
    const [items, total] = await Promise.all([
      this.mapPoints(now, query, near),
      this.countMap(now, query, near),
    ]);
    return { items, withoutStart: Math.max(0, total - items.length) };
  }

  private async mapPoints(
    now: Date,
    query: RideMapQuery,
    near: NearFilter | null,
  ): Promise<RideMap['items']> {
    const items: RideMap['items'] = [];
    let after: { startsAt: Date; id: string } | null = null;
    for (let batch = 0; batch < MAX_SCAN_BATCHES; batch++) {
      const docs: RideMapDoc[] = await this.repository.listMapPoints(
        now,
        query.city,
        near,
        after,
        RIDE_MAP_MAX_POINTS,
      );
      const routes = await lookupRoutes(this.rideRoutes, docs, null);
      for (const doc of docs) {
        const route = doc.routeId ? routes.get(doc.routeId) : undefined;
        if (!route || !ridePointNow(doc, route).precise || !inNear(doc, routes, near)) continue;
        items.push({
          id: doc._id,
          title: doc.title,
          startsAt: doc.startsAt.toISOString(),
          start: route.start,
          goingCount: doc.goingCount,
          limit: doc.limit,
          full: rideFull(doc),
        });
        if (items.length === RIDE_MAP_MAX_POINTS) return items;
      }
      const last = docs.at(-1);
      if (docs.length < RIDE_MAP_MAX_POINTS || !last) return items;
      after = { startsAt: last.startsAt, id: last._id };
    }
    return items;
  }

  /**
   * Райды фильтра карты; с «Рядом» — по точке сейчас: какие маршруты точных точек райдов городов круга в каталоге —
   * порт, пачками (точка такого райда — старт маршрута, не центр города).
   */
  private async countMap(now: Date, query: RideMapQuery, near: NearFilter | null): Promise<number> {
    if (!near) return this.repository.countMap(now, query.city, null);
    const ids = await this.repository.cityPreciseRouteIds(now, query.city, near);
    const publicIds: string[] = [];
    for (let i = 0; i < ids.length; i += ROUTE_LOOKUP_CHUNK) {
      const visible = await this.rideRoutes.visible(ids.slice(i, i + ROUTE_LOOKUP_CHUNK), null);
      publicIds.push(...visible.keys());
    }
    return this.repository.countMap(now, query.city, near, publicIds);
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
