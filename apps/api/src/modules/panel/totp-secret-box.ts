import { createCipheriv, createDecipheriv, hkdfSync, randomBytes } from 'node:crypto';

import { Inject, Injectable } from '@nestjs/common';
import { ENV } from '@rkarakulov/api-kit/core';

import type { Env } from '../../config/env';
import { domainError } from '../../error-messages';
import { recoveryCodeHash } from './recovery-codes';

const VERSION = 'v1';
const IV_BYTES = 12;
const aad = (userId: string) => Buffer.from(`panel-totp:${userId}`);

/**
 * Шифрование секрета TOTP (ADR-0024, D6): AES-256-GCM, формат `v1:<iv>:<tag>:<ct>` (base64url), AAD —
 * `panel-totp:<userId>`: шифротекст нельзя переставить другому сотруднику.
 */
export function sealTotpSecret(key: Buffer, userId: string, secret: Buffer): string {
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  cipher.setAAD(aad(userId));
  const ct = Buffer.concat([cipher.update(secret), cipher.final()]);
  return [VERSION, iv, cipher.getAuthTag(), ct]
    .map((part) => (typeof part === 'string' ? part : part.toString('base64url')))
    .join(':');
}

/** Расшифровка: чужая версия, формат, ключ, userId или порча — исключение. */
export function openTotpSecret(key: Buffer, userId: string, sealed: string): Buffer {
  const [version, iv, tag, ct, ...rest] = sealed.split(':');
  if (version !== VERSION || !iv || !tag || ct === undefined || rest.length > 0) {
    throw new Error('totp secret: неизвестный формат');
  }
  const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(iv, 'base64url'));
  decipher.setAAD(aad(userId));
  decipher.setAuthTag(Buffer.from(tag, 'base64url'));
  return Buffer.concat([decipher.update(Buffer.from(ct, 'base64url')), decipher.final()]);
}

/** Подключи (HKDF-SHA256, 32 байта) из `PANEL_TOTP_KEY`: AES-GCM секретов и HMAC кодов восстановления — разные. */
export interface PanelTotpKeys {
  enc: Buffer;
  hmac: Buffer;
}

export function panelTotpKeys(master: Buffer): PanelTotpKeys {
  const derive = (info: string) => Buffer.from(hkdfSync('sha256', master, '', info, 32));
  return { enc: derive('panel-totp-enc'), hmac: derive('panel-recovery-hmac') };
}

/**
 * Ключ `PANEL_TOTP_KEY` (только env) → подключи шифрования секретов и HMAC кодов восстановления. Без ключа — fail
 * closed: любая операция — `503 TOTP_UNAVAILABLE`.
 */
@Injectable()
export class TotpSecretBox {
  private readonly keys: PanelTotpKeys | undefined;

  constructor(@Inject(ENV) env: Pick<Env, 'PANEL_TOTP_KEY'>) {
    this.keys = env.PANEL_TOTP_KEY
      ? panelTotpKeys(Buffer.from(env.PANEL_TOTP_KEY, 'hex'))
      : undefined;
  }

  get available(): boolean {
    return this.keys !== undefined;
  }

  seal(userId: string, secret: Buffer): string {
    return sealTotpSecret(this.requireKeys().enc, userId, secret);
  }

  open(userId: string, sealed: string): Buffer {
    return openTotpSecret(this.requireKeys().enc, userId, sealed);
  }

  recoveryHash(code: string): string {
    return recoveryCodeHash(this.requireKeys().hmac, code);
  }

  private requireKeys(): PanelTotpKeys {
    if (!this.keys) throw domainError('TOTP_UNAVAILABLE', 503);
    return this.keys;
  }
}
