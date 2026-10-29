import { uuidv7 } from '@rkarakulov/api-kit/mongo';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { createHarness, type Harness } from '../../../test/harness';
import { seedStart } from '../../../test/og';
import { CALENDAR_FOR_SHARING, type CalendarForSharing } from './index';

/** Порт OG-картинки старта календаря (og-images, D7/D9): только опубликованный; keyset изменений. */
let h: Harness;
beforeAll(async () => {
  h = await createHarness();
});
beforeEach(async () => {
  await h.reset();
});
afterAll(async () => {
  await h.close();
});

const port = () => h.app.get<CalendarForSharing>(CALENDAR_FOR_SHARING);
const at = (minute: number) => new Date(Date.UTC(2026, 9, 29, 10, minute));

describe('ogFacts', () => {
  it('опубликованный — публичные факты без ссылки регистрации и описания', async () => {
    const id = await seedStart(h, { registrationUrl: 'https://example.by', description: 'x' });
    expect(await port().ogFacts(id)).toEqual({
      startId: id,
      title: 'Гран-фондо Минск',
      startsOn: '2026-11-14',
      endsOn: '2026-11-15',
      city: 'Минск',
      distancesKm: [60, 120],
    });
  });

  it('снятый и неизвестный — null', async () => {
    const unpublished = await seedStart(h, { status: 'unpublished' });
    for (const id of [unpublished, uuidv7()]) expect(await port().ogFacts(id)).toBeNull();
  });
});

describe('ogChanged', () => {
  it('порядок, курсор на равных updatedAt, limit; снятые — нет', async () => {
    const [a, b] = [uuidv7(), uuidv7()].sort();
    await seedStart(h, { _id: b!, updatedAt: at(1) });
    await seedStart(h, { _id: a!, updatedAt: at(1) });
    await seedStart(h, { status: 'unpublished', updatedAt: at(2) });
    expect(await port().ogChanged(null, 10)).toEqual([
      { id: a, updatedAt: at(1) },
      { id: b, updatedAt: at(1) },
    ]);
    expect(await port().ogChanged(null, 1)).toEqual([{ id: a, updatedAt: at(1) }]);
    expect(await port().ogChanged({ at: at(1), id: a! }, 10)).toEqual([
      { id: b, updatedAt: at(1) },
    ]);
  });
});
