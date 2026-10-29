import { describe, expect, it } from 'vitest';

import {
  base32Decode,
  base32Encode,
  generateTotp,
  generateTotpSecret,
  otpauthUri,
  totpStep,
  verifyTotp,
} from './totp';

/** RFC 6238, приложение B: секрет SHA-1 — ASCII «12345678901234567890»; 6 цифр — хвост 8-значного эталона. */
const RFC_SECRET = Buffer.from('12345678901234567890', 'ascii');
const RFC_VECTORS: [number, string][] = [
  [59, '94287082'],
  [1111111109, '07081804'],
  [1111111111, '14050471'],
  [1234567890, '89005924'],
  [2000000000, '69279037'],
  [20000000000, '65353130'],
];
const at = (sec: number) => new Date(sec * 1000);

describe('base32 (RFC 4648, без паддинга)', () => {
  it('векторы RFC 4648 §10', () => {
    const vectors: [string, string][] = [
      ['', ''],
      ['f', 'MY'],
      ['fo', 'MZXQ'],
      ['foo', 'MZXW6'],
      ['foob', 'MZXW6YQ'],
      ['fooba', 'MZXW6YTB'],
      ['foobar', 'MZXW6YTBOI'],
    ];
    for (const [plain, encoded] of vectors) {
      expect(base32Encode(Buffer.from(plain))).toBe(encoded);
      expect(base32Decode(encoded).toString()).toBe(plain);
    }
  });

  it('разбор — без учёта регистра, пробелов и паддинга; чужие символы — ошибка', () => {
    expect(base32Decode('mzxw 6ytb oi==').toString()).toBe('foobar');
    expect(() => base32Decode('MZXW1')).toThrow();
  });
});

describe('TOTP (RFC 6238, SHA-1, 30 с)', () => {
  it('векторы RFC 6238: 8 цифр и 6 цифр', () => {
    for (const [sec, code] of RFC_VECTORS) {
      expect(generateTotp(RFC_SECRET, totpStep(at(sec)), 8)).toBe(code);
      expect(generateTotp(RFC_SECRET, totpStep(at(sec)))).toBe(code.slice(-6));
    }
  });

  it('окно ±1 шаг: соседние шаги принимаются, ±2 — нет; результат — принятый шаг', () => {
    const now = at(1111111111);
    const step = totpStep(now);
    expect(verifyTotp(RFC_SECRET, generateTotp(RFC_SECRET, step), now, null)).toBe(step);
    expect(verifyTotp(RFC_SECRET, generateTotp(RFC_SECRET, step - 1), now, null)).toBe(step - 1);
    expect(verifyTotp(RFC_SECRET, generateTotp(RFC_SECRET, step + 1), now, null)).toBe(step + 1);
    expect(verifyTotp(RFC_SECRET, generateTotp(RFC_SECRET, step - 2), now, null)).toBeNull();
    expect(verifyTotp(RFC_SECRET, generateTotp(RFC_SECRET, step + 2), now, null)).toBeNull();
  });

  it('повтор: шаг не больше записанного — отказ', () => {
    const now = at(1111111111);
    const step = totpStep(now);
    const code = generateTotp(RFC_SECRET, step);
    expect(verifyTotp(RFC_SECRET, code, now, step)).toBeNull();
    expect(verifyTotp(RFC_SECRET, code, now, step + 1)).toBeNull();
    expect(verifyTotp(RFC_SECRET, code, now, step - 1)).toBe(step);
    // код прошлого шага после принятого текущего — тоже повтор
    expect(verifyTotp(RFC_SECRET, generateTotp(RFC_SECRET, step - 1), now, step)).toBeNull();
  });

  it('неверная длина и не цифры — отказ без исключения', () => {
    const now = at(59);
    for (const bad of ['', '28708', '2870820', '94287082', 'abcdef']) {
      expect(verifyTotp(RFC_SECRET, bad, now, null)).toBeNull();
    }
  });

  it('секрет — 20 случайных байт', () => {
    const a = generateTotpSecret();
    expect(a).toHaveLength(20);
    expect(generateTotpSecret().equals(a)).toBe(false);
  });

  it('otpauth: метка и издатель «Покатим Протокол», SHA1, 6 цифр, 30 с', () => {
    expect(otpauthUri('JBSWY3DPEHPK3PXP', 'olga@example.by')).toBe(
      'otpauth://totp/%D0%9F%D0%BE%D0%BA%D0%B0%D1%82%D0%B8%D0%BC%20%D0%9F%D1%80%D0%BE%D1%82%D0%BE%D0%BA%D0%BE%D0%BB:olga%40example.by' +
        '?secret=JBSWY3DPEHPK3PXP&issuer=%D0%9F%D0%BE%D0%BA%D0%B0%D1%82%D0%B8%D0%BC%20%D0%9F%D1%80%D0%BE%D1%82%D0%BE%D0%BA%D0%BE%D0%BB' +
        '&algorithm=SHA1&digits=6&period=30',
    );
  });
});
