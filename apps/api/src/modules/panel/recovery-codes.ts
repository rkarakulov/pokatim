import { createHmac, randomInt } from 'node:crypto';

import { RECOVERY_CODE_COUNT } from '@pokatim/contracts';

/**
 * Коды восстановления 2FA (ADR-0024, D3): 10 кодов `xxxxx-xxxxx` из base32 без `0 1 8 9` (10 символов × 5 бит = 50
 * бит), показываются один раз; в БД — только `HMAC-SHA256` нормализованного кода подключом HMAC из
 * `PANEL_TOTP_KEY` (HKDF, `panelTotpKeys`).
 */
const ALPHABET = 'abcdefghijklmnopqrstuvwxyz234567';
const HALF = 5;

function generateCode(): string {
  const chars = Array.from({ length: HALF * 2 }, () => ALPHABET[randomInt(ALPHABET.length)]);
  return `${chars.slice(0, HALF).join('')}-${chars.slice(HALF).join('')}`;
}

/** Набор кодов без повторов (совпадение при 50 битах практически невозможно — повтор генерации на всякий случай). */
export function generateRecoveryCodes(): string[] {
  const codes = new Set<string>();
  while (codes.size < RECOVERY_CODE_COUNT) codes.add(generateCode());
  return [...codes];
}

/** Нормализация ввода: нижний регистр, без дефиса (схема контракта уже проверила алфавит и длину). */
export function normalizeRecoveryCode(code: string): string {
  return code.toLowerCase().replace('-', '');
}

/** HMAC-SHA256 нормализованного кода (hex): ключ — только env, утечка БД кодов не даёт. */
export function recoveryCodeHash(key: Buffer, code: string): string {
  return createHmac('sha256', key)
    .update(`panel-recovery:${normalizeRecoveryCode(code)}`)
    .digest('hex');
}
