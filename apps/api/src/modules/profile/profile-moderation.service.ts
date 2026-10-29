import { Inject, Injectable, Logger } from '@nestjs/common';
import type {
  DismissRiderProfileReportsRequest,
  ResetRiderNameRequest,
  RiderNameResetResult,
  RiderProfileModerationDetail,
  RiderProfileModerationPage,
  RiderProfileModerationQuery,
  RiderProfileReportsDismissResult,
  RiderProfileResetRequest,
  RiderProfileResetResult,
} from '@pokatim/contracts';
import { CLOCK, type Clock } from '@rkarakulov/api-kit/core';
import { z } from 'zod';

import { type DbSession, MongoTransactions } from '../../db';
import { domainError } from '../../error-messages';
import { decodeCursor, encodeCursor } from '../../page-cursor';
import { randomToken } from '../identity';
import { type AuditRecord, PanelAudit } from '../panel';
import { AvatarReissue } from './avatar-reissue';
import { ProfileAvatarRepository } from './profile-avatar.repository';
import { ProfileReportsRepository } from './profile-reports.repository';
import { isPublicProfile } from './profile.policy';
import {
  type ProfileModerationDoc,
  ProfileRepository,
  type ResetOutcome,
} from './profile.repository';

/** Подпись райдера в журнале действий (D3): снимок без ПДн — служебная подпись и короткий id, не имя. */
export const riderSubjectLabel = (userId: string) => `Участник ·${userId.slice(-6)}`;

const CursorKey = z.iso.datetime();

const iso = (value: Date | null | undefined) => value?.toISOString() ?? null;

/** Сброс модератором: что сбрасывается и чем журналируется. */
type ResetKind = 'name' | 'avatar' | 'club';

const RESET_AUDIT = {
  name: 'profile.name_reset',
  avatar: 'profile.avatar_reset',
  club: 'profile.club_reset',
} as const satisfies Record<ResetKind, AuditRecord['action']>;

/** Имя для панели — только при согласии (Q2). */
const nameOf = (doc: ProfileModerationDoc) =>
  isPublicProfile(doc) ? (doc.publicName ?? null) : null;

/**
 * Модерация публичного профиля райдера (profile-02, profile-moderation; `profiles.moderate`): очередь жалоб, карточка,
 * сбросы имени, фото и клуба, «Отклонить жалобы». Действие — одна транзакция: **первой** — условная запись профиля
 * (жалоба пишет тот же документ — транзакции конфликтуют), затем побочное (удаление фото, перевыпуск id фото), закрытие
 * открытых жалоб и `PanelAudit.append`; откат — ничего. Сбрасывать нечего — `{ reset: false }` без журнала, жалобы
 * открыты (D2); профиля нет — 404. В журнале — подпись `Участник ·<id>` (D3), причина и число закрытых жалоб; ни имени,
 * ни клуба, ни id фото — ни в журнале, ни в логе (D14).
 */
@Injectable()
export class ProfileModerationService {
  private readonly logger = new Logger(ProfileModerationService.name);

  constructor(
    private readonly repository: ProfileRepository,
    private readonly avatars: ProfileAvatarRepository,
    private readonly reports: ProfileReportsRepository,
    private readonly reissue: AvatarReissue,
    private readonly audit: PanelAudit,
    private readonly transactions: MongoTransactions,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  /** Очередь: профили с открытыми жалобами, от последней жалобы к старым. */
  async list(query: RiderProfileModerationQuery): Promise<RiderProfileModerationPage> {
    const cursor = query.cursor ? decodeCursor(query.cursor, CursorKey) : null;
    const after = cursor ? { at: new Date(cursor.k), id: cursor.id } : null;
    const docs = await this.repository.reportQueue(after, query.limit + 1);
    const page = docs.slice(0, query.limit);
    const top = await this.reports.topReasons(page.map((doc) => doc._id));
    const last = page.at(-1);
    return {
      items: page.map((doc) => ({
        userId: doc._id,
        name: nameOf(doc),
        openReportCount: doc.openReportCount ?? 0,
        topReason: top.get(doc._id) ?? null,
        lastReportAt: iso(doc.lastReportAt),
        hasAvatar: typeof doc.avatarId === 'string',
        hasClub: typeof doc.club === 'string',
      })),
      nextCursor:
        docs.length > query.limit && last?.lastReportAt
          ? encodeCursor(last.lastReportAt.toISOString(), last._id)
          : null,
    };
  }

  /** Карточка: клуб и фото — всегда (S-2), имя — по Q2, жалобы — без автора. */
  async detail(userId: string): Promise<RiderProfileModerationDetail> {
    const doc = await this.repository.findForModeration(userId);
    if (!doc) throw domainError('NOT_FOUND', 404);
    const reports = await this.reports.latest(userId);
    return {
      userId: doc._id,
      name: nameOf(doc),
      club: doc.club ?? null,
      avatar: doc.avatarId ? { id: doc.avatarId } : null,
      isPublic: isPublicProfile(doc),
      openReportCount: doc.openReportCount ?? 0,
      lastReportAt: iso(doc.lastReportAt),
      reportRevision: doc.reportRevision ?? 0,
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
   * Сброс публичного имени (profile-02, D5): согласие не трогается; был публичен — перевыпуск id фото (RC-A2 (b));
   * открытые жалобы закрываются как `actioned`.
   */
  resetName(
    actorUserId: string,
    userId: string,
    body: ResetRiderNameRequest,
  ): Promise<RiderNameResetResult> {
    const newAvatarId = randomToken();
    return this.reset(actorUserId, userId, body, 'name', async (tx, now) => {
      const result = await this.repository.resetPublicName(tx, userId, now);
      if (result.outcome === 'reset' && result.wasPublic && result.avatarId) {
        await this.reissue.reissue(tx, userId, result.avatarId, newAvatarId, now);
      }
      return result.outcome;
    });
  }

  /** Сброс фото: документ фото удаляется — прежний URL отдаёт 404. */
  resetAvatar(
    actorUserId: string,
    userId: string,
    body: RiderProfileResetRequest,
  ): Promise<RiderProfileResetResult> {
    return this.reset(actorUserId, userId, body, 'avatar', async (tx, now) => {
      const result = await this.repository.resetAvatar(tx, userId, now);
      if (result.avatarId) await this.avatars.delete(tx, result.avatarId, userId);
      return result.outcome;
    });
  }

  /** Сброс клуба. */
  resetClub(
    actorUserId: string,
    userId: string,
    body: RiderProfileResetRequest,
  ): Promise<RiderProfileResetResult> {
    return this.reset(actorUserId, userId, body, 'club', (tx, now) =>
      this.repository.resetClub(tx, userId, now),
    );
  }

  /**
   * «Отклонить жалобы»: профиль не меняется, открытые закрываются как `dismissed`. Пришла жалоба после чтения
   * карточки (ревизия другая) — 409 `CONFLICT` (RC-P1); открытых уже нет — `{ dismissed: false }` без журнала (RC-P2).
   */
  async dismissReports(
    actorUserId: string,
    userId: string,
    body: DismissRiderProfileReportsRequest,
  ): Promise<RiderProfileReportsDismissResult> {
    const now = this.clock.now();
    const dismissed = await this.transactions.run(async (tx) => {
      const current = await this.repository.findForModeration(userId, tx);
      if (!current) throw domainError('NOT_FOUND', 404);
      if ((current.reportRevision ?? 0) !== body.reportRevision) throw domainError('CONFLICT', 409);
      if ((current.openReportCount ?? 0) === 0) return false;
      if (!(await this.repository.clearReports(tx, userId, body.reportRevision))) {
        throw domainError('CONFLICT', 409);
      }
      const closed = await this.reports.closeOpen(tx, userId, 'dismissed', actorUserId, now);
      await this.appendAudit(
        tx,
        'profile.reports_dismissed',
        actorUserId,
        userId,
        body.reason,
        closed,
      );
      return true;
    });
    this.logger.log(`profile reports dismissed by ${actorUserId} dismissed=${dismissed}`);
    return { dismissed };
  }

  /** Общий ход сброса: условная запись профиля (`write`) → закрытие жалоб → журнал. */
  private async reset(
    actorUserId: string,
    userId: string,
    body: RiderProfileResetRequest,
    kind: ResetKind,
    write: (tx: DbSession, now: Date) => Promise<ResetOutcome>,
  ): Promise<RiderProfileResetResult> {
    const now = this.clock.now();
    const reset = await this.transactions.run(async (tx) => {
      const outcome = await write(tx, now);
      if (outcome === 'not_found') throw domainError('NOT_FOUND', 404);
      if (outcome === 'empty') return false;
      const closed = await this.reports.closeOpen(tx, userId, 'actioned', actorUserId, now);
      await this.appendAudit(tx, RESET_AUDIT[kind], actorUserId, userId, body.reason, closed);
      return true;
    });
    this.logger.log(`profile ${kind} reset by ${actorUserId} reset=${reset}`);
    return { reset };
  }

  private appendAudit(
    tx: DbSession,
    action: AuditRecord['action'],
    actorUserId: string,
    userId: string,
    reason: string,
    reportCount: number,
  ): Promise<unknown> {
    return this.audit.append(tx, {
      action,
      actor: { kind: 'user', userId: actorUserId },
      // targetUserId не заполняется: читатель журнала ищет его среди членов команды (D3)
      subject: { kind: 'rider', id: userId, label: riderSubjectLabel(userId) },
      reason,
      details: { reportCount },
    });
  }
}
