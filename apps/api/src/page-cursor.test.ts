import { LocalDate, UtcMinute } from '@pokatim/contracts';
import { describe, expect, it } from 'vitest';

import { decodeCursor, encodeCursor } from './page-cursor';

const ID = '01890a5d-ac96-774b-bcce-b302099a8057';
const b64 = (value: unknown) => Buffer.from(JSON.stringify(value)).toString('base64url');

describe('курсор страницы', () => {
  it('туда и обратно: момент и дата', () => {
    expect(decodeCursor(encodeCursor('2026-10-04T21:00:00.000Z', ID), UtcMinute)).toEqual({
      k: '2026-10-04T21:00:00.000Z',
      id: ID,
    });
    expect(decodeCursor(encodeCursor('2027-06-14', ID), LocalDate)).toEqual({
      k: '2027-06-14',
      id: ID,
    });
  });

  it('мусор, оператор вместо значения, лишний ключ, не тот ключ — 400 на поле cursor', () => {
    for (const raw of [
      'abc',
      '!!!',
      b64({ k: { $gt: '' }, id: ID }),
      b64({ k: '2026-10-04T21:00:00.000Z', id: 'x' }),
      b64({ k: '2026-10-04T21:00:00.000Z', id: ID, extra: 1 }),
      b64({ k: '2027-06-14', id: ID }),
      b64([1, 2]),
    ]) {
      expect(() => decodeCursor(raw, UtcMinute), raw).toThrow(
        expect.objectContaining({
          code: 'VALIDATION_FAILED',
          status: 400,
          details: { fields: [{ path: 'cursor', code: 'INVALID' }] },
        }),
      );
    }
  });
});
