import { describe, expect, it } from 'vitest';

import {
  CHANGED_SORT,
  changedAfter,
  changedSort,
  changedWithin,
  uuidv7Floor,
} from './changed-since';

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

  it('поле времени задаётся (achievements-push: checkedAt, startsAt)', () => {
    const at = new Date('2026-10-29T10:00:00Z');
    expect(changedAfter({ at, id: 'b' }, 'checkedAt')).toEqual({
      $or: [{ checkedAt: { $gt: at } }, { checkedAt: at, _id: { $gt: 'b' } }],
    });
    expect(changedSort('startsAt')).toEqual({ startsAt: 1, _id: 1 });
  });
});

describe('changedWithin (achievements-push: окно (курсор, until])', () => {
  const at = new Date('2026-10-29T10:00:00Z');
  const until = new Date('2026-10-29T11:00:00Z');

  it('диапазон по полю времени ограничен с двух сторон, равное курсору время — только с большим _id', () => {
    expect(changedWithin({ at, id: 'b' }, until, 'checkedAt')).toEqual({
      checkedAt: { $gte: at, $lte: until },
      $or: [{ checkedAt: { $gt: at } }, { _id: { $gt: 'b' } }],
    });
  });

  it('пустой id курсора — время курсора включительно', () => {
    expect(changedWithin({ at, id: '' }, until, 'startsAt')).toEqual({
      startsAt: { $gte: at, $lte: until },
    });
  });
});

describe('uuidv7Floor', () => {
  it('наименьший uuidv7 момента: первые 48 бит — Unix-время в мс, остальное — нули', () => {
    const at = new Date('2026-10-29T10:00:00.123Z');
    const floor = uuidv7Floor(at);
    expect(floor).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-7000-8000-000000000000$/);
    expect(Number.parseInt(floor.slice(0, 8) + floor.slice(9, 13), 16)).toBe(at.getTime());
  });

  it('порядок строк = порядок времени; любой uuidv7 того же мс не меньше нижней границы', () => {
    const at = new Date('2026-10-29T10:00:00.123Z');
    const next = new Date(at.getTime() + 1);
    expect(uuidv7Floor(at) < uuidv7Floor(next)).toBe(true);
    const sameMs = `${uuidv7Floor(at).slice(0, 14)}abc-9def-0123456789ab`;
    expect(sameMs >= uuidv7Floor(at) && sameMs < uuidv7Floor(next)).toBe(true);
  });
});
