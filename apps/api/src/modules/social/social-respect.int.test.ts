import { RespectState } from '@pokatim/contracts';
import { uuidv7 } from '@rkarakulov/api-kit/mongo';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { createHarness, type Harness } from '../../../test/harness';
import { call, type CallResult } from '../../../test/identity';
import { patchProfile } from '../../../test/profiles';
import { racesDb } from '../../../test/races';
import { protocolAction, protocolRace, resultsDb, seedBest, signIn } from '../../../test/results';
import { publicationDoc, seedApprovedRiderRoute, seedRiderRoute } from '../../../test/routes';
import { seedTeamRoute } from '../../../test/rides';
import { socialDb } from '../../../test/social';

/**
 * «Респект» по HTTP (P4, AC4–AC6): строка публичной таблицы гонки (до и после публикации) и маршрут райдера в каталоге;
 * идемпотентный `PUT`, `GET` без цели — нейтральный (RC-P4-3), `PUT` — 404; своя цель — 409 `self`; `count` — всем,
 * `from` — только получателю; лимит `social-respect`; публичные кэшируемые ответы не меняются.
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

const NEUTRAL = { available: false, respected: false, count: 0, own: false, from: null };
const entryUrl = (raceId: string, entryId: string) =>
  `/v1/races/${raceId}/results/${entryId}/respect`;
const routeUrl = (routeId: string) => `/v1/routes/${routeId}/respect`;
type Auth = Record<string, string>;
const get = (auth: Auth, url: string) => call(h, 'GET', url, undefined, auth);
const put = (auth: Auth, url: string, body: unknown) => call(h, 'PUT', url, body, auth);

function stateOf(res: CallResult): RespectState {
  expect(res.status).toBe(200);
  expect(res.headers['cache-control']).toBe('no-store');
  expect(JSON.stringify(res.body)).not.toContain('userId');
  return RespectState.strict().parse(res.body);
}

/** Гонка «3600, 3700, без результата» и зрители; access — после сдвига часов. */
async function race(times: readonly (number | null)[] = [3600, 3700, null]) {
  const base = await protocolRace(h, times);
  const riders = [];
  for (const r of base.riders) riders.push({ ...r, auth: await signIn(h, r.email) });
  return { ...base, riders };
}

/** Публичное имя райдера гонки (по access). */
const makePublic = (who: { userId: string; auth: Auth }, name: string) =>
  patchProfile(
    h,
    { userId: who.userId, token: who.auth.authorization!.replace('Bearer ', '') },
    { publicName: name, showNameInResults: true },
  );

describe('строка результата до публикации (AC4)', () => {
  it('поставить, повтор не переключает, снять; `count` — всем; `from` — только получателю, непубличные — числом', async () => {
    const { raceId, riders } = await race();
    const [owner, a, b] = riders as [(typeof riders)[0], (typeof riders)[0], (typeof riders)[0]];
    await makePublic(a, 'Анна К.');
    const url = entryUrl(raceId, owner.entryId);

    expect(stateOf(await get(a.auth, url))).toEqual({ ...NEUTRAL, available: true });
    expect(stateOf(await put(a.auth, url, { respected: true }))).toEqual({
      available: true,
      respected: true,
      count: 1,
      own: false,
      from: null,
    });
    expect(stateOf(await put(a.auth, url, { respected: true }))).toMatchObject({
      respected: true,
      count: 1,
    });
    expect(stateOf(await put(b.auth, url, { respected: true })).count).toBe(2);
    expect(stateOf(await get(b.auth, url))).toMatchObject({ respected: true, from: null });

    const own = stateOf(await get(owner.auth, url));
    expect(own).toEqual({
      available: false,
      respected: false,
      count: 2,
      own: true,
      from: {
        riders: [{ name: 'Анна К.', publicId: expect.any(String), avatar: null }],
        hiddenCount: 1,
      },
    });

    expect(stateOf(await put(a.auth, url, { respected: false }))).toMatchObject({
      respected: false,
      count: 1,
    });
    expect(stateOf(await put(a.auth, url, { respected: false })).count).toBe(1);
    expect(await socialDb(h).events.countDocuments({ type: 'respect-sent' })).toBe(2);
  });

  it('своя строка — PUT 409 self; GET — own', async () => {
    const { raceId, riders } = await race();
    const owner = riders[0]!;
    const url = entryUrl(raceId, owner.entryId);
    const res = await put(owner.auth, url, { respected: true });
    expect(res.status).toBe(409);
    expect(res.body).toMatchObject({ code: 'SOCIAL_ACTION_BLOCKED', details: { reason: 'self' } });
    expect(stateOf(await get(owner.auth, url))).toMatchObject({ own: true, available: false });
  });

  it('без результата, финишёр, снятая, DQ, чужая гонка в пути, черновик — GET нейтральный, PUT 404', async () => {
    const { raceId, riders } = await race([3600, null, 3700, 3800, 3900]);
    const [first, none, finisher, withdrawn, dq] = riders;
    const viewer = first!.auth;
    await seedBest(h, finisher!.entryId, 3700, new Date('2026-10-25T02:00:00Z'), { ranked: false });
    await resultsDb(h).entries.updateOne(
      { _id: withdrawn!.entryId },
      { $set: { status: 'withdrawn' } },
    );
    await resultsDb(h).entries.updateOne(
      { _id: dq!.entryId },
      { $set: { disqualified: { at: h.clock.now(), disputeId: uuidv7() } } },
    );
    const urls = [
      ...[none, finisher, withdrawn, dq].map((r) => entryUrl(raceId, r!.entryId)),
      entryUrl(uuidv7(), first!.entryId),
      entryUrl(raceId, uuidv7()),
    ];
    for (const url of urls) {
      expect(stateOf(await get(viewer, url))).toEqual(NEUTRAL);
      const res = await put(viewer, url, { respected: true });
      expect(res.status).toBe(404);
      expect(res.headers['cache-control']).toBe('no-store');
    }
    await racesDb(h).races.updateOne({ _id: raceId }, { $set: { status: 'draft' } });
    const own = entryUrl(raceId, riders[0]!.entryId);
    expect(stateOf(await get(riders[1]!.auth, own))).toEqual(NEUTRAL);
    expect((await put(riders[1]!.auth, own, { respected: true })).status).toBe(404);
    expect(await socialDb(h).reactions.countDocuments()).toBe(0);
  });
});

describe('строка результата после публикации (AC4)', () => {
  it('строка ревизии — ставится; DQ — нейтральный, запись остаётся; отмена DQ — счётчик снова виден', async () => {
    const { raceId, riders, token } = await race([3600, 3700]);
    const [owner, viewer] = riders as [(typeof riders)[0], (typeof riders)[0]];
    expect((await protocolAction(h, token, raceId, '/protocol')).status).toBe(200);
    const url = entryUrl(raceId, owner.entryId);
    expect(stateOf(await put(viewer.auth, url, { respected: true }))).toMatchObject({ count: 1 });

    await protocolAction(h, token, raceId, '/protocol/disqualify', {
      entryId: owner.entryId,
      reason: 'Срезка маршрута',
    });
    expect(stateOf(await get(viewer.auth, url))).toEqual(NEUTRAL);
    expect(stateOf(await get(owner.auth, url))).toEqual(NEUTRAL);
    expect((await put(viewer.auth, url, { respected: false })).status).toBe(404);
    expect(await socialDb(h).reactions.countDocuments()).toBe(1);

    await protocolAction(h, token, raceId, '/protocol/revoke-disqualification', {
      entryId: owner.entryId,
      reason: 'Апелляция',
    });
    expect(stateOf(await get(viewer.auth, url))).toMatchObject({ respected: true, count: 1 });
  });
});

describe('маршрут (AC5)', () => {
  it('райдерский в каталоге — да; свой — 409; команды, скрытый, на модерации — GET нейтральный, PUT 404', async () => {
    const { riders } = await race([3600, 3700]);
    const [author, viewer] = riders as [(typeof riders)[0], (typeof riders)[0]];
    const approved = await seedApprovedRiderRoute(h, author.userId);
    expect(stateOf(await put(viewer.auth, routeUrl(approved), { respected: true }))).toEqual({
      available: true,
      respected: true,
      count: 1,
      own: false,
      from: null,
    });
    expect(stateOf(await get(author.auth, routeUrl(approved)))).toEqual({
      available: false,
      respected: false,
      count: 1,
      own: true,
      from: { riders: [], hiddenCount: 1 },
    });
    expect((await put(author.auth, routeUrl(approved), { respected: true })).status).toBe(409);

    const team = await seedTeamRoute(h);
    const hidden = await seedRiderRoute(h, author.userId, {
      publication: publicationDoc(h, 'hidden'),
    });
    const pending = await seedRiderRoute(h, author.userId, {
      publication: publicationDoc(h, 'pending'),
    });
    for (const id of [team, hidden, pending, uuidv7()]) {
      expect(stateOf(await get(viewer.auth, routeUrl(id)))).toEqual(NEUTRAL);
      expect((await put(viewer.auth, routeUrl(id), { respected: true })).status).toBe(404);
    }
  });
});

describe('доступ, тело, лимит, публичные ответы (AC6)', () => {
  it('гость — 401; лишнее поле и без `respected` — 400; невалидный id — 400', async () => {
    const { raceId, riders } = await race([3600, 3700]);
    const url = entryUrl(raceId, riders[0]!.entryId);
    expect((await call(h, 'GET', url)).status).toBe(401);
    expect((await call(h, 'PUT', routeUrl(uuidv7()), { respected: true })).status).toBe(401);
    const viewer = riders[1]!.auth;
    expect((await put(viewer, url, { respected: true, recipient: 'x' })).status).toBe(400);
    expect((await put(viewer, url, {})).status).toBe(400);
    expect((await get(viewer, entryUrl('not-a-uuid', riders[0]!.entryId))).status).toBe(400);
    expect((await get(viewer, routeUrl('not-a-uuid'))).status).toBe(400);
  });

  it('лимит общий для строки и маршрута: 60 PUT проходят, 61-й — 429 первой проверкой; GET без лимита', async () => {
    const { raceId, riders } = await race([3600]);
    const viewer = riders[0]!.auth;
    for (let index = 0; index < 60; index += 1) {
      const url = index % 2 === 0 ? entryUrl(raceId, uuidv7()) : routeUrl(uuidv7());
      expect((await put(viewer, url, { respected: true })).status).toBe(404);
    }
    const limited = await put(viewer, routeUrl(uuidv7()), { respected: true });
    expect(limited.status).toBe(429);
    expect(limited.body).toMatchObject({ code: 'RATE_LIMITED' });
    expect((await get(viewer, routeUrl(uuidv7()))).status).toBe(200);
  });

  it('публичные GET races/:raceId/results и routes/:id не меняются от респектов', async () => {
    const { raceId, riders } = await race([3600, 3700]);
    const [owner, viewer] = riders as [(typeof riders)[0], (typeof riders)[0]];
    const routeId = await seedApprovedRiderRoute(h, owner.userId);
    const publicReads = async () => {
      const results = await call(h, 'GET', `/v1/races/${raceId}/results`);
      const route = await call(h, 'GET', `/v1/routes/${routeId}`);
      for (const res of [results, route]) {
        expect(res.status).toBe(200);
        expect(res.headers['cache-control']).toBe('public, max-age=60');
      }
      return [JSON.stringify(results.body), JSON.stringify(route.body)];
    };
    const before = await publicReads();
    expect(
      (await put(viewer.auth, entryUrl(raceId, owner.entryId), { respected: true })).status,
    ).toBe(200);
    expect((await put(viewer.auth, routeUrl(routeId), { respected: true })).status).toBe(200);
    const after = await publicReads();
    expect(after).toEqual(before);
    for (const text of after) {
      expect(text).not.toContain('respect');
      expect(text).not.toContain(owner.userId);
    }
  });
});
