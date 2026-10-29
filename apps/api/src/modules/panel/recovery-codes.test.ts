import { describe, expect, it } from 'vitest';

import { RecoveryCode, RECOVERY_CODE_COUNT } from '@pokatim/contracts';

import { generateRecoveryCodes, normalizeRecoveryCode, recoveryCodeHash } from './recovery-codes';

const KEY = Buffer.alloc(32, 7);

describe('коды восстановления', () => {
  it('10 кодов формата xxxxx-xxxxx из base32 без 0 1 8 9, без повторов; проходят схему контракта', () => {
    const codes = generateRecoveryCodes();
    expect(codes).toHaveLength(RECOVERY_CODE_COUNT);
    expect(new Set(codes).size).toBe(codes.length);
    for (const code of codes) {
      expect(code).toMatch(/^[a-z2-7]{5}-[a-z2-7]{5}$/);
      expect(RecoveryCode.safeParse(code).success).toBe(true);
    }
  });

  it('нормализация: нижний регистр, без дефиса', () => {
    expect(normalizeRecoveryCode('ABCDE-FGH27')).toBe('abcdefgh27');
    expect(normalizeRecoveryCode('abcdefgh27')).toBe('abcdefgh27');
  });

  it('HMAC — от нормализованного кода, зависит от ключа, сам код в хеше не виден', () => {
    const hash = recoveryCodeHash(KEY, 'abcde-fgh27');
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
    expect(recoveryCodeHash(KEY, 'ABCDEFGH27')).toBe(hash);
    expect(recoveryCodeHash(Buffer.alloc(32, 8), 'abcde-fgh27')).not.toBe(hash);
    expect(recoveryCodeHash(KEY, 'abcde-fgh22')).not.toBe(hash);
    expect(hash).not.toContain('abcde');
  });
});
