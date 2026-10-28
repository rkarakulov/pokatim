import { describe, expect, it } from 'vitest';

import type { RiderProtocolRow } from '../results';
import { pageRows, summarize } from './riders.policy';

const id = (n: number) => `0192f3a0-0000-7000-8000-${String(n).padStart(12, '0')}`;
const row = (
  n: number,
  place: number | null,
  { status = 'final', day = n }: { status?: RiderProtocolRow['status']; day?: number } = {},
): RiderProtocolRow => ({
  raceId: id(n),
  place,
  tied: false,
  status,
  groupKey: 'overall',
  elapsedSec: 3600,
  startedAt: new Date(Date.UTC(2026, 5, day)),
});

describe('summarize', () => {
  it('гонки — строки с местом без DQ; подиумы — места 1–3; лучшие — по месту, при равенстве новее', () => {
    const rows = [
      row(1, 5),
      row(2, 2),
      row(3, null, { status: 'dq' }),
      row(4, 2, { status: 'revised' }),
      row(5, 1),
      row(6, 3),
      row(7, 9),
    ];
    const summary = summarize(rows);
    expect(summary.races).toBe(6);
    expect(summary.podiums).toBe(4);
    expect(summary.bestPlaces.map((r) => r.raceId)).toEqual([id(5), id(4), id(2)]);
  });

  it('пусто — нули', () => {
    expect(summarize([])).toEqual({ races: 0, podiums: 0, bestPlaces: [] });
  });
});

describe('pageRows', () => {
  const rows = [row(1, 1), row(2, 2), row(3, 3), row(4, null, { status: 'dq', day: 3 })];

  it('новые сверху (startedAt ↓, raceId ↓); курсор — только id гонки последней строки (без времени заезда)', () => {
    const first = pageRows(rows, null, 2);
    expect(first?.page.map((r) => r.raceId)).toEqual([id(4), id(3)]);
    expect(first?.next).toEqual({ id: id(3) });
    const second = pageRows(rows, { id: id(3) }, 2);
    expect(second?.page.map((r) => r.raceId)).toEqual([id(2), id(1)]);
    expect(second?.next).toBeNull();
  });

  it('курсор после последней — пусто; гонки курсора нет в списке — null (400 у вызывающего)', () => {
    expect(pageRows(rows, { id: id(1) }, 5)).toEqual({ page: [], next: null });
    expect(pageRows(rows, { id: id(99) }, 5)).toBeNull();
  });
});
