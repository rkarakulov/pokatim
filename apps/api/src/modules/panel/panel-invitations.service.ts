import { Inject, Injectable, Logger } from '@nestjs/common';
import {
  type InviteRequest,
  normalizeEmail,
  type PanelInvitation,
  type PanelInvitationList,
} from '@pokatim/contracts';
import { CLOCK, type Clock, ENV, RateLimiter } from '@rkarakulov/api-kit/core';
import { MongoOutboxWriter, uuidv7 } from '@rkarakulov/api-kit/mongo';

import { type Env, panelLinkBase } from '../../config/env';
import { MongoTransactions } from '../../db';
import { domainError } from '../../error-messages';
import { consumeUserLimit } from '../../user-limit';
import { IdentityAccounts, type VerifiedCredentials } from '../identity';
import type { PanelPrincipal } from './current-panel-user.decorator';
import { PanelAudit } from './panel-audit';
import type { AuditSubjectDoc, PanelInvitationDoc } from './panel.collection';
import {
  PANEL_INVITATION_EMAIL_REQUESTED,
  type PanelInvitationEmailRequested,
} from './panel.events';
import { invitationTokenHash, panelInvitationToken } from './panel-invitation-token';
import { PanelInvitationsRepository } from './panel-invitations.repository';
import { PanelMembersService, runWithInsertRetry } from './panel-members.service';
import { DELETED_MEMBER, PANEL_POLICY } from './panel.policy';
import { PanelRepository } from './panel.repository';

const PENDING_EMAIL_INDEX = 'panel_invitations_pending_email_unique';

export const invitationInvalid = () => domainError('PANEL_INVITATION_INVALID', 410);

/** Объект записи журнала: подпись — `Приглашение ·<id>` (имя не принявшего человека в журнал не пишется). */
const invitationSubject = (id: string): AuditSubjectDoc => ({
  kind: 'invitation',
  id,
  label: `Приглашение ·${id.slice(-6)}`,
});

/**
 * Приглашения в команду панели (ADR-0026): список, приглашение (замена живого того же адреса), отзыв и транзакция
 * принятия. Журнал и outbox — в транзакции действия; e-mail — только в документе `pending` (не в журнале, outbox и
 * логах), токен ссылки — HMAC от id, в БД — sha256.
 */
@Injectable()
export class PanelInvitationsService {
  private readonly logger = new Logger('PanelInvitations');

  constructor(
    private readonly invitations: PanelInvitationsRepository,
    private readonly repository: PanelRepository,
    private readonly members: PanelMembersService,
    private readonly audit: PanelAudit,
    private readonly accounts: IdentityAccounts,
    private readonly transactions: MongoTransactions,
    private readonly outbox: MongoOutboxWriter,
    private readonly rateLimiter: RateLimiter,
    @Inject(ENV)
    private readonly env: Pick<Env, 'EMAIL_TOKEN_SECRET' | 'PANEL_LINK_BASE' | 'APP_WEB_ORIGIN'>,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  /** Блок «Приглашения»: `pending` (истёкшие — с `expired`), новые сверху, до cap; «пригласил» — имя сотрудника. */
  async list(): Promise<PanelInvitationList> {
    const cap = PANEL_POLICY.invitationListCap;
    const docs = await this.invitations.listPending(cap + 1);
    const items = docs.slice(0, cap);
    const names = await this.repository.displayNames([...new Set(items.map((d) => d.invitedBy))]);
    const now = this.clock.now();
    return {
      items: items.map((doc) => toPanelInvitation(doc, names, now)),
      truncated: docs.length > cap,
    };
  }

  /**
   * Пригласить (RC-9: лимит на сотрудника до БД) → нет адреса панели для ссылки — 503 → адрес активного члена — 409
   * `PANEL_ALREADY_MEMBER` → транзакция (повтор один раз на дубль `pending` адреса): любое `pending` адреса
   * (в т. ч. истёкшее) — `replaced` → новое → `panel.invitation_sent { roleTo }` → outbox письма.
   */
  async invite(actor: PanelPrincipal, input: InviteRequest): Promise<PanelInvitation> {
    await consumeUserLimit(
      this.rateLimiter,
      `panel-invitations-user:${actor.userId}`,
      PANEL_POLICY.invitationsUserLimit,
      this.clock.now(),
    );
    if (panelLinkBase(this.env) === null) throw domainError('PANEL_INVITATIONS_UNAVAILABLE', 503);
    const email = normalizeEmail(input.email);
    const account = await this.accounts.findVerifiedByEmail(email);
    if (account && (await this.repository.findActiveMember(account.userId))) {
      throw domainError('PANEL_ALREADY_MEMBER', 409);
    }

    const id = uuidv7();
    const tokenHash = invitationTokenHash(panelInvitationToken(this.env.EMAIL_TOKEN_SECRET, id));
    const doc = await runWithInsertRetry(this.transactions, PENDING_EMAIL_INDEX, async (tx) => {
      const now = this.clock.now();
      await this.invitations.closePending(tx, email, now);
      const inserted = await this.invitations.insert(tx, {
        _id: id,
        email,
        role: input.role,
        displayName: input.displayName,
        invitedBy: actor.userId,
        tokenHash,
        createdAt: now,
        expiresAt: new Date(now.getTime() + PANEL_POLICY.invitationTtlMs),
      });
      await this.audit.append(tx, {
        action: 'panel.invitation_sent',
        actor: { kind: 'user', userId: actor.userId },
        subject: invitationSubject(id),
        details: { roleTo: input.role },
      });
      const payload: PanelInvitationEmailRequested = { invitationId: id };
      await this.outbox.append(tx, { type: PANEL_INVITATION_EMAIL_REQUESTED, payload });
      return inserted;
    });
    this.logger.log(`panel.invitation_sent invitation=${id} uid=${actor.userId}`);
    const names = await this.repository.displayNames([actor.userId]);
    return toPanelInvitation(doc, names, this.clock.now());
  }

  /** Отозвать `pending` (истёкшее тоже); не `pending` — 404. Журнал `panel.invitation_revoked { roleTo }`. */
  async revoke(actor: PanelPrincipal, id: string): Promise<void> {
    await this.transactions.run(async (tx) => {
      const revoked = await this.invitations.revokePending(tx, id, this.clock.now());
      if (!revoked) throw domainError('NOT_FOUND', 404);
      await this.audit.append(tx, {
        action: 'panel.invitation_revoked',
        actor: { kind: 'user', userId: actor.userId },
        subject: invitationSubject(id),
        details: { roleTo: revoked.role },
      });
    });
    this.logger.log(`panel.invitation_revoked invitation=${id} uid=${actor.userId}`);
  }

  /**
   * Транзакция принятия (после пароля и сверки e-mail у вызывающего): замок аккаунта (RC-3: удалён или сменён пароль
   * после проверки — 401) → `lockAdmins` (роль admin — единый порядок замков с выдачей) → замок приглашения (не живое
   * `pending` — 410) → `lockMember` (уже активен — 409, приглашение остаётся) → активация → `accepted` → журнал
   * `panel.invitation_accepted` (актор и цель — принявший). Письма о роли нет — человек принял сам.
   */
  async acceptIn(snapshot: PanelInvitationDoc, verified: VerifiedCredentials): Promise<void> {
    const { userId } = verified;
    await runWithInsertRetry(this.transactions, '_id_', async (tx) => {
      const account = await this.accounts.lockAccountState(tx, userId);
      if (!account?.active || account.credentialsStamp !== verified.credentialsStamp) {
        throw domainError('INVALID_CREDENTIALS', 401);
      }
      if (snapshot.role === 'admin') await this.repository.lockAdmins(tx);
      const now = this.clock.now();
      const invitation = await this.invitations.lockPending(tx, snapshot._id, now);
      if (!invitation) throw invitationInvalid();
      const current = await this.repository.lockMember(tx, userId);
      if (current?.status === 'active') throw domainError('PANEL_ALREADY_MEMBER', 409);
      await this.members.activateIn(tx, current, {
        userId,
        role: invitation.role,
        displayName: invitation.displayName,
      });
      // защита в глубину: не `pending` под замком — откат всей транзакции (активации нет)
      if (!(await this.invitations.markAccepted(tx, invitation._id, userId, now))) {
        throw invitationInvalid();
      }
      await this.audit.append(tx, {
        action: 'panel.invitation_accepted',
        actor: { kind: 'user', userId },
        targetUserId: userId,
        subject: invitationSubject(invitation._id),
        details: { roleTo: invitation.role },
      });
    });
    this.logger.log(`panel.invitation_accepted uid=${userId} invitation=${snapshot._id}`);
  }
}

function toPanelInvitation(
  doc: PanelInvitationDoc,
  names: Map<string, string>,
  now: Date,
): PanelInvitation {
  return {
    id: doc._id,
    email: doc.email ?? '',
    displayName: doc.displayName,
    role: doc.role,
    invitedBy: names.get(doc.invitedBy) ?? DELETED_MEMBER,
    createdAt: doc.createdAt.toISOString(),
    expiresAt: doc.expiresAt.toISOString(),
    expired: doc.expiresAt.getTime() <= now.getTime(),
    emailState: doc.emailState,
  };
}
