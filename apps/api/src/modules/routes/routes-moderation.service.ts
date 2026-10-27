import { Inject, Injectable, Logger } from '@nestjs/common';
import type {
  ApproveRiderRouteRequest,
  DismissRiderRouteReportsRequest,
  HideRiderRouteRequest,
  RejectRiderRouteRequest,
  RestoreRiderRouteRequest,
  RiderRouteModerationDetail,
  RiderRouteModerationPage,
  RiderRouteModerationQuery,
  RiderRouteModerationRow,
  RouteReportReason,
} from '@pokatim/contracts';
import { CLOCK, type Clock } from '@rkarakulov/api-kit/core';
import { MongoOutboxWriter } from '@rkarakulov/api-kit/mongo';
import { z } from 'zod';

import { type DbSession, MongoTransactions } from '../../db';
import { domainError } from '../../error-messages';
import { decodeCursor, encodeCursor } from '../../page-cursor';
import { type AuditRecord, PanelAudit } from '../panel';
import { elevationOf } from './route-elevation';
import type { RouteReportDoc } from './route-reports.collection';
import { RouteReportsRepository } from './route-reports.repository';
import { ROUTE_PUBLICATION_DECIDED, type RoutePublicationDecided } from './routes.events';
import { type PublicationAction, publicationTransition } from './routes.policy';
import { type PublishedRiderRoute, RoutesRepository } from './routes.repository';

const CursorKey = z.iso.datetime();

const iso = (value: Date | null | undefined) => value?.toISOString() ?? null;

type ModerationAction = Exclude<PublicationAction, 'submit' | 'withdraw'>;

const AUDIT_ACTION = {
  approve: 'route.submission_approved',
  reject: 'route.submission_rejected',
  hide: 'route.rider_hidden',
  restore: 'route.rider_restored',
  dismiss: 'route.rider_reports_dismissed',
} as const satisfies Record<ModerationAction, AuditRecord['action']>;

/** Тело действия (после zod) — общая часть и поля отдельных действий. */
type ActionBody =
  | ({ action: 'approve' } & ApproveRiderRouteRequest)
  | ({ action: 'reject' } & RejectRiderRouteRequest)
  | ({ action: 'hide' } & HideRiderRouteRequest)
  | ({ action: 'restore' } & RestoreRiderRouteRequest)
  | ({ action: 'dismiss' } & DismissRiderRouteReportsRequest);

/** Ключ курсора очереди. */
function queueKey(
  route: PublishedRiderRoute,
  state: RiderRouteModerationQuery['state'],
): Date | null {
  if (state === 'pending') return route.publication.submittedAt;
  if (state === 'reported') return route.publication.lastReportAt;
  return route.publication.hiddenAt;
}

/** Строка очереди (без имени автора — N8). */
function rowOf(
  route: PublishedRiderRoute,
  top: ReadonlyMap<string, RouteReportReason>,
): RiderRouteModerationRow {
  const p = route.publication;
  return {
    id: route._id,
    title: route.title,
    authorUserId: route.ownerUserId,
    status: p.status as RiderRouteModerationRow['status'],
    city: p.city,
    surfaces: p.surfaces,
    distanceM: route.distanceM ?? 0,
    submittedAt: p.submittedAt.toISOString(),
    openReportCount: p.openReportCount,
    topReason: top.get(route._id) ?? null,
    lastReportAt: iso(p.lastReportAt),
    hiddenAt: iso(p.hiddenAt),
  };
}

/**
 * Модерация маршрутов райдеров в панели (routes-06, `routes.moderate`, A5): очереди «На проверке» / «Жалобы» /
 * «Скрытые», карточка заявки (линия и профиль — как страница маршрута routes-05) и действия. Действие — одна
 * транзакция: **первой** — условная запись маршрута по `publication.version` (конкурирующие действия автора,
 * модератора и жалоба конфликтуют по документу), затем закрытие жалоб, `PanelAudit.append` и событие outbox
 * (одобрение/отклонение). Лог — после коммита: id и действие, без названия, комментария и `userId` автора.
 */
@Injectable()
export class RoutesModerationService {
  private readonly logger = new Logger(RoutesModerationService.name);

  constructor(
    private readonly routes: RoutesRepository,
    private readonly reports: RouteReportsRepository,
    private readonly audit: PanelAudit,
    private readonly outbox: MongoOutboxWriter,
    private readonly transactions: MongoTransactions,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  async list(query: RiderRouteModerationQuery): Promise<RiderRouteModerationPage> {
    const cursor = query.cursor ? decodeCursor(query.cursor, CursorKey) : null;
    const after = cursor ? { at: new Date(cursor.k), id: cursor.id } : null;
    const docs = await this.routes.listPublicationQueue(query.state, after, query.limit + 1);
    const page = docs.slice(0, query.limit);
    const top = await this.reports.topReasons(page.map((doc) => doc._id));
    const last = page.at(-1);
    const lastKey = last ? queueKey(last, query.state) : null;
    return {
      items: page.map((doc) => rowOf(doc, top)),
      nextCursor:
        docs.length > query.limit && last && lastKey
          ? encodeCursor(lastKey.toISOString(), last._id)
          : null,
    };
  }

  async get(id: string): Promise<RiderRouteModerationDetail> {
    const route = await this.routes.findForModeration(id);
    if (!route) throw domainError('NOT_FOUND', 404);
    return this.detailOf(route, await this.reports.latest(id));
  }

  approve(actorUserId: string, id: string, body: ApproveRiderRouteRequest) {
    return this.act(actorUserId, id, { action: 'approve', ...body });
  }

  reject(actorUserId: string, id: string, body: RejectRiderRouteRequest) {
    return this.act(actorUserId, id, { action: 'reject', ...body });
  }

  hide(actorUserId: string, id: string, body: HideRiderRouteRequest) {
    return this.act(actorUserId, id, { action: 'hide', ...body });
  }

  restore(actorUserId: string, id: string, body: RestoreRiderRouteRequest) {
    return this.act(actorUserId, id, { action: 'restore', ...body });
  }

  dismiss(actorUserId: string, id: string, body: DismissRiderRouteReportsRequest) {
    return this.act(actorUserId, id, { action: 'dismiss', ...body });
  }

  /** Порядок проверок — task.md §11: 404 → версия (409 CONFLICT) → новая жалоба → переход → запись. */
  private async act(
    actorUserId: string,
    id: string,
    body: ActionBody,
  ): Promise<RiderRouteModerationDetail> {
    const now = this.clock.now();
    const route = await this.transactions.run(async (tx): Promise<PublishedRiderRoute> => {
      const current = await this.routes.findForModeration(id, tx);
      if (!current) throw domainError('NOT_FOUND', 404);
      if (current.publication.version !== body.version) throw domainError('CONFLICT', 409);
      const seenAt = body.action === 'dismiss' ? new Date(body.lastReportAt) : null;
      // пришла жалоба, которую модератор не видел (у маршрута без жалоб сверять нечего — дальше 409 перехода)
      const lastReportAt = current.publication.lastReportAt;
      if (seenAt && lastReportAt && lastReportAt.getTime() !== seenAt.getTime()) {
        throw domainError('CONFLICT', 409);
      }
      const transition = publicationTransition(current.publication.status, body.action);
      if (
        transition.result !== 'ok' ||
        (body.action === 'dismiss' && current.publication.openReportCount === 0)
      ) {
        throw domainError('ROUTE_INVALID_STATE', 409);
      }
      const updated = await this.write(tx, current, body, now);
      if (!updated) throw domainError('CONFLICT', 409);
      const closed =
        body.action === 'hide' || body.action === 'dismiss'
          ? await this.reports.closeOpen(
              tx,
              id,
              body.action === 'hide' ? 'hidden' : 'dismissed',
              actorUserId,
              now,
            )
          : null;
      await this.audit.append(tx, {
        action: AUDIT_ACTION[body.action],
        actor: { kind: 'user', userId: actorUserId },
        subject: { kind: 'route', id, label: updated.title },
        ...this.auditOf(current, body, closed),
      });
      if (body.action === 'approve' || body.action === 'reject') {
        const payload: RoutePublicationDecided = {
          routeId: id,
          authorUserId: updated.ownerUserId,
          decision: body.action === 'approve' ? 'approved' : 'rejected',
          decidedAt: now.toISOString(),
        };
        await this.outbox.append(tx, { type: ROUTE_PUBLICATION_DECIDED, payload });
      }
      return updated;
    });
    this.logger.log(`route ${id} ${body.action} by ${actorUserId}`);
    return this.detailOf(route, await this.reports.latest(id));
  }

  /** Условная запись маршрута — первая запись транзакции (фильтр повторяет проверки и `version`). */
  private write(
    tx: DbSession,
    current: PublishedRiderRoute,
    body: ActionBody,
    now: Date,
  ): Promise<PublishedRiderRoute | null> {
    const id = current._id;
    switch (body.action) {
      case 'approve':
        return this.routes.approvePublication(
          tx,
          id,
          body.version,
          { city: body.city, surfaces: body.surfaces },
          now,
        );
      case 'reject':
        return this.routes.rejectPublication(
          tx,
          id,
          body.version,
          { reason: body.reason, comment: body.comment ?? null },
          now,
        );
      case 'hide':
        return this.routes.hidePublication(tx, id, body.version, now);
      case 'restore': {
        const { city, surfaces, approvedAt } = current.publication;
        return this.routes.restorePublication(
          tx,
          id,
          body.version,
          { city, surfaces, publishedAt: approvedAt ?? now },
          now,
        );
      }
      case 'dismiss':
        return this.routes.clearRouteReports(tx, id, body.version, new Date(body.lastReportAt));
    }
  }

  /** Причина и детали записи журнала (без имени автора и текста жалоб). */
  private auditOf(
    current: PublishedRiderRoute,
    body: ActionBody,
    closed: number | null,
  ): Pick<AuditRecord, 'reason' | 'details'> {
    switch (body.action) {
      case 'approve': {
        const p = current.publication;
        const changedFields = [
          ...(p.city === body.city ? [] : ['city']),
          ...(sameSet(p.surfaces, body.surfaces) ? [] : ['surfaces']),
        ];
        return { reason: null, details: changedFields.length ? { changedFields } : null };
      }
      case 'reject':
        return { reason: body.comment ?? null, details: { rejectionReason: body.reason } };
      case 'restore':
        return { reason: body.reason, details: null };
      default:
        return { reason: body.reason, details: { reportCount: closed ?? 0 } };
    }
  }

  /** Карточка заявки: линия показа и профиль — как страница маршрута панели (routes-05), жалобы без автора. */
  private async detailOf(
    route: PublishedRiderRoute,
    reports: RouteReportDoc[],
  ): Promise<RiderRouteModerationDetail> {
    const geometry = await this.routes.panelGeometry(route._id);
    const p = route.publication;
    return {
      id: route._id,
      title: route.title,
      authorUserId: route.ownerUserId,
      showAuthorName: p.showAuthorName,
      status: p.status as RiderRouteModerationDetail['status'],
      city: p.city,
      surfaces: p.surfaces,
      submittedAt: p.submittedAt.toISOString(),
      submissionCount: p.submissionCount,
      decidedAt: iso(p.decidedAt),
      approvedAt: iso(p.approvedAt),
      rejection: p.rejection,
      hiddenAt: iso(p.hiddenAt),
      openReportCount: p.openReportCount,
      lastReportAt: iso(p.lastReportAt),
      version: p.version,
      distanceM: route.distanceM ?? 0,
      elevationGainM: route.elevationGainM,
      isLoop: route.isLoop === true,
      line: geometry?.line ?? [],
      elevation: elevationOf(geometry?.profile ?? null),
      reports: reports.map((report) => ({
        id: report._id,
        reason: report.reason,
        comment: report.comment,
        createdAt: report.createdAt.toISOString(),
        resolution: report.resolution,
        resolvedAt: iso(report.resolvedAt),
      })),
    };
  }
}

/** Одинаковый набор покрытий (порядок не важен). */
function sameSet(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((value) => b.includes(value));
}
