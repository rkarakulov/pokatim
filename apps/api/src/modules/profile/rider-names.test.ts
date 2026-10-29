import type { Db } from 'mongodb';
import { describe, expect, it } from 'vitest';

import { ProfileRepository } from './profile.repository';
import { RiderNamesService } from './rider-names';

/** Коллекция-заглушка: запоминает фильтры `find` и отдаёт заданные документы. */
function fakeDb(docs: { _id: string; publicName: string; publicId?: string; avatarId?: string }[]) {
  const filters: unknown[] = [];
  const collection = {
    find: (filter: unknown) => {
      filters.push(filter);
      return { toArray: () => Promise.resolve(docs) };
    },
  };
  return { db: { collection: () => collection } as unknown as Db, filters };
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
