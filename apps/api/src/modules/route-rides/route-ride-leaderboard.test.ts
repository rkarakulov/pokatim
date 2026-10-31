import { describe, expect, it } from 'vitest';

import type { PublicRiderCard } from '../profile';
import { firstAlive, type LeaderboardEntry, rankLeaderboard } from './route-ride-leaderboard';

const id = (n: number) => `01890a5d-ac96-774b-bcce-${String(n).padStart(12, '0')}`;
const T0 = new Date('2026-10-20T06:00:00Z');
const day = (n: number) => new Date(T0.getTime() + n * 86_400_000);

const entry = (
  user: number,
  elapsedSec: number,
  startedAt = T0,
  ride = 100 + user,
): LeaderboardEntry => ({ userId: `u${user}`, rideId: id(ride), elapsedSec, startedAt });

const rank = (input: Partial<Parameters<typeof rankLeaderboard>[0]>) =>
  rankLeaderboard({ others: [], me: null, cards: new Map(), limit: 10, shared: true, ...input });

describe('firstAlive (route-rides-04, O3)', () => {
  const top = [
    { id: id(1), activityId: 'a1', elapsedSec: 700, startedAt: T0 },
    { id: id(2), activityId: 'a2', elapsedSec: 710, startedAt: T0 },
    { id: id(3), activityId: 'a3', elapsedSec: 720, startedAt: T0 },
  ];

  it('лучший жив — он; лучший удалён — следующий; все три удалены — нет строки', () => {
    expect(firstAlive(top, new Set(['a1', 'a2', 'a3']))?.id).toBe(id(1));
    expect(firstAlive(top, new Set(['a2', 'a3']))?.id).toBe(id(2));
    expect(firstAlive(top, new Set(['a3']))?.id).toBe(id(3));
    expect(firstAlive(top, new Set())).toBeUndefined();
    expect(firstAlive([], new Set(['a1']))).toBeUndefined();
  });
});

describe('rankLeaderboard (route-rides-04, O3/O4)', () => {
  it('места уникальные 1…n по времени; ничья — раньше дата, затем меньший rideId; total — все строки', () => {
    const table = rank({
      others: [
        entry(1, 900),
        entry(2, 800, day(3)),
        entry(3, 800, day(1), 200),
        entry(4, 800, day(1), 150),
      ],
    });
    expect(table.rows.map((row) => [row.place, row.elapsedSec, row.rideDate])).toEqual([
      [1, 800, '2026-10-21'],
      [2, 800, '2026-10-21'],
      [3, 800, '2026-10-23'],
      [4, 900, '2026-10-20'],
    ]);
    expect(table.total).toBe(4);
    expect(table.me).toBeNull();
    expect(table.rows.every((row) => row.rideId === null)).toBe(true);
  });

  it('карточка → имя, ссылка и фото (P1); нет карточки → null («Участник»); ключи строки — точный список', () => {
    const cards = new Map<string, PublicRiderCard>([
      ['u1', { name: 'Анна К.', publicId: 'p1', avatarId: 'a1' }],
    ]);
    const table = rank({ others: [entry(1, 700), entry(2, 800)], cards });
    expect(table.rows).toEqual([
      {
        place: 1,
        elapsedSec: 700,
        rideDate: '2026-10-20',
        riderName: 'Анна К.',
        riderPublicId: 'p1',
        riderAvatar: { id: 'a1' },
        rideId: null,
      },
      {
        place: 2,
        elapsedSec: 800,
        rideDate: '2026-10-20',
        riderName: null,
        riderPublicId: null,
        riderAvatar: null,
        rideId: null,
      },
    ]);
  });

  it('зритель — в общем списке (места других сдвинуты), rideId только у своей строки; me — с местом', () => {
    const me = entry(9, 750, day(2), 999);
    const table = rank({ others: [entry(1, 700), entry(2, 800)], me, shared: false });
    expect(table.rows.map((row) => [row.place, row.elapsedSec, row.rideId])).toEqual([
      [1, 700, null],
      [2, 750, id(999)],
      [3, 800, null],
    ]);
    expect(table.me).toEqual({
      place: 2,
      elapsedSec: 750,
      rideDate: '2026-10-22',
      rideId: id(999),
    });
    expect(table.total).toBe(3);
    expect(table.shared).toBe(false);
  });

  it('me вне limit — есть в me, нет в rows; total — с собой', () => {
    const others = Array.from({ length: 5 }, (_, i) => entry(i + 1, 600 + i));
    const table = rank({ others, me: entry(9, 900, T0, 999), limit: 3 });
    expect(table.rows.map((row) => row.place)).toEqual([1, 2, 3]);
    expect(table.rows.some((row) => row.rideId !== null)).toBe(false);
    expect(table.me).toMatchObject({ place: 6, rideId: id(999) });
    expect(table.total).toBe(6);
  });

  it('rideDate — день по Минску: заезд 22:30 UTC — следующий день', () => {
    const late = new Date('2026-10-20T22:30:00Z');
    expect(rank({ others: [entry(1, 700, late)] }).rows[0]?.rideDate).toBe('2026-10-21');
  });

  it('пусто — без строк, total 0, me null', () => {
    expect(rank({ shared: false })).toEqual({ rows: [], total: 0, me: null, shared: false });
  });
});
