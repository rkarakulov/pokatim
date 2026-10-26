import { createHash } from 'node:crypto';

import { Inject, Injectable, Logger } from '@nestjs/common';
import type {
  PanelRoute,
  PanelRoutePage,
  PanelRouteQuery,
  PanelRouteSummary,
  RateLimitedDetails,
} from '@pokatim/contracts';
import { detectTrackFormat } from '@pokatim/tracks';
import { CLOCK, type Clock, RateLimiter } from '@rkarakulov/api-kit/core';
import {
  isDuplicateKey,
  MongoOutboxWriter,
  MongoTransactions,
  uuidv7,
} from '@rkarakulov/api-kit/mongo';
import { z } from 'zod';

import { domainError } from '../../error-messages';
import { decodeCursor, encodeCursor } from '../../page-cursor';
import { PanelAudit, PanelDirectory, type PanelPrincipal } from '../panel';
import type { RouteDoc } from './routes.collection';
import { ROUTE_RECEIVED } from './routes.events';
import { ROUTE_POLICY } from './routes.policy';
import { RoutesRepository } from './routes.repository';

/** Курсор списка маршрутов: ключ — константа (сортировка только по `_id`). */
const RouteCursorKey = z.literal('r');

const notFound = () => domainError('NOT_FOUND', 404);

/** Ответ панели: без `sha256`, исходника и линии сверки (§8.3 «Данные наружу»). */
function toSummary(route: RouteDoc, ownerName: string): PanelRouteSummary {
  return {
    id: route._id,
    title: route.title,
    status: route.status,
    failure: route.failure,
    distanceM: route.distanceM,
    elevationGainM: route.elevationGainM,
    isLoop: route.isLoop,
    owner: { userId: route.ownerUserId, displayName: ownerName },
    createdAt: route.createdAt.toISOString(),
  };
}

/**
 * Маршруты команды платформы (race-results-01): приём GPX (лимит частоты, формат по сигнатуре, дедуп по sha256 в
 * пределах сотрудника, транзакция «маршрут + исходник + журнал + outbox»), список и чтение. Разбор — только worker.
 * Видимость (Q2): готовые — всем с `races.read`; необработанные — только автору (чужой — 404).
 */
@Injectable()
export class RoutesService {
  private readonly logger = new Logger(RoutesService.name);

  constructor(
    private readonly repository: RoutesRepository,
    private readonly audit: PanelAudit,
    private readonly directory: PanelDirectory,
    private readonly transactions: MongoTransactions,
    private readonly outbox: MongoOutboxWriter,
    private readonly rateLimiter: RateLimiter,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  /** Лимит загрузок сотрудника (до чтения тела). */
  async admit(principal: PanelPrincipal): Promise<void> {
    const result = await this.rateLimiter.consume(
      `routes-upload-user:${principal.userId}`,
      ROUTE_POLICY.uploadUserLimit,
      this.clock.now(),
    );
    if (!result.allowed) {
      const details: RateLimitedDetails = { retryAfterSec: result.retryAfterSec };
      throw domainError('RATE_LIMITED', 429, details);
    }
  }

  /** Приём GPX: `created` — новый маршрут (`202`), иначе тот же файл того же сотрудника (`200`). */
  async accept(
    principal: PanelPrincipal,
    title: string,
    bytes: Uint8Array,
  ): Promise<{ created: boolean; route: PanelRoute }> {
    if (bytes.byteLength === 0) {
      throw domainError('VALIDATION_FAILED', 400, { fields: [{ path: 'body', code: 'INVALID' }] });
    }
    if (bytes.byteLength > ROUTE_POLICY.maxFileBytes) throw domainError('ROUTE_TOO_LARGE', 413);
    // FIT-курс, KML и прочее — 415: v1 принимает только GPX (Q3)
    if (detectTrackFormat(bytes) !== 'gpx') throw domainError('ROUTE_FORMAT_UNSUPPORTED', 415);
    const sha256 = createHash('sha256').update(bytes).digest('hex');
    const existing = await this.repository.findByOwnerSha(principal.userId, sha256);
    if (existing) return { created: false, route: await this.view(existing) };

    const now = this.clock.now();
    const route: RouteDoc = {
      _id: uuidv7(),
      origin: 'platform',
      ownerUserId: principal.userId,
      title,
      status: 'processing',
      failure: null,
      attempts: 0,
      sha256,
      sizeBytes: bytes.byteLength,
      distanceM: null,
      elevationGainM: null,
      isLoop: null,
      start: null,
      finish: null,
      createdAt: now,
      updatedAt: now,
    };
    try {
      await this.transactions.run(async (tx) => {
        await this.repository.insertRoute(tx, route, bytes);
        await this.audit.append(tx, {
          action: 'route.created',
          actor: { kind: 'user', userId: principal.userId },
          subject: { kind: 'route', id: route._id, label: route.title },
        });
        await this.outbox.append(tx, { type: ROUTE_RECEIVED, payload: { routeId: route._id } });
      });
    } catch (error) {
      // две одинаковые загрузки одновременно: проигравшая получает маршрут победившей
      const winner = isDuplicateKey(error, 'routes_owner_sha_unique')
        ? await this.repository.findByOwnerSha(principal.userId, sha256)
        : undefined;
      if (winner) return { created: false, route: await this.view(winner) };
      throw error;
    }
    this.logger.log(`route ${route._id} queued by ${principal.userId}`);
    return { created: true, route: await this.view(route) };
  }

  async get(principal: PanelPrincipal, id: string): Promise<PanelRoute> {
    const route = await this.repository.findRoute(id);
    if (!route || !visible(principal, route)) throw notFound();
    return this.view(route);
  }

  async list(principal: PanelPrincipal, query: PanelRouteQuery): Promise<PanelRoutePage> {
    const beforeId = query.cursor ? decodeCursor(query.cursor, RouteCursorKey).id : null;
    const docs = await this.repository.listVisible(
      principal.userId,
      query.status === 'ready',
      beforeId,
      query.limit + 1,
    );
    const page = docs.slice(0, query.limit);
    const names = await this.directory.displayNames(page.map((route) => route.ownerUserId));
    const last = page.at(-1);
    return {
      items: page.map((route) => toSummary(route, names.get(route.ownerUserId) ?? '')),
      nextCursor: docs.length > query.limit && last ? encodeCursor('r', last._id) : null,
    };
  }

  /** Маршрут с линией показа (у необработанного — `[]`). */
  private async view(route: RouteDoc): Promise<PanelRoute> {
    const [names, geometry] = await Promise.all([
      this.directory.displayNames([route.ownerUserId]),
      route.status === 'ready' ? this.repository.geometry(route._id) : undefined,
    ]);
    return {
      ...toSummary(route, names.get(route.ownerUserId) ?? ''),
      line: geometry?.line.coordinates ?? [],
    };
  }
}

/** Готовый маршрут платформы — всем с `races.read`; необработанный и отказ — только автору. */
function visible(principal: PanelPrincipal, route: RouteDoc): boolean {
  return route.status === 'ready' || route.ownerUserId === principal.userId;
}
