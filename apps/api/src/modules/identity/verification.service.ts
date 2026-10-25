import { Inject, Injectable } from '@nestjs/common';
import type {
  ConfirmVerificationResponse,
  LinkExpiredDetails,
  RateLimitedDetails,
  ResendVerificationRequest,
  ResendVerificationResponse,
  VerificationLinkInfo,
} from '@pokatim/contracts';
import { CLOCK, type Clock, ENV, RateLimiter } from '@rkarakulov/api-kit/core';
import { MongoOutboxWriter, uuidv7 } from '@rkarakulov/api-kit/mongo';

import type { Env } from '../../config/env';
import { type DbSession, MongoTransactions } from '../../db';
import { domainError } from '../../error-messages';
import { VERIFICATION_EMAIL_REQUESTED, type VerificationEmailRequested } from './identity.events';
import { IDENTITY_POLICY } from './identity.policy';
import {
  IdentityRepository,
  type UserState,
  type VerificationTokenState,
} from './identity.repository';
import { deriveVerificationToken, sha256 } from './tokens';

const notFound = () => domainError('NOT_FOUND', 404);
const unauthorized = () => domainError('UNAUTHORIZED', 401);

/** Ссылка больше не активирует: истекла, заменена новой или уже использована. */
function isStale(token: VerificationTokenState, now: Date): boolean {
  return token.usedAt !== null || token.supersededAt !== null || token.expiresAt <= now;
}

/** Ссылки подтверждения e-mail: выпуск, просмотр без побочных эффектов, подтверждение POST, повтор письма. */
@Injectable()
export class VerificationService {
  constructor(
    private readonly repository: IdentityRepository,
    private readonly transactions: MongoTransactions,
    private readonly outbox: MongoOutboxWriter,
    private readonly rateLimiter: RateLimiter,
    @Inject(ENV) private readonly env: Env,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  /** Новая ссылка и событие на письмо — в транзакции вызывающего. Возвращает срок ссылки. */
  async issueLink(tx: DbSession, userId: string, now: Date): Promise<Date> {
    const id = uuidv7();
    const expiresAt = new Date(now.getTime() + IDENTITY_POLICY.verificationLinkTtlMs);
    const tokenHash = sha256(deriveVerificationToken(this.env.EMAIL_TOKEN_SECRET, id));
    await this.repository.insertVerificationToken(tx, {
      id,
      userId,
      tokenHash,
      createdAt: now,
      expiresAt,
    });
    const payload: VerificationEmailRequested = { verificationTokenId: id };
    await this.outbox.append(tx, { type: VERIFICATION_EMAIL_REQUESTED, payload });
    return expiresAt;
  }

  /** Пауза 60 с и не больше 10 писем за сутки на аккаунт; регистрация — первое письмо. */
  async takeResendAllowance(userId: string, now: Date): Promise<void> {
    const result = await this.rateLimiter.consume(
      `verify-resend:${userId}`,
      IDENTITY_POLICY.resendLimit,
      now,
    );
    if (!result.allowed) {
      const details: RateLimitedDetails = { retryAfterSec: result.retryAfterSec };
      throw domainError('RATE_LIMITED', 429, details);
    }
  }

  /** `GET` по ссылке: только чтение. `verified` важнее `expired`. */
  async describeLink(token: string): Promise<VerificationLinkInfo> {
    const found = await this.repository.findVerificationByHash(sha256(token));
    if (!found || found.user.deletedAt) throw notFound();
    const { email } = found.user;
    if (found.user.emailVerifiedAt) return { state: 'verified', email };
    if (isStale(found.token, this.clock.now())) return { state: 'expired', email };
    return { state: 'valid', email };
  }

  /** Активация только POST; повтор для подтверждённого аккаунта — тот же ответ. */
  async confirm(token: string): Promise<ConfirmVerificationResponse> {
    const tokenHash = sha256(token);
    const now = this.clock.now();
    const found = await this.repository.findVerificationByHash(tokenHash);
    if (!found) throw notFound();

    return this.transactions.run(async (tx) => {
      const user = await this.repository.lockUser(tx, found.user.id);
      if (!user || user.deletedAt) throw notFound();
      if (user.emailVerifiedAt) return { state: 'verified', email: user.email };
      // под блокировкой аккаунта: ссылку могли заменить параллельным повтором
      const current = await this.repository.findVerificationByHash(tokenHash, tx);
      if (!current || isStale(current.token, now)) {
        const details: LinkExpiredDetails = { email: user.email };
        throw domainError('LINK_EXPIRED', 410, details);
      }
      await this.repository.markEmailVerified(tx, user.id, now);
      await this.repository.markVerificationUsed(tx, current.token.id, now);
      return { state: 'verified', email: user.email };
    });
  }

  /** Новая ссылка отменяет прежние и продлевает токен регистрации до своего срока. */
  async resend(request: ResendVerificationRequest): Promise<ResendVerificationResponse> {
    const now = this.clock.now();
    const owner =
      'registrationToken' in request
        ? await this.ownerByRegistrationToken(request.registrationToken, now)
        : await this.ownerByLinkToken(request.linkToken);
    if (owner.emailVerifiedAt) return { state: 'verified' };

    await this.takeResendAllowance(owner.id, now);

    return this.transactions.run(async (tx) => {
      const user = await this.repository.lockUser(tx, owner.id);
      if (!user || user.deletedAt) throw notFound();
      if (user.emailVerifiedAt) return { state: 'verified' as const };
      await this.repository.supersedeActiveVerificationTokens(tx, user.id, now);
      const expiresAt = await this.issueLink(tx, user.id, now);
      await this.repository.extendRegistrationToken(tx, user.id, expiresAt, now);
      return { resendAvailableInSec: IDENTITY_POLICY.resendLimit.cooldownSec };
    });
  }

  private async ownerByRegistrationToken(token: string, now: Date): Promise<UserState> {
    const found = await this.repository.findRegistrationByHash(sha256(token));
    if (!found || found.user.deletedAt || found.token.consumedAt || found.token.expiresAt <= now) {
      throw unauthorized();
    }
    return found.user;
  }

  private async ownerByLinkToken(token: string): Promise<UserState> {
    const found = await this.repository.findVerificationByHash(sha256(token));
    if (!found || found.user.deletedAt) throw notFound();
    return found.user;
  }
}
