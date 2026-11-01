import { Inject, Injectable, Logger } from '@nestjs/common';
import {
  type MyRoute,
  type MyRoutePage,
  type MyRoutePublication,
  type MyRouteQuery,
  type RateLimitedDetails,
  type RouteMapGeometry,
  type RouteStateDetails,
} from '@pokatim/contracts';
import { CLOCK, type Clock, ENV, RateLimiter, type RateLimitRule } from '@rkarakulov/api-kit/core';
import { MongoTransactions } from '@rkarakulov/api-kit/mongo';
import { z } from 'zod';

import type { Env } from '../../config/env';
import { domainError } from '../../error-messages';
import { decodeCursor, encodeCursor } from '../../page-cursor';
import { type UploadSlot, UploadSlots } from '../../upload-slots';
import { rateLimitKeyForIp } from '../identity';
import { displayGeometryOf } from './route-catalog';
import { RouteDeletion } from './route-deletion';
import type { RouteDoc, RoutePublicationDoc } from './routes.collection';
import { canPublish, ROUTE_POLICY } from './routes.policy';
import { RoutesRepository } from './routes.repository';
import { RoutesService } from './routes.service';

/** Курсор «моих»: ключ — константа (сортировка только по `_id`). */
const MyRouteCursorKey = z.literal('m');

const notFound = () => domainError('NOT_FOUND', 404);

/**
 * Заявка в каталог для автора (routes-06): отозванная/снятая — `null`; без счётчиков подач и жалоб, версии и даты
 * одобрения/скрытия.
 */
function publicationOf(publication: RoutePublicationDoc | null): MyRoutePublication | null {
  if (!publication || publication.status === 'withdrawn') return null;
  return {
    status: publication.status,
    city: publication.city,
    surfaces: publication.surfaces,
    showAuthorName: publication.showAuthorName,
    submittedAt: publication.submittedAt.toISOString(),
    decidedAt: publication.decidedAt?.toISOString() ?? null,
    rejection: publication.status === 'rejected' ? publication.rejection : null,
  };
}

/** Ответ приложения — явный список полей: без origin, владельца, sha256, попыток, каталога и линий. */
export function toMyRoute(route: RouteDoc): MyRoute {
  return {
    id: route._id,
    title: route.title,
    status: route.status,
    failure: route.failure,
    distanceM: route.distanceM,
    elevationGainM: route.elevationGainM,
    isLoop: route.isLoop,
    createdAt: route.createdAt.toISOString(),
    publication: publicationOf(route.publication ?? null),
    canPublish: canPublish(route),
    submissionsExhausted:
      (route.publication?.submissionCount ?? 0) >= ROUTE_POLICY.maxSubmissionsPerRoute,
  };
}

/** Название заморожено, пока заявка на проверке или маршрут в каталоге (A3); иначе — `null`. */
export function renameRefusal(route: RouteDoc): RouteStateDetails | null {
  const status = route.publication?.status;
  if (status === 'pending') return { reason: 'in_review' };
  if (status === 'approved') return { reason: 'published' };
  return null;
}

/**
 * Мои маршруты (routes-02): приём GPX/KML/KMZ/TCX райдером — общий `RoutesService.accept` (`origin: 'rider'`, квота), список,
 * карточка, карта, переименование, удаление. Видимость — только фильтр `{ ownerUserId, origin: 'rider' }` в
 * репозитории; чужой и неизвестный — один `404`. Журнал панели не пишется; логи — id и коды, без названий и координат.
 */
@Injectable()
export class MyRoutesService {
  private readonly logger = new Logger(MyRoutesService.name);
  private readonly slots = new UploadSlots({
    maxTotal: ROUTE_POLICY.riderMaxConcurrentUploads,
    maxPerUser: ROUTE_POLICY.riderMaxConcurrentUploadsPerUser,
  });

  constructor(
    private readonly repository: RoutesRepository,
    private readonly routes: RoutesService,
    private readonly deletion: RouteDeletion,
    private readonly transactions: MongoTransactions,
    private readonly rateLimiter: RateLimiter,
    @Inject(ENV) private readonly env: Env,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  /** Лимиты райдера и IP (до чтения тела) и слот приёма (процесс и райдер); `release` — после ответа. */
  async admit(userId: string, ip: string): Promise<UploadSlot> {
    const now = this.clock.now();
    await this.consume(`routes-upload-rider:${userId}`, ROUTE_POLICY.riderUploadUserLimit, now);
    await this.consume(
      `routes-upload-ip:${rateLimitKeyForIp(this.env.RATE_LIMIT_KEY_SECRET, ip)}`,
      ROUTE_POLICY.riderUploadIpLimit,
      now,
    );
    const slot = this.slots.tryAcquire(userId);
    if (!slot) {
      const details: RateLimitedDetails = { retryAfterSec: 5 };
      throw domainError('RATE_LIMITED', 429, details);
    }
    return slot;
  }

  private async consume(key: string, rule: RateLimitRule, now: Date): Promise<void> {
    const result = await this.rateLimiter.consume(key, rule, now);
    if (!result.allowed) {
      const details: RateLimitedDetails = { retryAfterSec: result.retryAfterSec };
      throw domainError('RATE_LIMITED', 429, details);
    }
  }

  async upload(
    userId: string,
    title: string,
    bytes: Uint8Array,
  ): Promise<{ created: boolean; route: MyRoute }> {
    const result = await this.routes.accept({ userId, origin: 'rider' }, title, bytes, {
      maxRoutes: ROUTE_POLICY.riderMaxRoutes,
    });
    return { created: result.created, route: toMyRoute(result.route) };
  }

  async list(userId: string, query: MyRouteQuery): Promise<MyRoutePage> {
    const beforeId = query.cursor ? decodeCursor(query.cursor, MyRouteCursorKey).id : null;
    const docs = await this.repository.listOwn(userId, beforeId, query.limit + 1);
    const page = docs.slice(0, query.limit);
    const last = page.at(-1);
    return {
      items: page.map(toMyRoute),
      nextCursor: docs.length > query.limit && last ? encodeCursor('m', last._id) : null,
    };
  }

  async get(userId: string, id: string): Promise<MyRoute> {
    return toMyRoute(await this.own(userId, id));
  }

  /** Линия показа своего готового маршрута — не через порт и кэш `RoutesCatalogService` (только `platform`). */
  async map(userId: string, id: string): Promise<RouteMapGeometry> {
    const route = await this.own(userId, id);
    if (route.status !== 'ready') throw notFound();
    const geometry = displayGeometryOf(route, await this.repository.displayLine(id));
    if (!geometry) throw notFound();
    return {
      line: geometry.line,
      start: geometry.start,
      finish: geometry.finish,
      bounds: geometry.bounds,
    };
  }

  /**
   * Переименование в любом статусе обработки; то же название — без записи. На проверке и в каталоге — `409
   * ROUTE_INVALID_STATE` (A3, условие и в фильтре записи: заявка, поданная между чтением и записью, тоже отказ).
   */
  async rename(userId: string, id: string, title: string): Promise<MyRoute> {
    const route = await this.own(userId, id);
    if (route.title === title) return toMyRoute(route);
    this.assertRenamable(route);
    const renamed = await this.repository.renameOwn(userId, id, title, this.clock.now());
    if (renamed) return toMyRoute(renamed);
    this.assertRenamable(await this.own(userId, id));
    throw notFound();
  }

  private assertRenamable(route: RouteDoc): void {
    const refusal = renameRefusal(route);
    if (refusal) throw domainError('ROUTE_INVALID_STATE', 409, refusal);
  }

  /**
   * Удаление насовсем: маршрут, геометрия, исходник, публикация и жалобы на него — одной транзакцией (U6); повтор —
   * 404. Лог — после коммита.
   */
  async delete(userId: string, id: string): Promise<void> {
    const deleted = await this.transactions.run((tx) => this.deletion.deleteOwn(tx, userId, id));
    if (!deleted) throw notFound();
    this.logger.log(`route ${id} deleted by ${userId}`);
  }

  private async own(userId: string, id: string): Promise<RouteDoc> {
    const route = await this.repository.findOwn(userId, id);
    if (!route) throw notFound();
    return route;
  }
}
