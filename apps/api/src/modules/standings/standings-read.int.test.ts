import {
  MySeasonStandings,
  PanelSeasonStandingsSummary,
  PanelSeasonStandingsTable,
  SeasonStandingsSummary,
  SeasonStandingsTable,
} from '@pokatim/contracts';
import { uuidv7 } from '@rkarakulov/api-kit/mongo';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { createHarness, type Harness } from '../../../test/harness';
import { call } from '../../../test/identity';
import { panelCall } from '../../../test/panel';
import { fieldCodes, staff } from '../../../test/races';
import { rider } from '../../../test/results';
import {
  addRevision,
  dqRow,
  placedRow,
  seedProfile,
  seedProtocolRace,
  seedSeason,
  syncStandings,
} from '../../../test/standings';

/**
 * Чтение рейтинга сезона (race-results-08, AC8–AC10): публичные ответы без `userId`, имя только с согласием, кэш;
 * 404/400; пустой сезон и таблица не из снимка (RC-12); `/me` — только свои строки; панель — `userId` по видимости
 * гонок (RC-8), «ждёт пересчёта» (RC-14).
 */
let h: Harness;
beforeAll(async () => {
  h = await createHarness({ TRUST_PROXY: '1' });
});
beforeEach(async () => {
  await h.reset();
});
afterAll(async () => {
  await h.close();
});

const NAMED_PUBLIC_ID = 'N'.repeat(43);
const NAMED_AVATAR = 'a'.repeat(43);

const base = (seasonId: string) => `/v1/seasons/${seasonId}/standings`;
const adminBase = (seasonId: string) => `/v1/admin/seasons/${seasonId}/standings`;

/**
 * Сезон: шоссе пол × возраст — Г1 (named 1, me 2, hidden 3), Г2 (me 1, named DQ); гравий overall — Г3 (me 1).
 * named — имя с согласием, hidden — имя без согласия.
 */
async function season() {
  const me = await rider(h, 'me@example.com');
  const named = uuidv7();
  const hidden = uuidv7();
  await seedProfile(h, named, 'Анна К.', true, {
    publicId: NAMED_PUBLIC_ID,
    avatarId: NAMED_AVATAR,
  });
  // ссылка и фото без согласия наружу не выходят
  await seedProfile(h, hidden, 'Скрытый', false, {
    publicId: 'H'.repeat(43),
    avatarId: 'h'.repeat(43),
  });
  const seasonId = await seedSeason(h);
  const g1 = await seedProtocolRace(
    h,
    seasonId,
    [placedRow(named, 1), placedRow(me.userId, 2), placedRow(hidden, 3)],
    { title: 'Г1', windowEndsAt: new Date('2026-05-01T20:59:00Z') },
  );
  const g2 = await seedProtocolRace(h, seasonId, [placedRow(me.userId, 1), dqRow(named)], {
    title: 'Г2',
    windowEndsAt: new Date('2026-06-01T20:59:00Z'),
  });
  const g3 = await seedProtocolRace(h, seasonId, [placedRow(me.userId, 1, 'overall')], {
    title: 'Г3',
    bikeClass: 'gravel',
    groupScheme: 'overall',
    windowEndsAt: new Date('2026-07-01T20:59:00Z'),
  });
  await syncStandings(h);
  return { seasonId, me, named, hidden, g1, g2, g3 };
}

const tableUrl = (seasonId: string, query: string) => `${base(seasonId)}/table?${query}`;

describe('публичные ответы (AC8)', () => {
  it('сводка: таблицы по порядку класса и группы, computedAt, Cache-Control public', async () => {
    const { seasonId } = await season();
    const res = await call(h, 'GET', base(seasonId));
    expect(res.status).toBe(200);
    expect(res.headers['cache-control']).toBe('public, max-age=60');
    const body = SeasonStandingsSummary.parse(res.body);
    expect(Object.keys(res.body as object).sort()).toEqual(['computedAt', 'seasonId', 'tables']);
    expect(body.computedAt).toBe(h.clock.now().toISOString());
    expect(body.tables).toEqual([
      { bikeClass: 'road', groupKey: 'm_u40', riders: 3, racesTotal: 2, racesCounted: 2 },
      { bikeClass: 'gravel', groupKey: 'overall', riders: 1, racesTotal: 1, racesCounted: 1 },
    ]);
  });

  it('таблица: строки без userId (ключи — тест), имя только с согласием, ячейки по гонкам', async () => {
    const { seasonId, g1, g2 } = await season();
    const res = await call(h, 'GET', tableUrl(seasonId, 'bikeClass=road&group=m_u40'));
    expect(res.status).toBe(200);
    expect(res.headers['cache-control']).toBe('public, max-age=60');
    const raw = res.body as { items: object[] };
    expect(Object.keys(raw).sort()).toEqual([
      'bikeClass',
      'computedAt',
      'groupKey',
      'items',
      'nextCursor',
      'races',
      'racesCounted',
      'racesTotal',
      'riders',
    ]);
    for (const row of raw.items) {
      expect(Object.keys(row).sort()).toEqual([
        'cells',
        'order',
        'place',
        'points',
        'riderAvatar',
        'riderName',
        'riderPublicId',
        'tied',
      ]);
    }
    expect(JSON.stringify(res.body)).not.toContain('userId');
    const body = SeasonStandingsTable.parse(res.body);
    expect(body.races.map((race) => [race.id, race.title])).toEqual([
      [g1, 'Г1'],
      [g2, 'Г2'],
    ]);
    // me: 85 + 100 = 185; named: 100 + DQ 0 = 100; hidden: 75
    expect(body.items.map((row) => [row.order, row.place, row.riderName, row.points])).toEqual([
      [0, 1, null, 185],
      [1, 2, 'Анна К.', 100],
      [2, 3, null, 75],
    ]);
    // ссылка на профиль и фото — только с согласием (rider-links-in-tables)
    expect(body.items.map((row) => [row.riderPublicId, row.riderAvatar])).toEqual([
      [null, null],
      [NAMED_PUBLIC_ID, { id: NAMED_AVATAR }],
      [null, null],
    ]);
    expect(body.items[1]!.cells.map((cell) => [cell.outcome, cell.points, cell.counted])).toEqual([
      ['placed', 100, true],
      ['dq', 0, true],
    ]);
    expect(body.nextCursor).toBeNull();
  });

  it('страницы по курсору; курсор чужого сезона и мусор — 400', async () => {
    const { seasonId } = await season();
    const orders: number[] = [];
    let cursor: string | null = null;
    for (let page = 0; page < 5; page += 1) {
      const res = await call(
        h,
        'GET',
        tableUrl(
          seasonId,
          `bikeClass=road&group=m_u40&limit=1${cursor ? `&cursor=${cursor}` : ''}`,
        ),
      );
      const body = SeasonStandingsTable.parse(res.body);
      orders.push(...body.items.map((row) => row.order));
      cursor = body.nextCursor;
      if (!cursor) break;
    }
    expect(orders).toEqual([0, 1, 2]);

    const first = SeasonStandingsTable.parse(
      (await call(h, 'GET', tableUrl(seasonId, 'bikeClass=road&group=m_u40&limit=1'))).body,
    );
    const other = await seedSeason(h, 'Другой');
    const foreign = await call(
      h,
      'GET',
      tableUrl(other, `bikeClass=road&group=m_u40&cursor=${first.nextCursor}`),
    );
    expect([foreign.status, fieldCodes(foreign.body)]).toEqual([400, ['cursor:INVALID']]);
    const garbage = await call(
      h,
      'GET',
      tableUrl(seasonId, 'bikeClass=road&group=m_u40&cursor=!!'),
    );
    expect([garbage.status, fieldCodes(garbage.body)]).toEqual([400, ['cursor:INVALID']]);
  });

  it('неизвестный сезон — 404, невалидный id и query — 400', async () => {
    const unknown = uuidv7();
    expect((await call(h, 'GET', base(unknown))).status).toBe(404);
    expect((await call(h, 'GET', tableUrl(unknown, 'bikeClass=road&group=m_u40'))).status).toBe(
      404,
    );
    expect((await call(h, 'GET', base('not-a-uuid'))).status).toBe(400);
    const seasonId = await seedSeason(h);
    expect((await call(h, 'GET', tableUrl(seasonId, 'bikeClass=road'))).status).toBe(400);
    expect(
      (await call(h, 'GET', tableUrl(seasonId, 'bikeClass=road&group=m_u40&extra=1'))).status,
    ).toBe(400);
  });

  it('метка `_` обхода HTTP-кэша (whatwg-fetch React Native) — тот же ответ, что без неё (iOS NSURLCache)', async () => {
    const { seasonId } = await season();
    const plain = await call(h, 'GET', tableUrl(seasonId, 'bikeClass=road&group=m_u40'));
    const busted = await call(
      h,
      'GET',
      tableUrl(seasonId, 'bikeClass=road&group=m_u40&_=1761990000000'),
    );
    expect([busted.status, busted.body]).toEqual([200, plain.body]);
  });

  it('сезон без протоколов — пустая сводка; таблица не из снимка — пустая страница (RC-12)', async () => {
    const empty = await seedSeason(h, 'Пустой');
    expect(SeasonStandingsSummary.parse((await call(h, 'GET', base(empty))).body)).toEqual({
      seasonId: empty,
      computedAt: null,
      tables: [],
    });
    const { seasonId } = await season();
    const res = await call(h, 'GET', tableUrl(seasonId, 'bikeClass=road&group=w_u40'));
    expect(res.status).toBe(200);
    expect(SeasonStandingsTable.parse(res.body)).toEqual({
      bikeClass: 'road',
      groupKey: 'w_u40',
      computedAt: h.clock.now().toISOString(),
      racesTotal: 0,
      racesCounted: 0,
      riders: 0,
      races: [],
      items: [],
      nextCursor: null,
    });
  });
});

describe('/me (AC9)', () => {
  it('без входа — 401; вошедший — только свои строки во всех таблицах, no-store', async () => {
    const { seasonId, me, g1, g2, g3 } = await season();
    expect((await call(h, 'GET', `${base(seasonId)}/me`)).status).toBe(401);
    const res = await call(h, 'GET', `${base(seasonId)}/me`, undefined, me.auth);
    expect(res.status).toBe(200);
    expect(res.headers['cache-control']).toBe('no-store');
    expect(JSON.stringify(res.body)).not.toContain('userId');
    const body = MySeasonStandings.parse(res.body);
    expect(body.computedAt).toBe(h.clock.now().toISOString());
    expect(body.races.map((race) => race.id)).toEqual([g1, g2, g3]);
    expect(
      body.items.map((item) => [
        item.bikeClass,
        item.groupKey,
        item.order,
        item.place,
        item.points,
        item.riders,
        item.raceIds,
      ]),
    ).toEqual([
      ['road', 'm_u40', 0, 1, 185, 3, [g1, g2]],
      ['gravel', 'overall', 0, 1, 100, 1, [g3]],
    ]);

    const stranger = await rider(h, 'stranger@example.com');
    const none = MySeasonStandings.parse(
      (await call(h, 'GET', `${base(seasonId)}/me`, undefined, stranger.auth)).body,
    );
    expect(none.items).toEqual([]);
    expect(none.races).toEqual([]);
    expect((await call(h, 'GET', `${base(uuidv7())}/me`, undefined, me.auth)).status).toBe(404);
  });
});

describe('панель (AC10, RC-8, RC-14)', () => {
  it('без сессии панели и с токеном райдера — 401', async () => {
    const { seasonId, me } = await season();
    expect((await panelCall(h, undefined, 'GET', adminBase(seasonId))).status).toBe(401);
    expect(
      (
        await call(
          h,
          'GET',
          `${adminBase(seasonId)}/table?bikeClass=road&group=m_u40`,
          undefined,
          me.auth,
        )
      ).status,
    ).toBe(401);
  });

  it('admin и moderator видят userId строк, organizer — null; имя по согласию', async () => {
    const { seasonId, me, named, hidden } = await season();
    const url = `${adminBase(seasonId)}/table?bikeClass=road&group=m_u40`;
    for (const [email, role] of [
      ['admin@example.by', 'admin'],
      ['moderator@example.by', 'moderator'],
    ] as const) {
      const { token } = await staff(h, email, role);
      const res = await panelCall(h, token, 'GET', url);
      expect(res.status).toBe(200);
      expect(res.headers['cache-control']).toBe('no-store');
      const body = PanelSeasonStandingsTable.parse(res.body);
      expect(body.items.map((row) => [row.userId, row.riderName])).toEqual([
        [me.userId, null],
        [named, 'Анна К.'],
        [hidden, null],
      ]);
    }
    const organizer = await staff(h, 'organizer@example.by', 'organizer');
    const res = await panelCall(h, organizer.token, 'GET', url);
    expect(res.status).toBe(200);
    expect(PanelSeasonStandingsTable.parse(res.body).items.map((row) => row.userId)).toEqual([
      null,
      null,
      null,
    ]);
  });

  it('сводка: formulaVersion и sync — pending до пересчёта, current после', async () => {
    const { seasonId, g2, me } = await season();
    const { token } = await staff(h, 'admin@example.by', 'admin');
    const summary = async () => {
      const res = await panelCall(h, token, 'GET', adminBase(seasonId));
      expect(res.status).toBe(200);
      return PanelSeasonStandingsSummary.parse(res.body);
    };
    expect(await summary()).toMatchObject({ formulaVersion: 1, sync: 'current' });
    await addRevision(h, g2, 2, [placedRow(me.userId, 1)]);
    expect((await summary()).sync).toBe('pending');
    await syncStandings(h);
    expect((await summary()).sync).toBe('current');

    const empty = await seedSeason(h, 'Пустой');
    expect(
      PanelSeasonStandingsSummary.parse((await panelCall(h, token, 'GET', adminBase(empty))).body),
    ).toEqual({
      seasonId: empty,
      computedAt: null,
      tables: [],
      formulaVersion: null,
      sync: 'current',
    });
    const fresh = await seedSeason(h, 'Без снимка');
    await seedProtocolRace(h, fresh, [placedRow(me.userId, 1)]);
    expect(
      PanelSeasonStandingsSummary.parse((await panelCall(h, token, 'GET', adminBase(fresh))).body)
        .sync,
    ).toBe('pending');
    expect((await panelCall(h, token, 'GET', adminBase(uuidv7()))).status).toBe(404);
  });
});
