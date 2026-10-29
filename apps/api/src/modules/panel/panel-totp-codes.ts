import { createHmac } from 'node:crypto';

import { Inject, Injectable } from '@nestjs/common';
import type { PanelRole, TotpSetup } from '@pokatim/contracts';
import { ENV, RateLimiter } from '@rkarakulov/api-kit/core';
import { uuidv7 } from '@rkarakulov/api-kit/mongo';

import type { Env } from '../../config/env';
import { domainError } from '../../error-messages';
import { consumeUserLimit } from '../../user-limit';
import { IdentityAccounts, rateLimitKeyForIp } from '../identity';
import type { PanelTotpDoc } from './panel.collection';
import { DELETED_MEMBER, PANEL_POLICY } from './panel.policy';
import { generateRecoveryCodes } from './recovery-codes';
import { base32Encode, generateTotpSecret, otpauthUri, verifyTotp } from './totp';
import { TotpSecretBox } from './totp-secret-box';

/** Один ответ на неверный, повторённый и погашенный код (TOTP и восстановления) — D11, Security checklist п. 7. */
export const invalidTotpCode = () => domainError('TOTP_INVALID_CODE', 400);

/**
 * Общие шаги 2FA панели (ADR-0024) для входа и настроек: лимиты попыток ввода кода (D8), проверка кода по
 * расшифрованному секрету, новый секрет и коды восстановления, обязательность для роли (D1).
 */
@Injectable()
export class PanelTotpCodes {
  constructor(
    private readonly box: TotpSecretBox,
    private readonly rateLimiter: RateLimiter,
    private readonly accounts: IdentityAccounts,
    @Inject(ENV)
    private readonly env: Pick<Env, 'EMAIL_TOKEN_SECRET' | 'PANEL_TOTP_ENFORCED'>,
  ) {}

  /** Без ключа — `503 TOTP_UNAVAILABLE` (fail closed). */
  ensureAvailable(): void {
    if (!this.box.available) throw domainError('TOTP_UNAVAILABLE', 503);
  }

  /** 2FA обязательна: admin при `PANEL_TOTP_ENFORCED=true`. */
  required(role: PanelRole): boolean {
    return role === 'admin' && this.env.PANEL_TOTP_ENFORCED;
  }

  /**
   * Попытка ввода кода — до проверки: `panel-totp-ip` → `panel-totp-user` по очереди до первого отказа (429
   * `RATE_LIMITED`). Ключи — HMAC (в Redis нет ни IP, ни userId).
   */
  async takeAttempt(userId: string, ip: string, now: Date): Promise<void> {
    const secret = this.env.EMAIL_TOKEN_SECRET;
    const userKey = createHmac('sha256', secret)
      .update(`panel-totp-user:${userId}`)
      .digest('base64url');
    const limits = PANEL_POLICY.totpLimits;
    await consumeUserLimit(
      this.rateLimiter,
      `panel-totp-ip:${rateLimitKeyForIp(secret, ip)}`,
      limits.ip,
      now,
    );
    await consumeUserLimit(this.rateLimiter, `panel-totp-user:${userKey}`, limits.user, now);
  }

  /** Шаг принятого кода или `null` (неверный, вне окна, не больше `lastUsedStep`). */
  matchTotp(doc: PanelTotpDoc, code: string, now: Date): number | null {
    const secret = this.box.open(doc._id, doc.secretEnc);
    return verifyTotp(secret, code, now, doc.lastUsedStep);
  }

  recoveryHash(code: string): string {
    return this.box.recoveryHash(code);
  }

  /** Новый секрет: шифротекст в БД, base32 и `otpauth://` — один раз в ответ (метка — e-mail сотрудника). */
  async newSecret(userId: string): Promise<{ secretEnc: string; epoch: string; setup: TotpSetup }> {
    this.ensureAvailable();
    const secret = generateTotpSecret();
    const email = (await this.accounts.emailsOf([userId])).get(userId) ?? DELETED_MEMBER;
    const base32 = base32Encode(secret);
    return {
      secretEnc: this.box.seal(userId, secret),
      epoch: uuidv7(),
      setup: { secret: base32, otpauthUri: otpauthUri(base32, email) },
    };
  }

  /** Новый набор кодов восстановления: коды — в ответ, в БД — только HMAC. */
  newRecoveryCodes(): { codes: string[]; hashes: string[] } {
    const codes = generateRecoveryCodes();
    return { codes, hashes: codes.map((code) => this.box.recoveryHash(code)) };
  }
}
