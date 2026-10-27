import { createHash } from 'node:crypto';

import { Inject, Injectable, Logger } from '@nestjs/common';
import type {
  PanelRoute,
  PanelRoutePage,
  PanelRouteQuery,
  PanelRouteSummary,
  RateLimitedDetails,
  RouteOrigin,
} from '@pokatim/contracts';
import { detectRouteFormat } from '@pokatim/tracks';
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

/** Владелец принимаемого маршрута: сотрудник панели (`platform`) или райдер приложения (`rider`). */
export interface RouteOwner {
  userId: string;
  origin: RouteOrigin;
}

/** Уникальный индекс дедупа приёма (`0021_routes_rider`). */
const ROUTES_DEDUP_INDEX = 'routes_owner_origin_sha_unique';

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
    catalog: catalogOf(route),
  };
}

/** Каталожные поля панели; документ до `0020_routes_catalog` — `null`. */
function catalogOf(route: RouteDoc): PanelRouteSummary['catalog'] {
  const catalog = route.catalog ?? null;
  return catalog
    ? {
        city: catalog.city,
        surfaces: catalog.surfaces,
        publishedAt: catalog.publishedAt.toISOString(),
      }
    : null;
}

/**
 * Маршруты команды платформы (race-results-01): приём GPX/KML (лимит частоты, формат по сигнатуре, дедуп по sha256 в
 * пределах владельца и происхождения, транзакция «маршрут + исходник + журнал + outbox»), список и чтение. Приём —
 * общий и для маршрутов райдера (`MyRoutesService`, routes-02). Разбор — только worker. Видимость (Q2): готовые —
 * всем с `races.read`; необработанные — только автору (чужой — 404); маршрут райдера — никому.
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

  /**
   * Приём файла маршрута (GPX/KML) для владельца `owner` — сотрудника (`platform`, панель) или райдера (`rider`,
   * routes-02): `created` — маршрут поставлен в обработку (`202`: новый или повтор отказа), иначе тот же (`200`).
   * Порядок: пусто → размер → формат по сигнатуре → дедуп в пределах `(origin, userId)` → квота (`maxRoutes`, только
   * после дедупа: тот же файл при полной квоте — `200`) → транзакция «маршрут + исходник (+ журнал панели для
   * `platform`) + outbox». Квота мягкая (счёт вне транзакции). Лог — без названия.
   */
  async accept(
    owner: RouteOwner,
    title: string,
    bytes: Uint8Array,
    options: { maxRoutes?: number } = {},
  ): Promise<{ created: boolean; route: RouteDoc }> {
    if (bytes.byteLength === 0) {
      throw domainError('VALIDATION_FAILED', 400, { fields: [{ path: 'body', code: 'INVALID' }] });
    }
    if (bytes.byteLength > ROUTE_POLICY.maxFileBytes) throw domainError('ROUTE_TOO_LARGE', 413);
    // KMZ, FIT-курс, TCX и прочее — 415 (GPX и KML — по содержимому, routes-02)
    if (detectRouteFormat(bytes) === null) throw domainError('ROUTE_FORMAT_UNSUPPORTED', 415);
    const sha256 = createHash('sha256').update(bytes).digest('hex');
    const existing = await this.repository.findByOwnerSha(owner.origin, owner.userId, sha256);
    if (existing) return this.again(existing);
    if (
      options.maxRoutes !== undefined &&
      (await this.repository.countOwned(owner.origin, owner.userId)) >= options.maxRoutes
    ) {
      throw domainError('ROUTE_QUOTA_EXCEEDED', 409);
    }

    const now = this.clock.now();
    const route: RouteDoc = {
      _id: uuidv7(),
      origin: owner.origin,
      ownerUserId: owner.userId,
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
      catalog: null,
      createdAt: now,
      updatedAt: now,
    };
    try {
      await this.transactions.run(async (tx) => {
        await this.repository.insertRoute(tx, route, bytes);
        // журнал панели — только маршруты команды: действия райдера и его названия туда не пишутся
        if (owner.origin === 'platform') {
          await this.audit.append(tx, {
            action: 'route.created',
            actor: { kind: 'user', userId: owner.userId },
            subject: { kind: 'route', id: route._id, label: route.title },
          });
        }
        await this.outbox.append(tx, { type: ROUTE_RECEIVED, payload: { routeId: route._id } });
      });
    } catch (error) {
      // две одинаковые загрузки одновременно: проигравшая получает маршрут победившей
      const winner = isDuplicateKey(error, ROUTES_DEDUP_INDEX)
        ? await this.repository.findByOwnerSha(owner.origin, owner.userId, sha256)
        : undefined;
      if (winner) return this.again(winner);
      throw error;
    }
    this.logger.log(`route ${route._id} (${owner.origin}) queued by ${owner.userId}`);
    return { created: true, route };
  }

  /**
   * Тот же файл того же владельца: готовый или обрабатываемый маршрут — как есть (`200`); отказ или зависшая
   * обработка — снова в обработку новым событием outbox (`202`): сбой окружения не закрывает файл навсегда.
   */
  private async again(route: RouteDoc): Promise<{ created: boolean; route: RouteDoc }> {
    const now = this.clock.now();
    const staleBefore = new Date(now.getTime() - ROUTE_POLICY.stuckAfterMs);
    const retry =
      route.status === 'failed' || (route.status === 'processing' && route.updatedAt < staleBefore);
    if (!retry) return { created: false, route };
    const requeued = await this.transactions.run(async (tx) => {
      const doc = await this.repository.requeue(tx, route._id, staleBefore, now);
      if (doc)
        await this.outbox.append(tx, { type: ROUTE_RECEIVED, payload: { routeId: doc._id } });
      return doc;
    });
    if (!requeued) {
      const current = await this.repository.findRoute(route._id);
      return { created: false, route: current ?? route };
    }
    this.logger.log(`route ${route._id} requeued by ${requeued.ownerUserId}`);
    return { created: true, route: requeued };
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

  /** Маршрут с линией показа (у необработанного — `[]`); ответ и действий каталога (`RoutesCatalogAdminService`). */
  async view(route: RouteDoc): Promise<PanelRoute> {
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

/**
 * Панель видит только маршруты платформы (routes-02, RC-2): готовый — всем с `races.read`; необработанный и отказ —
 * только автору. Маршрут райдера — никому (404).
 */
export function visible(principal: PanelPrincipal, route: RouteDoc): boolean {
  return (
    route.origin === 'platform' &&
    (route.status === 'ready' || route.ownerUserId === principal.userId)
  );
}
