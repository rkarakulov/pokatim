import { Inject, Injectable, Logger } from '@nestjs/common';
import {
  type DismissRiderProfileReportsRequest,
  PROFILE_REPORT_REASONS,
  type ProfileReportReason,
  type ResetRiderNameRequest,
  type RiderAvatarUnblockResult,
  type RiderNameResetResult,
  type RiderProfileModerationDetail,
  type RiderProfileModerationPage,
  type RiderProfileModerationQuery,
  type RiderProfileReportsDismissResult,
  type RiderProfileResetRequest,
  type RiderProfileResetResult,
  type UnblockRiderAvatarRequest,
} from '@pokatim/contracts';
import { CLOCK, type Clock } from '@rkarakulov/api-kit/core';
import { MongoOutboxWriter } from '@rkarakulov/api-kit/mongo';
import { z } from 'zod';

import { type DbSession, MongoTransactions } from '../../db';
import { domainError } from '../../error-messages';
import { decodeCursor, encodeCursor } from '../../page-cursor';
import { randomToken } from '../identity';
import { type AuditRecord, PanelAudit } from '../panel';
import { AvatarReissue } from './avatar-reissue';
import { ProfileAvatarRepository } from './profile-avatar.repository';
import { ProfileReportsRepository } from './profile-reports.repository';
import {
  PROFILE_FIELD_RESET,
  type ProfileFieldReset,
  type ProfileResetField,
} from './profile.events';
import { activeBlock, avatarResetBan, isPublicProfile, resetsInWindow } from './profile.policy';
import {
  type ProfileModerationDoc,
  ProfileRepository,
  type ResetOutcome,
} from './profile.repository';

/** Подпись райдера в журнале действий (D3): снимок без ПДн — служебная подпись и короткий id, не имя. */
export const riderSubjectLabel = (userId: string) => `Участник ·${userId.slice(-6)}`;

const CursorKey = z.iso.datetime();

const iso = (value: Date | null | undefined) => value?.toISOString() ?? null;

/** Сброс модератором: что сбрасывается и чем журналируется (= поле события `profile.field-reset`). */
type ResetKind = ProfileResetField;

/** Итог записи сброса: исход условной записи и срок запрета, включённого этим сбросом (только фото). */
interface ResetWrite {
  outcome: ResetOutcome;
  imposed?: Date | null;
}

/** Причины открытых жалоб строки очереди — порядок справочника (`$addToSet` порядок не держит). */
const orderedReasons = (reasons: readonly ProfileReportReason[] | undefined) =>
  PROFILE_REPORT_REASONS.filter((reason) => reasons?.includes(reason));

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
    private readonly outbox: MongoOutboxWriter,
    private readonly transactions: MongoTransactions,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  /** Очередь: профили с открытыми жалобами (с причиной — только с открытой жалобой этой причины), новые сверху. */
  async list(query: RiderProfileModerationQuery): Promise<RiderProfileModerationPage> {
    const cursor = query.cursor ? decodeCursor(query.cursor, CursorKey) : null;
    const after = cursor ? { at: new Date(cursor.k), id: cursor.id } : null;
    const docs = await this.repository.reportQueue(after, query.limit + 1, query.reason);
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
        openReasons: orderedReasons(doc.openReasons),
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
    const now = this.clock.now();
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
      avatarUploadBlockedUntil: iso(activeBlock(doc.avatarBlockedUntil, now)),
      avatarResetCount: resetsInWindow(doc.avatarResetsAt, now).length,
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
      return { outcome: result.outcome };
    });
  }

  /**
   * Сброс фото: документ фото удаляется — прежний URL отдаёт 404. История сбросов и запрет загрузки (RC-F7) — второй
   * записью того же профиля; 3-й сброс за окно — запрет, его срок — в журнал и событие.
   */
  resetAvatar(
    actorUserId: string,
    userId: string,
    body: RiderProfileResetRequest,
  ): Promise<RiderProfileResetResult> {
    return this.reset(actorUserId, userId, body, 'avatar', async (tx, now) => {
      const result = await this.repository.resetAvatar(tx, userId, now);
      if (result.outcome !== 'reset') return { outcome: result.outcome };
      const ban = avatarResetBan(result, now);
      await this.repository.recordAvatarReset(tx, userId, ban.resets, ban.blockedUntil);
      if (result.avatarId) await this.avatars.delete(tx, result.avatarId, userId);
      return { outcome: result.outcome, imposed: ban.imposed };
    });
  }

  /** Сброс клуба. */
  resetClub(
    actorUserId: string,
    userId: string,
    body: RiderProfileResetRequest,
  ): Promise<RiderProfileResetResult> {
    return this.reset(actorUserId, userId, body, 'club', async (tx, now) => ({
      outcome: await this.repository.resetClub(tx, userId, now),
    }));
  }

  /**
   * «Снять запрет» загрузки фото (profile-moderation-followups): первой — условная запись профиля (запрет действует),
   * затем журнал `profile.avatar_unblocked` (без `details`); история сбросов остаётся — следующий сброс в окне снова
   * запрещает. Запрета нет или истёк — `{ unblocked: false }` без журнала; профиля нет — 404. Без события.
   */
  async unblockAvatar(
    actorUserId: string,
    userId: string,
    body: UnblockRiderAvatarRequest,
  ): Promise<RiderAvatarUnblockResult> {
    const now = this.clock.now();
    const unblocked = await this.transactions.run(async (tx) => {
      const outcome = await this.repository.unblockAvatar(tx, userId, now);
      if (outcome === 'not_found') throw domainError('NOT_FOUND', 404);
      if (outcome === 'none') return false;
      await this.audit.append(tx, {
        action: 'profile.avatar_unblocked',
        actor: { kind: 'user', userId: actorUserId },
        subject: { kind: 'rider', id: userId, label: riderSubjectLabel(userId) },
        reason: body.reason,
        details: null,
      });
      return true;
    });
    this.logger.log(`profile avatar unblock by ${actorUserId} unblocked=${unblocked}`);
    return { unblocked };
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

  /**
   * Общий ход сброса: условная запись профиля (`write`) → закрытие жалоб → журнал → outbox `profile.field-reset`
   * (уведомление райдеру, followups) — всё в одной транзакции; нечего сбрасывать — без журнала и события.
   */
  private async reset(
    actorUserId: string,
    userId: string,
    body: RiderProfileResetRequest,
    kind: ResetKind,
    write: (tx: DbSession, now: Date) => Promise<ResetWrite>,
  ): Promise<RiderProfileResetResult> {
    const now = this.clock.now();
    const reset = await this.transactions.run(async (tx) => {
      const { outcome, imposed = null } = await write(tx, now);
      if (outcome === 'not_found') throw domainError('NOT_FOUND', 404);
      if (outcome === 'empty') return false;
      const closed = await this.reports.closeOpen(tx, userId, 'actioned', actorUserId, now);
      await this.appendAudit(
        tx,
        RESET_AUDIT[kind],
        actorUserId,
        userId,
        body.reason,
        closed,
        imposed,
      );
      const payload: ProfileFieldReset = {
        userId,
        field: kind,
        resetAt: now.toISOString(),
        avatarBlockedUntil: iso(imposed),
      };
      await this.outbox.append(tx, { type: PROFILE_FIELD_RESET, payload });
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
    avatarBlockedUntil: Date | null = null,
  ): Promise<unknown> {
    return this.audit.append(tx, {
      action,
      actor: { kind: 'user', userId: actorUserId },
      // targetUserId не заполняется: читатель журнала ищет его среди членов команды (D3)
      subject: { kind: 'rider', id: userId, label: riderSubjectLabel(userId) },
      reason,
      details: avatarBlockedUntil
        ? { reportCount, avatarBlockedUntil: avatarBlockedUntil.toISOString() }
        : { reportCount },
    });
  }
}
