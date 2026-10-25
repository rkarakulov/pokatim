import { Inject, Injectable, Logger } from '@nestjs/common';
import type { RateLimitedDetails, Session } from '@pokatim/contracts';
import { CLOCK, type Clock, ENV, RateLimiter } from '@rkarakulov/api-kit/core';
import { uuidv7 } from '@rkarakulov/api-kit/mongo';
import { SignJWT } from 'jose';

import type { Env } from '../../config/env';
import type { DbSession } from '../../db';
import { domainError } from '../../error-messages';
import { IDENTITY_POLICY, JWT_AUDIENCE, JWT_ISSUER } from './identity.policy';
import { IdentityRepository } from './identity.repository';
import type { SessionRevokedReason } from './identity.collection';
import { randomToken, rateLimitKeyForIp, sha256 } from './tokens';

/**
 * Жизненный цикл сессии: выдача, ротация refresh (окно повтора, reuse detection — ADR-0005), отзыв. Access — JWT
 * HS256 (sub + sid), refresh — случайный, в БД — только sha256. Транспорт refresh (тело или cookie) — забота
 * контроллера.
 */
@Injectable()
export class SessionService {
  private readonly key: Uint8Array;
  private readonly logger = new Logger(SessionService.name);

  constructor(
    private readonly repository: IdentityRepository,
    @Inject(ENV) private readonly env: Pick<Env, 'JWT_SECRET' | 'EMAIL_TOKEN_SECRET'>,
    @Inject(CLOCK) private readonly clock: Clock,
    private readonly rateLimiter: RateLimiter,
  ) {
    this.key = new TextEncoder().encode(env.JWT_SECRET);
  }

  async issue(tx: DbSession, userId: string): Promise<Session> {
    const now = this.clock.now();
    const sessionId = uuidv7();
    const expiresAt = new Date(now.getTime() + IDENTITY_POLICY.refreshTokenTtlMs);
    const refreshToken = randomToken();

    await this.repository.insertSession(tx, {
      id: sessionId,
      userId,
      refreshTokenHash: sha256(refreshToken),
      createdAt: now,
      expiresAt,
    });
    return this.compose({ id: sessionId, userId, expiresAt }, refreshToken, now);
  }

  /**
   * Новый refresh взамен предъявленного; срок сессии скользящий (30 дней от ротации, не дальше 180 от входа).
   * Предыдущий refresh в окне повтора (60 с) — тоже ротация той же сессии (ответ мог потеряться); позже — reuse
   * detection: сессия отзывается. Отозванная, истёкшая, чужая, удалённый пользователь, reuse и проигравший гонку
   * токен — один и тот же 401 (без оракула). Лимит — по IP.
   */
  async rotate(refreshToken: string, ip: string): Promise<Session> {
    const now = this.clock.now();
    const limit = await this.rateLimiter.consume(
      `refresh-ip:${rateLimitKeyForIp(this.env.EMAIL_TOKEN_SECRET, ip)}`,
      IDENTITY_POLICY.refreshPerIpLimit,
      now,
    );
    if (!limit.allowed) {
      const details: RateLimitedDetails = { retryAfterSec: limit.retryAfterSec };
      throw domainError('RATE_LIMITED', 429, details);
    }

    const tokenHash = sha256(refreshToken);
    const nextToken = randomToken();
    const rotated = await this.repository.rotateSession({
      tokenHash,
      nextTokenHash: sha256(nextToken),
      now,
      graceMs: IDENTITY_POLICY.refreshReuseGraceMs,
      ttlMs: IDENTITY_POLICY.refreshTokenTtlMs,
      absoluteTtlMs: IDENTITY_POLICY.sessionAbsoluteTtlMs,
    });
    if (rotated) return this.compose(rotated, nextToken, now);

    const revokedId = await this.repository.markReuseDetected(
      tokenHash,
      now,
      IDENTITY_POLICY.refreshReuseGraceMs,
    );
    // только id сессии: ни токена, ни e-mail, ни IP (R6)
    if (revokedId) {
      this.logger.warn({ msg: 'session revoked', sid: revokedId, reason: 'reuse_detected' });
    }
    throw domainError('UNAUTHORIZED', 401);
  }

  /**
   * Отзыв по текущему или предыдущему refresh: `signed_out` — выход, `superseded` — вход в этом браузере заменил
   * сессию. Неизвестный или уже отозванный токен — без ошибки (идемпотентно).
   */
  async revoke(refreshToken: string, reason: SessionRevokedReason = 'signed_out'): Promise<void> {
    await this.repository.revokeSession(sha256(refreshToken), this.clock.now(), reason);
  }

  private async compose(
    session: { id: string; userId: string; expiresAt: Date },
    refreshToken: string,
    now: Date,
  ): Promise<Session> {
    // access не переживает сессию: в конце срока — не дольше её остатка
    const accessExpiresAt = new Date(
      Math.min(now.getTime() + IDENTITY_POLICY.accessTokenTtlMs, session.expiresAt.getTime()),
    );
    const accessToken = await new SignJWT({ sid: session.id })
      .setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
      .setIssuer(JWT_ISSUER)
      .setAudience(JWT_AUDIENCE)
      .setSubject(session.userId)
      .setIssuedAt(now)
      .setExpirationTime(accessExpiresAt)
      .sign(this.key);

    return {
      accessToken,
      accessTokenExpiresAt: accessExpiresAt.toISOString(),
      refreshToken,
      refreshTokenExpiresAt: session.expiresAt.toISOString(),
    };
  }
}
