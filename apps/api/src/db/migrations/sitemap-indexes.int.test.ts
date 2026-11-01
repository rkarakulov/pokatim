import type { FindCursor } from 'mongodb';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { createHarness, type Harness } from '../../../test/harness';
import { seedRace, seedStart } from '../../../test/og';
import { seedTeamRoute } from '../../../test/rides';
import { CalendarRepository } from '../../modules/calendar/calendar.repository';
import { RacesRepository } from '../../modules/races/races.repository';
import { RoutesRepository } from '../../modules/routes/routes.repository';
import { SITEMAP_INDEXES } from './0051_sitemap_indexes';

/**
 * План keyset карты сайта (sitemap-index, AC6): настоящий запрос `sitemapCursor` репозиториев (фильтр публичности,
 * диапазон `_id`, проекция, сортировка) — `IXSCAN` по `*_sitemap_idx` без `SORT`; гонки и старты — без `FETCH`.
 */
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

const id = (n: number) => `01890a5d-ac96-774b-bcce-${n.toString(16).padStart(12, '0')}`;
const range = { after: id(0), until: id(100) };

async function winning(cursor: FindCursor<unknown>): Promise<string> {
  const explain = await cursor.explain('queryPlanner');
  return JSON.stringify(explain.queryPlanner.winningPlan);
}

describe('план sitemapCursor (sitemap-index)', () => {
  it('гонки и старты — IXSCAN по *_sitemap_idx без SORT и FETCH (покрывающий)', async () => {
    for (const n of [1, 2, 3]) {
      await seedRace(h, { _id: id(n) });
      await seedStart(h, { _id: id(n) });
    }
    const plans = [
      [
        await winning(h.app.get(RacesRepository).sitemapCursor(range, 1_000)),
        SITEMAP_INDEXES.races,
      ],
      [
        await winning(h.app.get(CalendarRepository).sitemapCursor(range, 1_000)),
        SITEMAP_INDEXES.calendar,
      ],
    ] as const;
    for (const [plan, index] of plans) {
      expect(plan).toContain(`"indexName":"${index.options.name}"`);
      expect(plan).not.toContain('"SORT"');
      expect(plan).not.toContain('"FETCH"');
    }
  });

  it('маршруты каталога (`IN_CATALOG`) — IXSCAN по routes_sitemap_idx без SORT', async () => {
    await seedTeamRoute(h);
    await seedTeamRoute(h, [27.5, 53.9], 'Второе кольцо');
    const plan = await winning(
      h.app.get(RoutesRepository).sitemapCursor({ after: null, until: null }, 1_000),
    );
    expect(plan).toContain(`"indexName":"${SITEMAP_INDEXES.routes.options.name}"`);
    expect(plan).not.toContain('"SORT"');
  });
});
