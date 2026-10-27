import { Inject, Injectable } from '@nestjs/common';
import type {
  DismissRideReportsRequest,
  HideRideRequest,
  ModerationRideDetail,
  ModerationRidePage,
  ModerationRideQuery,
  ModerationRideRow,
  RestoreRideRequest,
} from '@pokatim/contracts';
import { CLOCK, type Clock } from '@rkarakulov/api-kit/core';
import { MongoOutboxWriter } from '@rkarakulov/api-kit/mongo';
import { z } from 'zod';

import { type DbSession, MongoTransactions } from '../../db';
import { domainError } from '../../error-messages';
import { decodeCursor, encodeCursor } from '../../page-cursor';
import { PanelAudit } from '../panel';
import type { RideReportDoc } from './ride-reports.collection';
import { RideReportsRepository } from './ride-reports.repository';
import { RIDES_REPORTS_RESOLVED, type RidesReportsResolved } from './rides.events';
import { type ModerationAction, moderationTransition, ridePhase } from './rides.policy';
import { type RideModerationDoc, RidesRepository } from './rides.repository';

const CursorKey = z.iso.datetime();

const AUDIT_ACTION = {
  hide: 'ride.hidden',
  restore: 'ride.restored',
  dismiss: 'ride.reports_dismissed',
} as const satisfies Record<ModerationAction, string>;

const iso = (value: Date | null | undefined) => value?.toISOString() ?? null;

/** Поля райда для панели: организатор — только подпись (без id), без участников. */
function detailOf(
  doc: RideModerationDoc,
  reports: RideReportDoc[],
  now: Date,
): ModerationRideDetail {
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
    description: doc.description,
    status: doc.status,
    phase: ridePhase(doc, now),
    cancelReason: doc.cancelReason,
    rescheduledAt: iso(doc.rescheduledAt),
    hiddenAt: iso(doc.hiddenAt),
    openReportCount: doc.openReportCount ?? 0,
    lastReportAt: iso(doc.lastReportAt),
    version: doc.version,
    // без автора жалобы (8.3)
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

/**
 * Модерация кофе-райдов в панели (05b, `rides.moderate`): очередь, карточка и действия «Скрыть» / «Вернуть» /
 * «Отклонить жалобы». Действие — одна транзакция: **первой** — условная запись райда (по `version`; 8.1 D2), затем
 * закрытие открытых жалоб, событие `rides.reports-resolved` (закрыта хотя бы одна, ADR-0017) и `PanelAudit.append`
 * (откат — ни изменения, ни записи журнала, ни события). Порядок проверок — 8.1 D4.
 */
@Injectable()
export class RidesModerationService {
  constructor(
    private readonly rides: RidesRepository,
    private readonly reports: RideReportsRepository,
    private readonly audit: PanelAudit,
    private readonly transactions: MongoTransactions,
    private readonly outbox: MongoOutboxWriter,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  async list(query: ModerationRideQuery): Promise<ModerationRidePage> {
    const cursor = query.cursor ? decodeCursor(query.cursor, CursorKey) : null;
    const after = cursor ? { at: new Date(cursor.k), id: cursor.id } : null;
    const open = query.state === 'open';
    const docs = open
      ? await this.rides.listReported(after, query.limit + 1)
      : await this.rides.listHidden(after, query.limit + 1);
    const page = docs.slice(0, query.limit);
    const top = await this.reports.topReasons(page.map((doc) => doc._id));
    const now = this.clock.now();
    const last = page.at(-1);
    const lastKey = last ? (open ? last.lastReportAt : last.hiddenAt) : null;
    return {
      items: page.map((doc): ModerationRideRow => ({
        id: doc._id,
        title: doc.title,
        city: doc.cityCode,
        startsAt: doc.startsAt.toISOString(),
        status: doc.status,
        phase: ridePhase(doc, now),
        openReportCount: doc.openReportCount ?? 0,
        topReason: top.get(doc._id) ?? null,
        lastReportAt: iso(doc.lastReportAt),
        hiddenAt: iso(doc.hiddenAt),
      })),
      nextCursor:
        docs.length > query.limit && last && lastKey
          ? encodeCursor(lastKey.toISOString(), last._id)
          : null,
    };
  }

  async get(id: string): Promise<ModerationRideDetail> {
    const doc = await this.rides.findForModeration(id);
    if (!doc) throw domainError('NOT_FOUND', 404);
    return detailOf(doc, await this.reports.latest(id), this.clock.now());
  }

  hide(actorUserId: string, id: string, body: HideRideRequest): Promise<ModerationRideDetail> {
    return this.act(actorUserId, id, 'hide', body);
  }

  restore(
    actorUserId: string,
    id: string,
    body: RestoreRideRequest,
  ): Promise<ModerationRideDetail> {
    return this.act(actorUserId, id, 'restore', body);
  }

  dismiss(
    actorUserId: string,
    id: string,
    body: DismissRideReportsRequest,
  ): Promise<ModerationRideDetail> {
    return this.act(actorUserId, id, 'dismiss', body);
  }

  private async act(
    actorUserId: string,
    id: string,
    action: ModerationAction,
    body: { version: number; reason: string; lastReportAt?: string },
  ): Promise<ModerationRideDetail> {
    const now = this.clock.now();
    return this.transactions.run(async (tx) => {
      const current = await this.rides.findForModeration(id, tx);
      if (!current) throw domainError('NOT_FOUND', 404);
      if (current.version !== body.version) throw domainError('CONFLICT', 409);
      const seenAt = body.lastReportAt === undefined ? null : new Date(body.lastReportAt);
      // пришла жалоба, которую модератор не видел (у райда без жалоб сверять нечего — дальше 409 перехода)
      if (seenAt && current.lastReportAt && current.lastReportAt.getTime() !== seenAt.getTime()) {
        throw domainError('CONFLICT', 409);
      }
      if (moderationTransition(current, action) !== 'ok') {
        throw domainError('RIDE_INVALID_STATE', 409);
      }
      const updated = await this.write(tx, action, id, body.version, now, seenAt);
      if (!updated) throw domainError('CONFLICT', 409);
      const closed =
        action === 'restore'
          ? null
          : await this.reports.closeOpen(
              tx,
              id,
              action === 'hide' ? 'hidden' : 'dismissed',
              actorUserId,
              now,
            );
      if (closed !== null && closed > 0) {
        // авторы закрытых жалоб — по `resolvedAt` этого действия (RC-3), id жалоб в событие не идут
        const payload: RidesReportsResolved = { rideId: id, resolvedAt: now.toISOString() };
        await this.outbox.append(tx, { type: RIDES_REPORTS_RESOLVED, payload });
      }
      await this.audit.append(tx, {
        action: AUDIT_ACTION[action],
        actor: { kind: 'user', userId: actorUserId },
        subject: { kind: 'ride', id, label: updated.title },
        reason: body.reason,
        details: closed === null ? null : { reportCount: closed },
      });
      return detailOf(updated, await this.reports.latest(id, tx), now);
    });
  }

  /** Условная запись райда — первая запись транзакции (фильтр повторяет проверки). */
  private write(
    tx: DbSession,
    action: ModerationAction,
    id: string,
    version: number,
    now: Date,
    seenAt: Date | null,
  ): Promise<RideModerationDoc | null> {
    if (action === 'hide') return this.rides.hide(tx, id, version, now);
    if (action === 'restore') return this.rides.restore(tx, id, version, now);
    return seenAt ? this.rides.clearReports(tx, id, version, seenAt) : Promise.resolve(null);
  }
}
