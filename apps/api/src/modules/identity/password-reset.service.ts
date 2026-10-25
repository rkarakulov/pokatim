import { Inject, Injectable, Logger } from '@nestjs/common';
import {
  type ConfirmPasswordResetRequest,
  type ConfirmPasswordResetResponse,
  type LinkExpiredDetails,
  normalizeEmail,
  type PasswordResetLinkInfo,
  type RateLimitedDetails,
  type RequestPasswordResetResponse,
} from '@pokatim/contracts';
import { CLOCK, type Clock, ENV, RateLimiter } from '@rkarakulov/api-kit/core';
import { MongoOutboxWriter, uuidv7 } from '@rkarakulov/api-kit/mongo';

import type { Env } from '../../config/env';
import { MongoTransactions } from '../../db';
import { domainError } from '../../error-messages';
import {
  PASSWORD_CHANGED_EMAIL_REQUESTED,
  PASSWORD_RESET_EMAIL_REQUESTED,
  type PasswordChangedEmailRequested,
  type PasswordResetEmailRequested,
} from './identity.events';
import { IDENTITY_POLICY } from './identity.policy';
import { IdentityRepository, type PasswordResetTokenState } from './identity.repository';
import { PasswordHasher } from './password-hasher';
import { derivePasswordResetToken, passwordResetLimitKeys, sha256 } from './tokens';

const notFound = () => domainError('NOT_FOUND', 404);
const linkExpired = (email: string) => {
  const details: LinkExpiredDetails = { email };
  return domainError('LINK_EXPIRED', 410, details);
};

/** Ссылка больше не меняет пароль: использована, заменена новой или истекла. */
function isStale(token: PasswordResetTokenState, now: Date): boolean {
  return token.usedAt !== null || token.supersededAt !== null || token.expiresAt <= now;
}

/**
 * Сброс пароля по ссылке из письма (ADR-0006): нейтральный запрос, чтение ссылки без побочных эффектов, смена
 * пароля POST. Смена отзывает все сессии аккаунта, гасит токен регистрации, подтверждает e-mail (Q4) и сессию не
 * выдаёт (Q2). Все мутации аккаунта — под `lockUser`.
 */
@Injectable()
export class PasswordResetService {
  private readonly logger = new Logger(PasswordResetService.name);

  constructor(
    private readonly repository: IdentityRepository,
    private readonly transactions: MongoTransactions,
    private readonly hasher: PasswordHasher,
    private readonly outbox: MongoOutboxWriter,
    private readonly rateLimiter: RateLimiter,
    @Inject(ENV) private readonly env: Pick<Env, 'EMAIL_TOKEN_SECRET'>,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  /**
   * Один и тот же ответ для любого адреса (R2). Лимиты — до обращения к БД, по очереди до первого отказа (IP →
   * e-mail): отказ по IP не списывает счётчик e-mail. Письмо — только существующему не удалённому аккаунту
   * (неподтверждённому тоже, Q4); неизвестному — нет (Q11). Новая ссылка отменяет прежние (Q6).
   */
  async requestReset(input: { email: string }, ip: string): Promise<RequestPasswordResetResponse> {
    const now = this.clock.now();
    const email = normalizeEmail(input.email);
    const keys = passwordResetLimitKeys(this.env.EMAIL_TOKEN_SECRET, email, ip);
    const limits = IDENTITY_POLICY.passwordResetLimits;
    for (const [key, rule] of [
      [keys.ip, limits.ip],
      [keys.email, limits.email],
    ] as const) {
      const result = await this.rateLimiter.consume(key, rule, now);
      if (!result.allowed) {
        const details: RateLimitedDetails = { retryAfterSec: result.retryAfterSec };
        throw domainError('RATE_LIMITED', 429, details);
      }
    }
    const response = { resendAvailableInSec: limits.email.cooldownSec };

    const account = await this.repository.findUserByEmail(email);
    if (!account || account.deletedAt) return response;

    await this.transactions.run(async (tx) => {
      const user = await this.repository.lockUser(tx, account.id);
      if (!user || user.deletedAt) return;
      await this.repository.supersedeActivePasswordResetTokens(tx, user.id, now);
      const id = uuidv7();
      await this.repository.insertPasswordResetToken(tx, {
        id,
        userId: user.id,
        tokenHash: sha256(derivePasswordResetToken(this.env.EMAIL_TOKEN_SECRET, id)),
        createdAt: now,
        expiresAt: new Date(now.getTime() + IDENTITY_POLICY.passwordResetLinkTtlMs),
      });
      const payload: PasswordResetEmailRequested = { passwordResetTokenId: id };
      await this.outbox.append(tx, { type: PASSWORD_RESET_EMAIL_REQUESTED, payload });
    });
    return response;
  }

  /** `GET` по ссылке: только чтение. `used` важнее `expired`; удалённый аккаунт — как неизвестная ссылка. */
  async describeLink(token: string): Promise<PasswordResetLinkInfo> {
    const found = await this.repository.findPasswordResetByHash(sha256(token));
    if (!found || found.user.deletedAt) throw notFound();
    const { email } = found.user;
    if (found.token.usedAt) return { state: 'used', email };
    if (isStale(found.token, this.clock.now())) return { state: 'expired', email };
    return { state: 'valid', email };
  }

  /**
   * Смена пароля. Ссылка проверяется до argon2 (мёртвая ссылка не нагружает CPU) и ещё раз под `lockUser` — её могли
   * использовать или заменить параллельно. Одна транзакция: новый хеш, ссылка `used`, отзыв всех сессий
   * (`password_reset`), токен регистрации погашен (R5), e-mail подтверждён (Q4), событие «Пароль изменён».
   */
  async confirm(input: ConfirmPasswordResetRequest): Promise<ConfirmPasswordResetResponse> {
    const tokenHash = sha256(input.token);
    const found = await this.repository.findPasswordResetByHash(tokenHash);
    if (!found || found.user.deletedAt) throw notFound();
    if (isStale(found.token, this.clock.now())) throw linkExpired(found.user.email);

    const passwordHash = await this.hasher.hash(input.password);

    const result = await this.transactions.run(async (tx) => {
      const user = await this.repository.lockUser(tx, found.user.id);
      if (!user || user.deletedAt) throw notFound();
      const current = await this.repository.findPasswordResetByHash(tokenHash, tx);
      // время — после argon2 и повторов транзакции: ссылка могла истечь, пока запрос ждал
      const at = this.clock.now();
      if (!current || isStale(current.token, at)) throw linkExpired(user.email);

      await this.repository.updatePasswordHash(tx, user.id, passwordHash);
      await this.repository.markPasswordResetUsed(tx, current.token.id, at);
      const revoked = await this.repository.revokeAllSessions(tx, user.id, at, 'password_reset');
      await this.repository.revokeRegistrationToken(tx, user.id, at);
      if (!user.emailVerifiedAt) await this.repository.markEmailVerified(tx, user.id, at);
      const payload: PasswordChangedEmailRequested = { passwordResetTokenId: current.token.id };
      await this.outbox.append(tx, { type: PASSWORD_CHANGED_EMAIL_REQUESTED, payload });
      return { userId: user.id, email: user.email, revoked };
    });

    // только id пользователя и число отозванных сессий: ни e-mail, ни токена, ни IP
    this.logger.log({ msg: 'password reset', uid: result.userId, revoked: result.revoked });
    return { state: 'passwordChanged', email: result.email };
  }
}
