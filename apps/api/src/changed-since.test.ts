import { describe, expect, it } from 'vitest';

import { CHANGED_SORT, changedAfter } from './changed-since';

describe('changedAfter (og-images: keyset по (updatedAt, _id))', () => {
  it('нет курсора — без условия', () => {
    expect(changedAfter(null)).toEqual({});
  });

  it('строго после: позже по времени или то же время и больший _id', () => {
    const at = new Date('2026-10-29T10:00:00Z');
    expect(changedAfter({ at, id: 'b' })).toEqual({
      $or: [{ updatedAt: { $gt: at } }, { updatedAt: at, _id: { $gt: 'b' } }],
    });
  });

  it('сортировка — (updatedAt, _id) по возрастанию', () => {
    expect(CHANGED_SORT).toEqual({ updatedAt: 1, _id: 1 });
  });
});
