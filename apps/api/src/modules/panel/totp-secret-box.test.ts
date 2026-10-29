import { describe, expect, it } from 'vitest';

import { openTotpSecret, sealTotpSecret, TotpSecretBox } from './totp-secret-box';

const KEY = Buffer.alloc(32, 1);
const USER = '01890a5d-ac96-774b-bcce-b302099a8057';
const OTHER = '01890a5d-ac96-774b-bcce-b302099a8058';
const SECRET = Buffer.from('12345678901234567890');

describe('секрет TOTP: AES-256-GCM, AAD = userId', () => {
  it('seal/open — тот же секрет; формат v1:iv:tag:ct, секрета в открытом виде нет', () => {
    const sealed = sealTotpSecret(KEY, USER, SECRET);
    expect(sealed).toMatch(/^v1:[A-Za-z0-9_-]{16}:[A-Za-z0-9_-]{22}:[A-Za-z0-9_-]+$/);
    expect(sealed).not.toContain(SECRET.toString('base64url'));
    expect(openTotpSecret(KEY, USER, sealed).equals(SECRET)).toBe(true);
    // случайный IV: два запечатывания различаются
    expect(sealTotpSecret(KEY, USER, SECRET)).not.toBe(sealed);
  });

  it('чужой userId (AAD), другой ключ, порча тега или шифртекста, чужая версия — отказ', () => {
    const sealed = sealTotpSecret(KEY, USER, SECRET);
    const [version, iv, tag, ct] = sealed.split(':') as [string, string, string, string];
    const flip = (part: string) => {
      const bytes = Buffer.from(part, 'base64url');
      bytes[0] = (bytes[0] ?? 0) ^ 1;
      return bytes.toString('base64url');
    };
    expect(() => openTotpSecret(KEY, OTHER, sealed)).toThrow();
    expect(() => openTotpSecret(Buffer.alloc(32, 2), USER, sealed)).toThrow();
    expect(() => openTotpSecret(KEY, USER, [version, iv, flip(tag), ct].join(':'))).toThrow();
    expect(() => openTotpSecret(KEY, USER, [version, iv, tag, flip(ct)].join(':'))).toThrow();
    expect(() => openTotpSecret(KEY, USER, ['v2', iv, tag, ct].join(':'))).toThrow();
    expect(() => openTotpSecret(KEY, USER, 'мусор')).toThrow();
  });

  it('без ключа в env — 503 TOTP_UNAVAILABLE (fail closed)', () => {
    const box = new TotpSecretBox({ PANEL_TOTP_KEY: undefined });
    expect(box.available).toBe(false);
    expect(() => box.seal(USER, SECRET)).toThrow(
      expect.objectContaining({ code: 'TOTP_UNAVAILABLE', status: 503 }),
    );
    const withKey = new TotpSecretBox({ PANEL_TOTP_KEY: KEY.toString('hex') });
    expect(withKey.open(USER, withKey.seal(USER, SECRET)).equals(SECRET)).toBe(true);
  });
});
