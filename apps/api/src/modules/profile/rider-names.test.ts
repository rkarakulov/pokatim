import type { Db } from 'mongodb';
import { describe, expect, it } from 'vitest';

import { ProfileRepository } from './profile.repository';
import { RiderNamesService } from './rider-names';

/** Коллекция-заглушка: запоминает фильтры `find` и отдаёт заданные документы. */
function fakeDb(
  docs: {
    _id: string;
    publicName?: string | null;
    showNameInResults?: boolean;
    publicId?: string;
    avatarId?: string;
  }[],
) {
  const filters: unknown[] = [];
  const projections: unknown[] = [];
  const collection = {
    find: (filter: unknown, options?: { projection?: unknown }) => {
      filters.push(filter);
      projections.push(options?.projection);
      return { toArray: () => Promise.resolve(docs) };
    },
  };
  return { db: { collection: () => collection } as unknown as Db, filters, projections };
}

describe('RIDER_NAMES.attributionNames (routes-06, U3, 8.1 RC-2)', () => {
  it('имя автора маршрута — без условия согласия на показ в результатах; только строка имени', async () => {
    const { db, filters } = fakeDb([{ _id: 'u1', publicName: 'Аня' }]);
    const names = new RiderNamesService(new ProfileRepository(db));
    expect(await names.attributionNames(['u1', 'u1', 'u2'])).toEqual(new Map([['u1', 'Аня']]));
    expect(filters).toEqual([{ _id: { $in: ['u1', 'u2'] }, publicName: { $type: 'string' } }]);
  });

  it('пустой вход — пустая карта без запроса', async () => {
    const { db, filters } = fakeDb([]);
    const names = new RiderNamesService(new ProfileRepository(db));
    expect(await names.attributionNames([])).toEqual(new Map());
    expect(filters).toEqual([]);
  });

  it('publicNames (результаты) — по-прежнему с согласием в фильтре', async () => {
    const { db, filters } = fakeDb([]);
    await new RiderNamesService(new ProfileRepository(db)).publicNames(['u1']);
    expect(filters).toEqual([
      { _id: { $in: ['u1'] }, showNameInResults: true, publicName: { $type: 'string' } },
    ]);
  });

  it('publicRiders (таблицы) — согласие и имя в фильтре; ссылка и фото — только из найденных', async () => {
    const { db, filters } = fakeDb([
      { _id: 'u1', publicName: 'Аня', publicId: 'p1', avatarId: 'a1' },
      { _id: 'u2', publicName: 'Боря' },
    ]);
    const riders = await new RiderNamesService(new ProfileRepository(db)).publicRiders([
      'u1',
      'u2',
      'u1',
    ]);
    expect(riders).toEqual(
      new Map([
        ['u1', { name: 'Аня', publicId: 'p1', avatarId: 'a1' }],
        ['u2', { name: 'Боря', publicId: null, avatarId: null }],
      ]),
    );
    expect(filters).toEqual([
      { _id: { $in: ['u1', 'u2'] }, showNameInResults: true, publicName: { $type: 'string' } },
    ]);
  });

  it('publicRiders: пустой вход — без запроса', async () => {
    const { db, filters } = fakeDb([]);
    expect(await new RiderNamesService(new ProfileRepository(db)).publicRiders([])).toEqual(
      new Map(),
    );
    expect(filters).toEqual([]);
  });
});

describe('RIDER_NAMES.routeRideRiders (route-rides-04, O1/O3)', () => {
  it('согласие на показ заездов — в фильтре; карточка — только при имени и showNameInResults', async () => {
    const { db, filters, projections } = fakeDb([
      { _id: 'u1', publicName: 'Аня', showNameInResults: true, publicId: 'p1', avatarId: 'a1' },
      { _id: 'u2', publicName: 'Боря', showNameInResults: false, publicId: 'p2' },
      { _id: 'u3', publicName: null, showNameInResults: true },
      { _id: 'u4' },
    ]);
    const riders = await new RiderNamesService(new ProfileRepository(db)).routeRideRiders([
      'u1',
      'u2',
      'u1',
      'u3',
      'u4',
      'u5',
    ]);
    expect(riders.shares).toEqual(new Set(['u1', 'u2', 'u3', 'u4']));
    expect(riders.cards).toEqual(
      new Map([['u1', { name: 'Аня', publicId: 'p1', avatarId: 'a1' }]]),
    );
    expect(filters).toEqual([
      { _id: { $in: ['u1', 'u2', 'u3', 'u4', 'u5'] }, showRouteRides: true },
    ]);
    expect(projections).toEqual([
      { publicName: 1, showNameInResults: 1, publicId: 1, avatarId: 1 },
    ]);
  });

  it('пустой вход — пустые без запроса', async () => {
    const { db, filters } = fakeDb([]);
    const riders = await new RiderNamesService(new ProfileRepository(db)).routeRideRiders([]);
    expect(riders).toEqual({ shares: new Set(), cards: new Map() });
    expect(filters).toEqual([]);
  });
});
