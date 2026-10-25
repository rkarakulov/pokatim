import { Inject, Injectable } from '@nestjs/common';
import {
  normalizeEmail,
  type RateLimitedDetails,
  type RegisterRequest,
  type RegisterResponse,
  type Session,
} from '@pokatim/contracts';
import { CLOCK, type Clock, ENV, RateLimiter } from '@rkarakulov/api-kit/core';
import { isDuplicateKey } from '@rkarakulov/api-kit/mongo';

import type { Env } from '../../config/env';
import { type DbSession, MongoTransactions } from '../../db';
import { domainError } from '../../error-messages';
import { IDENTITY_POLICY } from './identity.policy';
import { IdentityRepository } from './identity.repository';
import { PasswordHasher } from './password-hasher';
import { SessionService } from './session.service';
import { randomToken, rateLimitKeyForIp, sha256 } from './tokens';
import { VerificationService } from './verification.service';

const emailTaken = () => domainError('EMAIL_TAKEN', 409);

/** Регистрация по e-mail и обмен токена регистрации на сессию после подтверждения (V-09, ADR-0002). */
@Injectable()
export class RegistrationService {
  constructor(
    private readonly repository: IdentityRepository,
    private readonly transactions: MongoTransactions,
    private readonly verification: VerificationService,
    private readonly sessions: SessionService,
    private readonly hasher: PasswordHasher,
    private readonly rateLimiter: RateLimiter,
    @Inject(ENV) private readonly env: Env,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  async register(input: RegisterRequest, ip: string): Promise<RegisterResponse> {
    const now = this.clock.now();
    const email = normalizeEmail(input.email);
    // ключ — HMAC от IP (псевдонимизация, TTL окна 1 ч): сам адрес в Redis не храним
    const ipLimit = await this.rateLimiter.consume(
      `register-ip:${rateLimitKeyForIp(this.env.EMAIL_TOKEN_SECRET, ip)}`,
      IDENTITY_POLICY.registerPerIpLimit,
      now,
    );
    if (!ipLimit.allowed) {
      const details: RateLimitedDetails = { retryAfterSec: ipLimit.retryAfterSec };
      throw domainError('RATE_LIMITED', 429, details);
    }

    const passwordHash = await this.hasher.hash(input.password);
    const registrationToken = randomToken();
    try {
      // гонка одного адреса: в транзакции вторая регистрация получает конфликт записи (повтор колбэка видит адрес)
      // или дубликат ключа `users_email_unique` после коммита первой — оба пути дают EMAIL_TAKEN
      return await this.transactions.run(async (tx) => {
        const existing = await this.repository.findUserByEmail(email, tx);
        if (existing) {
          // D-07: адрес удалённого аккаунта — нейтральный отказ без причины
          throw existing.deletedAt ? domainError('EMAIL_UNAVAILABLE', 409) : emailTaken();
        }
        const userId = await this.repository.insertUser(tx, {
          email,
          passwordHash,
          birthDate: input.birthDate,
          createdAt: now,
        });
        const version = this.env.AGREEMENT_VERSION;
        await this.repository.insertConsents(
          tx,
          userId,
          [
            { kind: 'personal_data', version },
            { kind: 'agreement', version },
          ],
          now,
        );
        const expiresAt = await this.verification.issueLink(tx, userId, now);
        await this.repository.insertRegistrationToken(tx, {
          userId,
          tokenHash: sha256(registrationToken),
          createdAt: now,
          expiresAt,
        });
        // письмо при регистрации — первое из лимита повторов; Redis недоступен — откат и 500.
        // Исключение из правила «в колбэке транзакции — только операции с session» (R12): при повторе колбэка
        // insertUser выдаёт новый id, и лимит списывается с ключа нового id — 429 не возникает, ключ прежнего id
        // остаётся «сиротой» до конца окна. Безвредно.
        await this.verification.takeResendAllowance(userId, now);
        return {
          registrationToken,
          email,
          resendAvailableInSec: IDENTITY_POLICY.resendLimit.cooldownSec,
        };
      });
    } catch (error) {
      // параллельная регистрация того же адреса
      if (isDuplicateKey(error, 'users_email_unique')) throw emailTaken();
      throw error;
    }
  }

  /**
   * Новый токен регистрации неподтверждённому аккаунту (вход с верным паролем, Q4 слайса 2) — в транзакции
   * вызывающего под `lockUser`. Прежний токен перестаёт действовать; срок — как у ссылки (скользящий при повторе
   * письма). Письмо не отправляется: повтор — кнопкой на «Подтвердите e-mail» (пауза — лимит повторов).
   */
  async reissueToken(tx: DbSession, userId: string, email: string, now: Date) {
    const registrationToken = randomToken();
    await this.repository.replaceRegistrationToken(tx, {
      userId,
      tokenHash: sha256(registrationToken),
      createdAt: now,
      expiresAt: new Date(now.getTime() + IDENTITY_POLICY.verificationLinkTtlMs),
    });
    return { registrationToken, email, resendAvailableInSec: 0 };
  }

  /** `pending` до подтверждения; после — сессия ровно один раз, дальше токен не действует (401). */
  async poll(
    registrationToken: string,
  ): Promise<{ state: 'pending' } | { state: 'verified'; session: Session }> {
    const tokenHash = sha256(registrationToken);
    const now = this.clock.now();
    const found = await this.repository.findRegistrationByHash(tokenHash);
    if (!found || found.user.deletedAt || found.token.consumedAt || found.token.expiresAt <= now) {
      throw domainError('UNAUTHORIZED', 401);
    }
    if (!found.user.emailVerifiedAt) return { state: 'pending' };

    return this.transactions.run(async (tx) => {
      // подтверждённость e-mail — из документа под lockUser той же транзакции (а не из чтения выше)
      const user = await this.repository.lockUser(tx, found.user.id);
      if (!user || user.deletedAt || !user.emailVerifiedAt) throw domainError('UNAUTHORIZED', 401);
      const userId = await this.repository.consumeRegistrationToken(tx, tokenHash, now);
      if (!userId) throw domainError('UNAUTHORIZED', 401);
      const session = await this.sessions.issue(tx, userId);
      return { state: 'verified' as const, session };
    });
  }
}
