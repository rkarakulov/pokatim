import { describe, expect, it } from 'vitest';

import {
  AccountErasureQuery,
  AccountErasureRow,
  RetryAccountErasureRequest,
} from './account-erasures.schema.ts';

const ID = '01890a5d-ac96-774b-bcce-b302099a8057';

describe('AccountErasureQuery', () => {
  it('limit по умолчанию 20, не больше 50; лишние параметры — ошибка', () => {
    expect(AccountErasureQuery.parse({}).limit).toBe(20);
    expect(AccountErasureQuery.safeParse({ limit: '51' }).success).toBe(false);
    expect(AccountErasureQuery.safeParse({ 'deletedAt[$gt]': '1' }).success).toBe(false);
  });
});

describe('AccountErasureRow', () => {
  it('шаг — только из справочника; сбоя может не быть', () => {
    const row = {
      userId: ID,
      deletedAt: '2026-10-27T10:00:00.000Z',
      failedAttempts: 0,
      lastFailure: null,
      retryRequestedAt: null,
    };
    expect(AccountErasureRow.parse(row)).toEqual(row);
    expect(
      AccountErasureRow.safeParse({
        ...row,
        lastFailure: { step: 'email', code: 'x', at: row.deletedAt },
      }).success,
    ).toBe(false);
  });
});

describe('RetryAccountErasureRequest', () => {
  it('причина обязательна; лишние поля — ошибка', () => {
    expect(RetryAccountErasureRequest.safeParse({}).success).toBe(false);
    expect(
      RetryAccountErasureRequest.safeParse({ reason: 'Починили SMTP', userId: ID }).success,
    ).toBe(false);
    expect(RetryAccountErasureRequest.parse({ reason: '  Починили SMTP ' }).reason).toBe(
      'Починили SMTP',
    );
  });
});
