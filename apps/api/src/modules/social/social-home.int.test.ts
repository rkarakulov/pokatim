import { type SocialHome as SocialHomeBody, SocialHome } from '@pokatim/contracts';
import { uuidv7 } from '@rkarakulov/api-kit/mongo';
import type { Document } from 'mongodb';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { createHarness, DAY, type Harness, MINUTE } from '../../../test/harness';
import { bearer, call, type CallResult } from '../../../test/identity';
import { type PublicRider, publicRider } from '../../../test/profiles';
import { racesDb } from '../../../test/races';
import { resultsDb } from '../../../test/results';
import { routesDb, seedApprovedRiderRoute } from '../../../test/routes';
import {
  createRide,
  hideInDb,
  join,
  type Rider,
  rider,
  ridesDb,
  startsIn,
} from '../../../test/rides';
import { socialDb } from '../../../test/social';
import {
  addRevision,
  dqRow,
  placedRow,
  type SeedRow,
  seedProtocolRace,
  seedSeason,
} from '../../../test/standings';
import { SOCIAL_POLICY } from './social.policy';

/**
 * Секция «Свои» на Главной (P7, AC1, AC2): `GET /v1/social/home` — строки ride / result / route по «своим» зрителя
 * (исходящие не убранные связи с публичным профилем; райды — при взаимной связи, RC-P7-1a), ≤ 3 по кругу видов
 * (RC-P7-12), без `userId`, `no-store`, лимит. Стенд: 2026-10-22 09:00Z = 12:00 по Минску.
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

const HOME = '/v1/social/home';
const home = (who: Rider) => call(h, 'GET', HOME, undefined, bearer(who.token));
const CORRIDOR = { routeId: '01890a5d-ac96-774b-bcce-b302099a8057', widthM: 50, distanceM: 42_000 };

function bodyOf(res: CallResult): SocialHomeBody {
  expect(res.status).toBe(200);
  expect(res.headers['cache-control']).toBe('no-store');
  return SocialHome.parse(res.body);
}
const kinds = (body: SocialHomeBody) => body.items.map((row) => row.kind);

/** Связь `owner → other` прямой вставкой; `removed` — надгробие. */
async function connect(owner: Rider, other: Rider, { removed = false } = {}) {
  const now = h.clock.now();
  await socialDb(h).connections.insertOne({
    _id: uuidv7(),
    ownerId: owner.userId,
    otherId: other.userId,
    rides: [],
    rideCount: 0,
    lastRideAt: null,
    inviteAt: null,
    manualAt: removed ? null : now,
    removedAt: removed ? now : null,
    createdAt: now,
    updatedAt: now,
  });
}
const mutual = async (a: Rider, b: Rider) => {
  await connect(a, b);
  await connect(b, a);
};

/** Опубликованная гонка с коридором и протоколом, опубликованным `ago` назад. */
async function protocolRace(rows: readonly SeedRow[], ago = DAY, title = 'Гран-при') {
  const raceId = await seedProtocolRace(h, await seedSeason(h), rows, {
    title,
    corridor: CORRIDOR,
  });
  await racesDb(h).races.updateOne(
    { _id: raceId },
    { $set: { protocolPublishedAt: new Date(h.clock.now().getTime() - ago) } },
  );
  return raceId;
}

/** Маршрут райдера в каталоге, одобренный `ago` назад, с подписью автора. */
async function riderRoute(author: Rider, ago = DAY, overrides: Record<string, unknown> = {}) {
  const at = new Date(h.clock.now().getTime() - ago);
  const id = await seedApprovedRiderRoute(
    h,
    author.userId,
    { showAuthorName: true, approvedAt: at, ...overrides },
    'Вокруг моря',
  );
  await routesDb(h).routes.updateOne({ _id: id }, { $set: { 'catalog.publishedAt': at } });
  return id;
}

interface World {
  viewer: PublicRider;
  anna: PublicRider;
  boris: PublicRider;
}

/** Зритель и «свои»: Анна — взаимная, Борис — только зритель → Борис (ручное «В свои»). */
async function world(): Promise<World> {
  const viewer = await publicRider(h, 'viewer@example.by', 'Зритель');
  const anna = await publicRider(h, 'anna@example.by', 'Анна К.');
  const boris = await publicRider(h, 'boris@example.by', 'Борис Л.');
  await mutual(viewer, anna);
  await connect(viewer, boris);
  return { viewer, anna, boris };
}

describe('строки ride / result / route (AC1)', () => {
  it('райд «своего» через 3 дня, протокол вчера, маршрут вчера — три строки, без userId', async () => {
    const { viewer, anna, boris } = await world();
    const ride = await createRide(h, anna, { limit: null, startsAt: startsIn(h, 3 * DAY) });
    const raceId = await protocolRace([placedRow(boris.userId, 1)]);
    const routeId = await riderRoute(anna);

    const res = await home(viewer);
    const body = bodyOf(res);
    expect(body.items).toMatchObject([
      {
        kind: 'ride',
        ride: { id: ride.id, viewer: { role: 'none', canJoin: true } },
        riders: [{ name: 'Анна К.', publicId: anna.publicId }],
        othersCount: 0,
      },
      {
        kind: 'result',
        rider: { name: 'Борис Л.', publicId: boris.publicId },
        race: { id: raceId, title: 'Гран-при' },
        place: 1,
        elapsedSec: 3600,
        deltaSec: null,
      },
      {
        kind: 'route',
        rider: { name: 'Анна К.' },
        route: { id: routeId, author: { kind: 'rider', name: 'Анна К.' } },
      },
    ]);
    const text = JSON.stringify(res.body);
    for (const who of [viewer, anna, boris]) expect(text).not.toContain(who.userId);
    expect(text).not.toContain('userId');
  });

  it('уже иду — строка остаётся с состоянием «Вы идёте»; «свои» в порядке участников, остальные числом', async () => {
    const { viewer, anna } = await world();
    const extra = [];
    for (const [email, name] of [
      ['c', 'Карина'],
      ['d', 'Денис'],
      ['e', 'Ева'],
    ] as const) {
      const who = await publicRider(h, `${email}@example.by`, name);
      await mutual(viewer, who);
      extra.push(who);
    }
    const ride = await createRide(h, anna, { limit: null, startsAt: startsIn(h, 2 * DAY) });
    for (const who of [...extra, viewer]) expect((await join(h, who, ride.id)).status).toBe(200);
    const [row] = bodyOf(await home(viewer)).items;
    expect(row).toMatchObject({
      kind: 'ride',
      ride: { viewer: { role: 'participant' } },
      riders: [{ name: 'Анна К.' }, { name: 'Карина' }, { name: 'Денис' }],
      othersCount: 1,
    });
  });

  it('нет строк: непубличный, убранная, чужая и односторонняя для райда связь; райды и протоколы вне правил', async () => {
    const viewer = await publicRider(h, 'viewer@example.by', 'Зритель');
    const anna = await publicRider(h, 'anna@example.by', 'Анна К.');
    const quiet = await rider(h, 'quiet@example.by');
    const removed = await publicRider(h, 'removed@example.by', 'Убранный');
    const oneWay = await publicRider(h, 'oneway@example.by', 'Односторонний');
    const stranger = await publicRider(h, 'stranger@example.by', 'Чужой');
    const other = await rider(h, 'other@example.by');
    await mutual(viewer, anna);
    await mutual(viewer, quiet);
    await connect(viewer, removed, { removed: true });
    await connect(removed, viewer);
    await connect(viewer, oneWay);
    // чужая связь: «свой» другого, не зрителя
    await mutual(other, stranger);

    // райды: непубличного, убранного, чужого, одностороннего; «своего» — отменённый, скрытый, через 7 дн + 1 мин,
    // начавшийся
    for (const who of [quiet, removed, stranger, oneWay]) {
      await createRide(h, who, { limit: null, startsAt: startsIn(h, DAY) });
    }
    const cancelled = await createRide(h, anna, { limit: null, startsAt: startsIn(h, DAY) });
    await ridesDb(h).updateOne({ _id: cancelled.id }, { $set: { status: 'cancelled' } });
    const hidden = await createRide(h, anna, { limit: null, startsAt: startsIn(h, 2 * DAY) });
    await hideInDb(h, hidden.id);
    const late = await createRide(h, anna, { limit: null, startsAt: startsIn(h, 3 * DAY) });
    await ridesDb(h).updateOne(
      { _id: late.id },
      { $set: { startsAt: new Date(h.clock.now().getTime() + 7 * DAY + MINUTE) } },
    );
    const started = await createRide(h, anna, { limit: null, startsAt: startsIn(h, 4 * DAY) });
    await ridesDb(h).updateOne(
      { _id: started.id },
      { $set: { startsAt: new Date(h.clock.now().getTime() - MINUTE) } },
    );

    // результаты: непубличного и чужого; «своего» — предварительная таблица, протокол 7 дн + 1 мин, DQ новой
    // ревизии, без места
    await protocolRace([placedRow(quiet.userId, 1), placedRow(stranger.userId, 2)]);
    const provisional = await seedProtocolRace(
      h,
      await seedSeason(h),
      [placedRow(anna.userId, 1)],
      {
        corridor: CORRIDOR,
        protocol: false,
      },
    );
    expect(provisional).toBeTruthy();
    await protocolRace([placedRow(anna.userId, 1)], 7 * DAY + MINUTE);
    const dq = await protocolRace([placedRow(anna.userId, 1)]);
    await addRevision(h, dq, 2, [dqRow(anna.userId)]);
    await protocolRace([{ userId: anna.userId, place: null, groupKey: 'm_u40' }]);

    // маршруты: команды, без подписи автора, снятый с каталога, опубликован 8 дн назад, непубличного автора
    const team = await riderRoute(anna);
    await routesDb(h).routes.updateOne({ _id: team }, { $set: { origin: 'platform' } });
    await riderRoute(anna, DAY, { showAuthorName: false });
    const unlisted = await riderRoute(anna);
    await routesDb(h).routes.updateOne(
      { _id: unlisted },
      { $set: { 'publication.status': 'hidden' } },
    );
    await riderRoute(anna, 8 * DAY);
    await riderRoute(quiet);

    expect(bodyOf(await home(viewer))).toEqual({ items: [] });
  });

  it('больше трёх кандидатов — ровно три по кругу видов: два райда и результат', async () => {
    const { viewer, anna, boris } = await world();
    const first = await createRide(h, anna, { limit: null, startsAt: startsIn(h, DAY) });
    const second = await createRide(h, anna, { limit: null, startsAt: startsIn(h, 2 * DAY) });
    await createRide(h, anna, { limit: null, startsAt: startsIn(h, 3 * DAY) });
    const raceId = await protocolRace([placedRow(boris.userId, 1)]);
    const body = bodyOf(await home(viewer));
    expect(kinds(body)).toEqual(['ride', 'ride', 'result']);
    expect(body.items).toMatchObject([
      { ride: { id: first.id } },
      { ride: { id: second.id } },
      { race: { id: raceId } },
    ]);
  });

  it('нет «своих» — пустой ответ; гость — 401; лимит — 429', async () => {
    const lonely = await publicRider(h, 'lonely@example.by', 'Один');
    expect(bodyOf(await home(lonely))).toEqual({ items: [] });
    expect((await call(h, 'GET', HOME)).status).toBe(401);
    for (let n = 1; n < SOCIAL_POLICY.homeLimit.limit; n += 1) {
      expect((await home(lonely)).status).toBe(200);
    }
    expect((await home(lonely)).status).toBe(429);
  });
});

describe('разница «быстрее/медленнее вас» (AC2)', () => {
  it('та же гонка и группа — со знаком; другая группа и DQ зрителя — null', async () => {
    const { viewer, anna, boris } = await world();
    const carl = await publicRider(h, 'carl@example.by', 'Карл');
    await connect(viewer, carl);
    // время строки = 3600 + порядок в ревизии
    await protocolRace([
      placedRow(anna.userId, 1),
      placedRow(viewer.userId, 2),
      placedRow(boris.userId, 1, 'w_u40'),
    ]);
    const dqRace = await protocolRace([placedRow(viewer.userId, 1)], 2 * DAY, 'DQ зрителя');
    await addRevision(h, dqRace, 2, [dqRow(viewer.userId), placedRow(carl.userId, 1)]);
    const results = Object.fromEntries(
      bodyOf(await home(viewer))
        .items.flatMap((row) => (row.kind === 'result' ? [row] : []))
        .map((row) => [`${row.race.title}:${row.rider.name}`, row.deltaSec]),
    );
    expect(results).toEqual({
      'Гран-при:Анна К.': -1,
      'Гран-при:Борис Л.': null,
      'DQ зрителя:Карл': null,
    });
  });
});

describe('индексы запросов портов (RC-P7-16)', () => {
  const stagesOf = (plan: Document): string[] => {
    const stages: string[] = [];
    const walk = (node: Document | undefined) => {
      if (!node) return;
      stages.push(`${node.stage}${node.indexName ? `:${node.indexName}` : ''}`);
      walk(node.inputStage);
      for (const child of node.inputStages ?? []) walk(child);
    };
    walk(plan.queryPlanner.winningPlan.queryPlan ?? plan.queryPlanner.winningPlan);
    return stages;
  };

  it('райды, протоколы, строки и маршруты — IXSCAN своих индексов, без COLLSCAN', async () => {
    const now = h.clock.now();
    const until = new Date(now.getTime() + 7 * DAY);
    const since = new Date(now.getTime() - 7 * DAY);
    const ids = [uuidv7(), uuidv7()];
    const plans = {
      rides: await ridesDb(h)
        .find({
          'participants.userId': { $in: ids },
          status: 'published',
          startsAt: { $gt: now, $lte: until },
        })
        .sort({ startsAt: 1, _id: 1 })
        .hint('rides_participant_idx')
        .explain('queryPlanner'),
      races: await racesDb(h)
        .races.find({ status: 'published', protocolPublishedAt: { $gte: since } })
        .sort({ protocolPublishedAt: -1, _id: -1 })
        .hint('races_protocol_published_idx')
        .explain('queryPlanner'),
      rows: await resultsDb(h)
        .protocolRows.find({ userId: { $in: ids }, raceId: { $in: ids } })
        .explain('queryPlanner'),
    };
    const expected = {
      rides: 'rides_participant_idx',
      races: 'races_protocol_published_idx',
      rows: 'race_protocol_rows_user_idx',
    };
    for (const [name, plan] of Object.entries(plans)) {
      const stages = stagesOf(plan);
      expect(stages.join(' ')).toContain(`IXSCAN:${expected[name as keyof typeof expected]}`);
      expect(stages.join(' ')).not.toContain('COLLSCAN');
    }
    // маршруты — тем же запросом, что `recentRiderCatalog` (план фиксирован `hint`)
    const routes = await routesDb(h)
      .routes.find({
        'catalog.publishedAt': { $type: 'date', $gte: since },
        ownerUserId: { $in: ids },
      })
      .sort({ 'catalog.publishedAt': -1, _id: -1 })
      .hint('routes_catalog_idx')
      .explain('queryPlanner');
    expect(stagesOf(routes).join(' ')).toContain('IXSCAN:routes_catalog_idx');
  });
});
