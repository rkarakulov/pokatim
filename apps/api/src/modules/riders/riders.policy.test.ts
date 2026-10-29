import { describe, expect, it } from 'vitest';

import type { RiderFinishRow, RiderProtocolRow } from '../results';
import { historyRows, pageRows, summarize } from './riders.policy';

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

const finish = (
  n: number,
  unranked: RiderFinishRow['unranked'] = 'start',
  day = n,
): RiderFinishRow => ({
  raceId: id(n),
  groupKey: 'overall',
  elapsedSec: 4000,
  startedAt: new Date(Date.UTC(2026, 5, day)),
  unranked,
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
    expect(summary.finishes).toBe(6);
  });

  it('финиши — «в зачёте» + финиши без места по гонкам (DQ — нет, гонка не дважды); «в зачёте» не меняется', () => {
    const summary = summarize(
      [row(1, 4), row(2, null, { status: 'dq' })],
      [finish(3), finish(4, 'no_heart_rate'), finish(1)],
    );
    expect(summary).toMatchObject({ races: 1, podiums: 0, finishes: 3 });
    expect(summary.bestPlaces.map((r) => r.raceId)).toEqual([id(1)]);
  });

  it('одни финиши START — «в зачёте» 0, финиши считаются', () => {
    expect(summarize([], [finish(1), finish(2)])).toEqual({
      races: 0,
      podiums: 0,
      finishes: 2,
      bestPlaces: [],
    });
  });

  it('пусто — нули', () => {
    expect(summarize([])).toEqual({ races: 0, podiums: 0, finishes: 0, bestPlaces: [] });
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

describe('historyRows', () => {
  it('строки протокола — unranked null; финиш — без места, final; гонка протокола финишем не дублируется', () => {
    const rows = historyRows([row(1, 2)], [finish(2), finish(1)]);
    expect(rows).toEqual([
      { ...row(1, 2), unranked: null },
      {
        raceId: id(2),
        place: null,
        tied: false,
        status: 'final',
        groupKey: 'overall',
        elapsedSec: 4000,
        startedAt: new Date(Date.UTC(2026, 5, 2)),
        unranked: 'start',
      },
    ]);
  });

  it('история с финишами — общий порядок по дате и курсор по id гонки', () => {
    const all = historyRows([row(1, 1), row(3, 2)], [finish(2), finish(4, 'no_heart_rate')]);
    const first = pageRows(all, null, 2);
    expect(first?.page.map((r) => [r.raceId, r.unranked])).toEqual([
      [id(4), 'no_heart_rate'],
      [id(3), null],
    ]);
    expect(pageRows(all, first!.next, 2)?.page.map((r) => r.raceId)).toEqual([id(2), id(1)]);
  });
});
