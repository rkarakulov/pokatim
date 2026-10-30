import { Inject, Injectable } from '@nestjs/common';
import type { InvitationEmailState } from '@pokatim/contracts';
import { MONGO_DB } from '@rkarakulov/api-kit/mongo';
import type { Collection, Db } from 'mongodb';

import type { DbSession } from '../../db';
import { PANEL_COLLECTIONS, type PanelInvitationDoc } from './panel.collection';
import { PANEL_POLICY } from './panel.policy';

export type NewPanelInvitation = Omit<
  PanelInvitationDoc,
  | 'status'
  | 'revokedReason'
  | 'emailState'
  | 'acceptedUserId'
  | 'acceptedAt'
  | 'revokedAt'
  | 'purgeAt'
  | 'version'
>;

const purgeAfter = (at: Date) => new Date(at.getTime() + PANEL_POLICY.invitationPurgeAfterMs);

/** Поля закрытия: адрес больше не хранится (RC-6), уборка — через 30 суток после закрытия. */
const closed = (at: Date) => ({ email: null, purgeAt: purgeAfter(at) });

/**
 * Единственный писатель `panel_invitations` (ADR-0026). Правила сериализации (`pokatim-db.md`):
 * - принятие приглашения в своей транзакции пишет документ приглашения замком `lockPending` (`$inc version` при
 *   `pending` и `expiresAt > now`) — отзыв, замена и второе принятие пишут тот же документ и конфликтуют с ним;
 *   `markAccepted` — только под этим замком;
 * - одно `pending` на адрес держит частичный уникальный индекс `panel_invitations_pending_email_unique` (гонку двух
 *   приглашений одного адреса вызывающий повторяет транзакцией);
 * - e-mail — только у `pending`, закрытие пишет `email: null`; токен — только sha256 (`tokenHash`);
 * - значения фильтров — только примитивы после zod (id, хеши, нормализованный e-mail, даты).
 */
@Injectable()
export class PanelInvitationsRepository {
  // только своя коллекция: журнал панели по имени знает лишь `PanelRepository` (сторож append-only)
  private readonly c: { invitations: Collection<PanelInvitationDoc> };

  constructor(@Inject(MONGO_DB) db: Db) {
    this.c = { invitations: db.collection<PanelInvitationDoc>(PANEL_COLLECTIONS.invitations) };
  }

  /** Новое `pending`; второе `pending` того же адреса ловит частичный уникальный индекс. */
  async insert(tx: DbSession, invitation: NewPanelInvitation): Promise<PanelInvitationDoc> {
    const doc: PanelInvitationDoc = {
      ...invitation,
      status: 'pending',
      revokedReason: null,
      emailState: 'pending',
      acceptedUserId: null,
      acceptedAt: null,
      revokedAt: null,
      purgeAt: purgeAfter(invitation.expiresAt),
      version: 0,
    };
    await this.c.invitations.insertOne(doc, { session: tx });
    return doc;
  }

  /** Замена: любое `pending` адреса (в т. ч. истёкшее, RC-5) — `revoked` с причиной `replaced`. */
  async closePending(tx: DbSession, email: string, now: Date): Promise<number> {
    const result = await this.c.invitations.updateMany(
      { email, status: 'pending' },
      {
        $set: { status: 'revoked', revokedReason: 'replaced', revokedAt: now, ...closed(now) },
        $inc: { version: 1 },
      },
      { session: tx },
    );
    return result.modifiedCount;
  }

  /** Отзыв `pending` (истёкшее тоже отзывается); не `pending` — `undefined`. Возвращает документ до отзыва. */
  async revokePending(
    tx: DbSession,
    id: string,
    now: Date,
  ): Promise<PanelInvitationDoc | undefined> {
    const doc = await this.c.invitations.findOneAndUpdate(
      { _id: id, status: 'pending' },
      {
        $set: { status: 'revoked', revokedReason: 'revoked', revokedAt: now, ...closed(now) },
        $inc: { version: 1 },
      },
      { session: tx, returnDocument: 'before' },
    );
    return doc ?? undefined;
  }

  /** Замок принятия: живое `pending` (`expiresAt > now`) под записью `version`; иначе `undefined`. */
  async lockPending(tx: DbSession, id: string, now: Date): Promise<PanelInvitationDoc | undefined> {
    const doc = await this.c.invitations.findOneAndUpdate(
      { _id: id, status: 'pending', expiresAt: { $gt: now } },
      { $inc: { version: 1 } },
      { session: tx, returnDocument: 'after' },
    );
    return doc ?? undefined;
  }

  /** Принято — под `lockPending` той же транзакции; не `pending` (замок обойдён) — `false`, вызывающий откатывает. */
  async markAccepted(tx: DbSession, id: string, userId: string, now: Date): Promise<boolean> {
    const result = await this.c.invitations.updateOne(
      { _id: id, status: 'pending' },
      { $set: { status: 'accepted', acceptedUserId: userId, acceptedAt: now, ...closed(now) } },
      { session: tx },
    );
    return result.matchedCount === 1;
  }

  /** Итог письма — одна условная запись (только у `pending`: закрытое приглашение не меняется). */
  async setEmailState(id: string, state: InvitationEmailState): Promise<void> {
    await this.c.invitations.updateOne(
      { _id: id, status: 'pending' },
      { $set: { emailState: state } },
    );
  }

  /** Живое приглашение по хешу токена: `pending` и `expiresAt > now`. */
  async findLiveByTokenHash(tokenHash: string, now: Date): Promise<PanelInvitationDoc | undefined> {
    const doc = await this.c.invitations.findOne({
      tokenHash,
      status: 'pending',
      expiresAt: { $gt: now },
    });
    return doc ?? undefined;
  }

  async findById(id: string, tx?: DbSession): Promise<PanelInvitationDoc | undefined> {
    const doc = await this.c.invitations.findOne({ _id: id }, { session: tx });
    return doc ?? undefined;
  }

  /** Блок «Приглашения»: `pending` (и истёкшие) новыми сверху; `limit + 1` — признак обрезки у вызывающего. */
  listPending(limit: number): Promise<PanelInvitationDoc[]> {
    return this.c.invitations
      .find({ status: 'pending' })
      .sort({ createdAt: -1, _id: -1 })
      .hint('panel_invitations_status_created_idx')
      .limit(limit)
      .toArray();
  }
}
