import { uuidv7 } from '@rkarakulov/api-kit/mongo';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { createHarness, type Harness } from '../../../test/harness';
import {
  addRevision,
  dqRow,
  placedRow,
  seedProtocolRace,
  seedSeason,
  syncStandings,
} from '../../../test/standings';
import { RIDER_SEASON_STANDINGS, type RiderSeasonStandings } from './rider-season-standings.port';
import { StandingsSource } from './standings-source';

/**
 * Порт `RIDER_SEASON_STANDINGS` (achievements-seasonal, 7.2): итоги райдера по завершённым сезонам из снимка; `final` —
 * последний день прошёл, гонок с коридором без протокола нет, отпечаток снимка равен источнику.
 */
let h: Harness;
beforeAll(async () => {
  h = await createHarness();
});
beforeEach(async () => {
  await h.reset();
});
afterEach(() => {
  vi.restoreAllMocks();
});
afterAll(async () => {
  await h.close();
});

const port = () => h.app.get<RiderSeasonStandings>(RIDER_SEASON_STANDINGS, { strict: false });
const outcomes = (userId: string, also: readonly string[] = []) =>
  port().outcomesOf(userId, also, h.clock.now());
const CORRIDOR = { routeId: '01890a5d-ac96-774b-bcce-b302099a8057', widthM: 50, distanceM: 40000 };

describe('RIDER_SEASON_STANDINGS.outcomesOf', () => {
  it('завершённый сезон с актуальным снимком — `final` со строками и числом гонок с местом; незавершённый — нет в ответе', async () => {
    const me = uuidv7();
    const other = uuidv7();
    const past = await seedSeason(h, 'Сезон 2025', { year: 2025 });
    const current = await seedSeason(h, 'Сезон 2026');
    await seedProtocolRace(h, past, [placedRow(me, 1), placedRow(other, 2)]);
    await seedProtocolRace(h, past, [placedRow(other, 1), placedRow(me, 2)]);
    await seedProtocolRace(h, past, [placedRow(other, 1), dqRow(me)]);
    await seedProtocolRace(h, current, [placedRow(me, 1)]);
    await syncStandings(h);

    expect(await outcomes(me)).toEqual([
      {
        seasonId: past,
        status: 'final',
        title: 'Сезон 2025',
        endsOn: '2025-10-31',
        endsBefore: new Date('2025-10-31T21:00:00Z'),
        rows: [{ bikeClass: 'road', groupKey: 'm_u40', place: 2, tied: false, placedRaces: 2 }],
      },
    ]);
  });

  it('новая ревизия без пересчёта — `pending`; после пересчёта — `final` с новым местом', async () => {
    const me = uuidv7();
    const other = uuidv7();
    const past = await seedSeason(h, 'Сезон 2025', { year: 2025 });
    const race = await seedProtocolRace(h, past, [placedRow(me, 1), placedRow(other, 2)]);
    await syncStandings(h);
    expect((await outcomes(me))[0]).toMatchObject({ status: 'final', rows: [{ place: 1 }] });

    await addRevision(h, race, 2, [placedRow(other, 1), placedRow(me, 2)]);
    expect(await outcomes(me)).toEqual([
      { seasonId: past, status: 'pending', title: 'Сезон 2025' },
    ]);

    await syncStandings(h);
    expect((await outcomes(me))[0]).toMatchObject({ status: 'final', rows: [{ place: 2 }] });
  });

  it('опубликованная гонка с коридором без протокола — `pending` (RC-S2); анонс и отменённая — не мешают', async () => {
    const me = uuidv7();
    const past = await seedSeason(h, 'Сезон 2025', { year: 2025 });
    await seedProtocolRace(h, past, [placedRow(me, 1)]);
    await seedProtocolRace(h, past, [], { protocol: false });
    await seedProtocolRace(h, past, [], {
      protocol: false,
      corridor: CORRIDOR,
      status: 'cancelled',
    });
    await syncStandings(h);
    expect((await outcomes(me))[0]).toMatchObject({ status: 'final' });

    await seedProtocolRace(h, past, [], { protocol: false, corridor: CORRIDOR });
    expect(await outcomes(me)).toEqual([
      { seasonId: past, status: 'pending', title: 'Сезон 2025' },
    ]);
  });

  it('`alsoSeasonIds` без строк — `final` с `rows: []`; незавершённые и неизвестные — нет в ответе', async () => {
    const me = uuidv7();
    const past = await seedSeason(h, 'Сезон 2025', { year: 2025 });
    const current = await seedSeason(h, 'Сезон 2026');
    await seedProtocolRace(h, past, [placedRow(uuidv7(), 1)]);
    await syncStandings(h);

    expect(await outcomes(me, [past, current, uuidv7()])).toEqual([
      {
        seasonId: past,
        status: 'final',
        title: 'Сезон 2025',
        endsOn: '2025-10-31',
        endsBefore: new Date('2025-10-31T21:00:00Z'),
        rows: [],
      },
    ]);
  });

  it('райдер без строк и без сохранённых выдач — `[]`, источник не читается', async () => {
    const past = await seedSeason(h, 'Сезон 2025', { year: 2025 });
    await seedProtocolRace(h, past, [placedRow(uuidv7(), 1)]);
    await syncStandings(h);
    const load = vi.spyOn(h.app.get(StandingsSource, { strict: false }), 'load');

    expect(await outcomes(uuidv7())).toEqual([]);
    expect(load).not.toHaveBeenCalled();
  });

  it('завершённых сезонов нет — `[]`', async () => {
    const me = uuidv7();
    const current = await seedSeason(h, 'Сезон 2026');
    await seedProtocolRace(h, current, [placedRow(me, 1)]);
    await syncStandings(h);
    expect(await outcomes(me, [current])).toEqual([]);
  });
});

describe('RIDER_SEASON_STANDINGS.seasonTitles (achievements-push)', () => {
  it('названия только завершённых сезонов из набора; незавершённые и неизвестные — нет; снимок не читается', async () => {
    const past = await seedSeason(h, 'Сезон 2025', { year: 2025 });
    const current = await seedSeason(h, 'Сезон 2026');
    const load = vi.spyOn(h.app.get(StandingsSource, { strict: false }), 'load');

    const titles = await port().seasonTitles([past, current, uuidv7()], h.clock.now());
    expect([...titles]).toEqual([[past, 'Сезон 2025']]);
    expect(await port().seasonTitles([], h.clock.now())).toEqual(new Map());
    expect(load).not.toHaveBeenCalled();
  });
});
