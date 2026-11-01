import type { CatalogRouteCard, RideCard } from '@pokatim/contracts';
import { describe, expect, it } from 'vitest';

import type { SocialRaceResult } from '../results';
import { homeRiderOf, pickHomeRows, resultRowOf, rideRowOf, routeRowOf } from './social-home.view';

const card = (name: string) => ({ name, publicId: name.padEnd(43, 'x'), avatarId: null });
const friends = new Map(
  ['a', 'b', 'c', 'd', 'e'].map((id) => [id, homeRiderOf(card(id.toUpperCase()))!] as const),
);
const ride = (id: string, participantIds: string[]) => ({
  card: { id } as unknown as RideCard,
  participantIds,
});
const result = (
  entryId: string,
  userId: string,
  viewerElapsedSec: number | null = null,
): SocialRaceResult => ({
  raceId: 'race',
  raceTitle: 'Гран-при',
  publishedAt: new Date('2026-10-21T10:00:00Z'),
  entryId,
  userId,
  place: 2,
  tied: false,
  elapsedSec: 7180,
  viewerElapsedSec,
});
const route = (id: string, authorUserId: string) => ({
  card: { id } as unknown as CatalogRouteCard,
  authorUserId,
});

describe('строки секции «Свои» (social-p7, RC-P7-12…14)', () => {
  it('«свой» — только с publicId', () => {
    expect(homeRiderOf({ name: 'Скрытый', publicId: null, avatarId: null })).toBeNull();
    expect(homeRiderOf({ name: 'Катя', publicId: 'p', avatarId: 'av' })).toEqual({
      name: 'Катя',
      publicId: 'p',
      avatar: { id: 'av' },
    });
  });

  it('райд: «свои» в порядке участников, ≤ 3, остальные числом; без «своих» — без строки', () => {
    expect(rideRowOf(ride('r', ['x', 'b', 'a', 'y', 'c', 'd', 'e']), friends)).toMatchObject({
      kind: 'ride',
      riders: [{ name: 'B' }, { name: 'A' }, { name: 'C' }],
      othersCount: 2,
    });
    expect(rideRowOf(ride('r', ['a']), friends)?.othersCount).toBe(0);
    expect(rideRowOf(ride('r', ['x', 'y']), friends)).toBeNull();
  });

  it('результат: разница — своё − зрителя (минус — быстрее), нет зрителя — null', () => {
    expect(resultRowOf(result('e', 'a', 7200), friends)?.deltaSec).toBe(-20);
    expect(resultRowOf(result('e', 'a', 7000), friends)?.deltaSec).toBe(180);
    expect(resultRowOf(result('e', 'a', 7180), friends)?.deltaSec).toBe(0);
    expect(resultRowOf(result('e', 'a'), friends)?.deltaSec).toBeNull();
    expect(resultRowOf(result('e', 'x'), friends)).toBeNull();
  });

  it('маршрут: автор — «свой»', () => {
    expect(routeRowOf(route('m', 'c'), friends)).toMatchObject({
      kind: 'route',
      rider: { name: 'C' },
    });
    expect(routeRowOf(route('m', 'x'), friends)).toBeNull();
  });
});

describe('pickHomeRows — по кругу видов, ≤ 3, сгруппировано', () => {
  const rides = ['r1', 'r2', 'r3', 'r4'].map((id) => rideRowOf(ride(id, ['a']), friends)!);
  const results = ['e1', 'e2', 'e3'].map((id) => resultRowOf(result(id, 'b'), friends)!);
  const routes = ['m1', 'm2'].map((id) => routeRowOf(route(id, 'c'), friends)!);
  const ids = (rows: ReturnType<typeof pickHomeRows>) =>
    rows.map((row) =>
      row.kind === 'ride' ? row.ride.id : row.kind === 'result' ? row.entryId : row.route.id,
    );

  it('только райды — три райда по порядку', () => {
    expect(ids(pickHomeRows({ ride: rides, result: [], route: [] }))).toEqual(['r1', 'r2', 'r3']);
  });

  it('2/2/2 — по одному каждого вида в порядке K7', () => {
    expect(
      ids(pickHomeRows({ ride: rides.slice(0, 2), result: results.slice(0, 2), route: routes })),
    ).toEqual(['r1', 'e1', 'm1']);
  });

  it('райды и результаты — второй круг начинается с райда; группировка по виду', () => {
    expect(ids(pickHomeRows({ ride: rides, result: results, route: [] }))).toEqual([
      'r1',
      'r2',
      'e1',
    ]);
    expect(ids(pickHomeRows({ ride: [], result: results, route: routes.slice(0, 1) }))).toEqual([
      'e1',
      'e2',
      'm1',
    ]);
  });

  it('пусто — пусто; меньше трёх — все', () => {
    expect(pickHomeRows({ ride: [], result: [], route: [] })).toEqual([]);
    expect(ids(pickHomeRows({ ride: [], result: [], route: routes }))).toEqual(['m1', 'm2']);
  });
});
