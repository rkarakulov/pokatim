import { describe, expect, it } from 'vitest';

import {
  INVITE_CODE_ALPHABET,
  INVITE_CODE_LENGTH,
  InviteCode,
  InviteCodeResponse,
} from './invite.schema.ts';

describe('InviteCode (K9)', () => {
  it('алфавит — 31 символ без похожих 0 O 1 I L, длина 7', () => {
    expect(INVITE_CODE_ALPHABET).toHaveLength(31);
    expect(INVITE_CODE_ALPHABET).not.toMatch(/[01OIL]/);
    expect(INVITE_CODE_LENGTH).toBe(7);
  });

  it('принимает код в любом регистре и с пробелами — отдаёт верхний регистр', () => {
    expect(InviteCode.parse(' k7m2pqx ')).toBe('K7M2PQX');
    expect(InviteCode.parse('K7M2PQX')).toBe('K7M2PQX');
  });

  it('отклоняет похожие символы, неверную длину и не-строку', () => {
    for (const bad of [
      'K7M2PQ0',
      'K7M2PQO',
      'K7M2PQ1',
      'K7M2PQI',
      'K7M2PQL',
      'K7M2PQ',
      'K7M2PQXX',
      '',
      7,
    ]) {
      expect(InviteCode.safeParse(bad).success).toBe(false);
    }
  });

  it('InviteCodeResponse — { code }', () => {
    expect(InviteCodeResponse.parse({ code: 'K7M2PQX' })).toEqual({ code: 'K7M2PQX' });
    expect(InviteCodeResponse.safeParse({ code: 'bad' }).success).toBe(false);
  });
});
