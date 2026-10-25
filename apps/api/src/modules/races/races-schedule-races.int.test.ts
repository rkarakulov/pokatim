import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { createHarness, type Harness } from '../../../test/harness';
import { gate, untilBlocked } from '../../../test/identity';
import { panelCall } from '../../../test/panel';
import { createRace, createSeason, RACES, racesDb, SEASONS, staff } from '../../../test/races';
import { RacesRepository } from './races.repository';

/**
 * Гонка «публикация ↔ сжатие сезона» (AC4, R2): «опубликованная гонка — внутри своего сезона» и «сжатие не выбрасывает
 * гонки» — условия по другим документам. Публикация встаёт на воротах после поиска сезона; сжатие идёт до упора —
 * с замком `lockSchedule` оно повторяется (и затем видит опубликованную гонку), без замка — коммитится.
 */
let h: Harness;
beforeAll(async () => {
  h = await createHarness({ TRUST_PROXY: '1' });
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

const repository = () => h.app.get(RacesRepository, { strict: false });

async function publishVersusShrink() {
  const admin = await staff(h, 'admin@example.by', 'admin');
  const org = await staff(h, 'org@example.by', 'organizer');
  const seasonId = await createSeason(h, admin.token);
  // конец окна — 26.10 23:59 Минска; сжатие сезона до 25.10 выбрасывает его
  const race = await createRace(h, org.token);

  const target = repository();
  const covering = target.seasonCovering.bind(target);
  const paused = gate();
  vi.spyOn(target, 'seasonCovering').mockImplementationOnce(async (...args) => {
    const season = await covering(...args);
    await paused.wait(); // снимок публикации: сезон ещё до 31.10
    return season;
  });
  const lockSpy = vi.spyOn(target, 'lockSchedule');
  const locksBefore = lockSpy.mock.calls.length;

  const publish = panelCall(h, org.token, 'POST', `${RACES}/${race.id}/publish`, { version: 0 });
  await paused.reached;
  const shrink = panelCall(h, admin.token, 'POST', `${SEASONS}/${seasonId}`, {
    version: 0,
    endsOn: '2026-10-25',
  });
  // сжатие упёрлось в замок публикации (повторы lockSchedule) или завершилось (замка нет)
  await untilBlocked(shrink, () => Promise.resolve(lockSpy.mock.calls.length - locksBefore >= 3));
  paused.open();
  const [published, shrunk] = await Promise.all([publish, shrink]);
  const season = await racesDb(h).seasons.findOne({ _id: seasonId });
  const stored = await racesDb(h).races.findOne({ _id: race.id });
  return { published, shrunk, season, stored };
}

describe('публикация ↔ сжатие сезона (AC4, R2)', () => {
  it('публикация проходит, сжатие отклонено SEASON_EXCLUDES_RACES: опубликованной гонки вне сезона нет', async () => {
    const { published, shrunk, season, stored } = await publishVersusShrink();

    expect(published.status).toBe(200);
    expect(shrunk.status).toBe(400);
    expect(shrunk.body).toMatchObject({
      details: { fields: [{ path: 'endsOn', code: 'SEASON_EXCLUDES_RACES' }] },
    });
    expect(season?.endsOn).toBe('2026-10-31');
    expect(stored?.status).toBe('published');
    expect(stored!.windowEndsAt < season!.endsBefore).toBe(true);
  });

  it('отрицательное доказательство: без lockSchedule — обе операции проходят, гонка вне своего сезона', async () => {
    vi.spyOn(RacesRepository.prototype, 'lockSchedule').mockResolvedValue(undefined);

    const { published, shrunk, season, stored } = await publishVersusShrink();

    expect([published.status, shrunk.status]).toEqual([200, 200]);
    expect(stored?.status).toBe('published');
    expect(stored?.seasonId).toBe(season?._id);
    expect(stored!.windowEndsAt >= season!.endsBefore).toBe(true);
  });
});
