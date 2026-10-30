import { Logger } from '@nestjs/common';
import {
  AchievementList,
  minskToday,
  PublicRiderAchievementList,
  type SeasonalAchievementCode,
} from '@pokatim/contracts';
import { uuidv7 } from '@rkarakulov/api-kit/mongo';
import { RateLimiter } from '@rkarakulov/api-kit/core';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  ACHIEVEMENTS,
  achievementsDb,
  daysAgo,
  pastRide,
  raceAt,
  racesAt,
  seedRouteRide,
} from '../../../test/achievements';
import { createHarness, type Harness } from '../../../test/harness';
import { bearer, call } from '../../../test/identity';
import { catalogCorridorRoute, ownCorridorRoute } from '../../../test/route-rides';
import { authed, hideInDb, rider, type Rider, ridesDb } from '../../../test/rides';
import { routesDb } from '../../../test/routes';
import {
  addRevision,
  dqRow,
  placedRow,
  seedProtocolRace,
  seedSeason,
  syncStandings,
} from '../../../test/standings';
import { tracks } from '../../../test/tracks';
import { RIDER_SEASON_STANDINGS, type RiderSeasonStandings } from '../standings';
import { ACHIEVEMENTS_POLICY } from './achievements.policy';
import { AchievementsRepository } from './achievements.repository';

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

const repository = () => h.app.get(AchievementsRepository, { strict: false });

async function fullList(who: Rider) {
  const res = await authed(h, who, 'GET', ACHIEVEMENTS);
  if (res.status !== 200) throw new Error(`достижения: ${res.status} ${JSON.stringify(res.body)}`);
  expect(res.headers['cache-control']).toBe('no-store');
  return AchievementList.parse(res.body);
}
const list = async (who: Rider) => (await fullList(who)).items;
const codesOf = (items: { code: string }[]) => items.map((item) => item.code);
const seenOf = (items: { code: string; seen: boolean }[]) =>
  Object.fromEntries(items.map((item) => [item.code, item.seen]));
const seen = (who: Rider, codes: unknown) =>
  authed(h, who, 'POST', `${ACHIEVEMENTS}/seen`, { codes });

/** Публичный профиль через API: имя и согласие; `publicId` из ответа. */
async function publicIdOf(who: Rider): Promise<string> {
  const res = await call(
    h,
    'PATCH',
    '/v1/profile',
    { publicName: 'Анна К.', showNameInResults: true },
    bearer(who.token),
  );
  const publicId = (res.body as { publicId: string | null }).publicId;
  if (!publicId) throw new Error(`нет publicId: ${JSON.stringify(res.body)}`);
  return publicId;
}

/** Ворота: первые `n` вызовов ждут, пока не придут все `n` (параллельные GET читают состояние до записей). */
function barrier(n: number) {
  let arrived = 0;
  let open: () => void = () => undefined;
  const opened = new Promise<void>((resolve) => {
    open = resolve;
  });
  return async () => {
    arrived += 1;
    if (arrived === n) open();
    if (arrived <= n) await opened;
  };
}

describe('GET /v1/achievements — первая и последующая сверка (AC2)', () => {
  it('первая сверка с фактами — всё сразу просмотрено (тихо, A3); новый факт после — seen: false; ответ — точные ключи', async () => {
    const me = await rider(h, 'me@example.com');
    const other = await rider(h, 'other@example.com');
    const season = await seedSeason(h);
    const race = await raceAt(h, season, [placedRow(me.userId, 2)], daysAgo(h, 10), 'Весенняя');
    await pastRide(h, other, [me], 5, 'Утренний');

    const first = await list(me);
    expect(first).toEqual([
      {
        code: 'ride_first',
        object: { kind: 'ride', id: expect.any(String), title: 'Утренний' },
        factDate: minskToday(daysAgo(h, 5)),
        level: null,
        seen: true,
      },
      {
        code: 'race_podium',
        object: { kind: 'race', id: race, title: 'Весенняя' },
        factDate: minskToday(daysAgo(h, 10)),
        level: null,
        seen: true,
      },
      {
        code: 'race_first_finish',
        object: { kind: 'race', id: race, title: 'Весенняя' },
        factDate: minskToday(daysAgo(h, 10)),
        level: null,
        seen: true,
      },
    ]);
    expect(await achievementsDb(h).syncs.countDocuments({ _id: me.userId })).toBe(1);

    const res = await authed(h, me, 'GET', ACHIEVEMENTS);
    expect(Object.keys(res.body as object)).toEqual(['items', 'progress']);
    const item = (res.body as { items: Record<string, unknown>[] }).items[0]!;
    expect(Object.keys(item).sort()).toEqual(['code', 'factDate', 'level', 'object', 'seen']);
    expect(Object.keys(item.object as object).sort()).toEqual(['id', 'kind', 'title']);
    expect(JSON.stringify(res.body)).not.toContain(me.userId);

    const win = await raceAt(h, season, [placedRow(me.userId, 1)], daysAgo(h, 1), 'Осенняя');
    const after = await list(me);
    expect(after[0]).toEqual({
      code: 'race_win',
      object: { kind: 'race', id: win, title: 'Осенняя' },
      factDate: minskToday(daysAgo(h, 1)),
      level: null,
      seen: false,
    });
    expect(seenOf(after)).toEqual({
      race_win: false,
      ride_first: true,
      race_podium: true,
      race_first_finish: true,
    });
  });

  it('райдер без фактов — пусто, маркер ставится; первый факт потом — seen: false (вспышка)', async () => {
    const me = await rider(h, 'me@example.com');
    expect(await list(me)).toEqual([]);
    expect(await achievementsDb(h).syncs.countDocuments({ _id: me.userId })).toBe(1);
    expect(await achievementsDb(h).grants.countDocuments({})).toBe(0);

    const season = await seedSeason(h);
    await raceAt(h, season, [placedRow(me.userId, 7)], daysAgo(h, 1));
    expect(seenOf(await list(me))).toEqual({ race_first_finish: false });
  });

  it('устойчивое состояние — повторный GET без записей; лог сверки — без названий и id объектов', async () => {
    const me = await rider(h, 'me@example.com');
    const season = await seedSeason(h);
    const race = await raceAt(h, season, [placedRow(me.userId, 1)], daysAgo(h, 3), 'Секретная');
    const logs = vi.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
    await list(me);
    const before = await achievementsDb(h).grants.find().toArray();
    await list(me);
    expect(await achievementsDb(h).grants.find().toArray()).toEqual(before);

    const lines = logs.mock.calls.map((args) => args.map(String).join(' '));
    const sync = lines.filter((line) => line.includes('achievements.sync'));
    expect(sync).toEqual([
      expect.stringContaining(
        `achievements.sync uid=${me.userId} first=true granted=3 revoked=0 restored=0`,
      ),
    ]);
    for (const line of lines) expect(line).not.toMatch(new RegExp(`Секретная|${race}`));
  });
});

describe('отзыв и возврат (AC3, A4)', () => {
  it('DQ новой ревизией — достижения нет; строка вернулась — снова есть, seen прежний (повторно не вспыхивает)', async () => {
    const me = await rider(h, 'me@example.com');
    await list(me);
    const season = await seedSeason(h);
    const race = await raceAt(h, season, [placedRow(me.userId, 1)], daysAgo(h, 2));
    expect(seenOf(await list(me))).toMatchObject({ race_win: false });
    expect((await seen(me, ['race_win'])).status).toBe(204);

    await addRevision(h, race, 2, [dqRow(me.userId)]);
    expect(await list(me)).toEqual([]);
    expect(await achievementsDb(h).grants.countDocuments({ revokedAt: { $ne: null } })).toBe(3);

    await addRevision(h, race, 3, [placedRow(me.userId, 1)]);
    expect(seenOf(await list(me))).toEqual({
      race_win: true,
      race_podium: false,
      race_first_finish: false,
    });
    expect(await achievementsDb(h).grants.countDocuments({ userId: me.userId })).toBe(3);
  });

  it('«Подиум» переходит на другую гонку после DQ (объект и дата пересчитаны)', async () => {
    const me = await rider(h, 'me@example.com');
    const season = await seedSeason(h);
    const early = await raceAt(h, season, [placedRow(me.userId, 3)], daysAgo(h, 20), 'Ранняя');
    const late = await raceAt(h, season, [placedRow(me.userId, 2)], daysAgo(h, 5), 'Поздняя');
    const podium = async () => (await list(me)).find((item) => item.code === 'race_podium');
    expect((await podium())?.object).toEqual({ kind: 'race', id: early, title: 'Ранняя' });

    await addRevision(h, early, 2, [dqRow(me.userId)]);
    expect(await podium()).toEqual({
      code: 'race_podium',
      object: { kind: 'race', id: late, title: 'Поздняя' },
      factDate: minskToday(daysAgo(h, 5)),
      level: null,
      seen: true,
    });
  });

  it('заезд по маршруту: удалена активность — нет; маршрут снят с каталога — нет (RC-4); свой удалённый — нет', async () => {
    const me = await rider(h, 'me@example.com');
    const catalog = await catalogCorridorRoute(h, me.userId);
    const activity = await seedRouteRide(h, me.userId, catalog, daysAgo(h, 4));
    // не пройден — не факт
    await seedRouteRide(h, me.userId, await catalogCorridorRoute(h, me.userId), daysAgo(h, 6), {
      status: 'not_passed',
    });
    expect(await list(me)).toEqual([
      {
        code: 'route_first',
        object: { kind: 'route', id: catalog, title: 'Эталонный коридор' },
        factDate: minskToday(daysAgo(h, 4)),
        level: null,
        seen: true,
      },
    ]);

    await tracks(h).activities.deleteOne({ _id: activity });
    expect(await list(me)).toEqual([]);
    await seedRouteRide(h, me.userId, catalog, daysAgo(h, 3));
    expect(codesOf(await list(me))).toEqual(['route_first']);

    await routesDb(h).routes.updateOne({ _id: catalog }, { $set: { catalog: null } });
    expect(await list(me)).toEqual([]);

    const own = await ownCorridorRoute(h, me.userId);
    await seedRouteRide(h, me.userId, own, daysAgo(h, 2));
    expect((await list(me))[0]?.object).toEqual({
      kind: 'route',
      id: own,
      title: 'Мой коридор',
    });
    await routesDb(h).routes.deleteOne({ _id: own });
    expect(await list(me)).toEqual([]);
  });

  it('кофе-райд скрыт модератором или отменён — достижения нет', async () => {
    const me = await rider(h, 'me@example.com');
    const other = await rider(h, 'other@example.com');
    const ride = await pastRide(h, other, [me], 3);
    expect(codesOf(await list(me))).toEqual(['ride_first']);

    const restore = await hideInDb(h, ride);
    expect(await list(me)).toEqual([]);
    await restore();
    expect(codesOf(await list(me))).toEqual(['ride_first']);

    await ridesDb(h).updateOne({ _id: ride }, { $set: { status: 'cancelled' } });
    expect(await list(me)).toEqual([]);
  });
});

describe('устаревший план параллельной сверки (ревью PR A, LOW-1)', () => {
  it('refresh после свежего отзыва не снимает отзыв; restore — только отозванную', async () => {
    const userId = '01a1b2c3-0000-7000-8000-000000000001';
    const t = new Date('2026-10-01T10:00:00Z');
    const earned = {
      object: { kind: 'race' as const, id: userId },
      factAt: t,
      title: null,
      level: null,
    };
    await repository().insertGrant(userId, 'race_podium', earned, null, t);
    expect(await repository().revoke(userId, 'race_podium', t)).toBe(true);

    expect(await repository().restoreOrRefresh(userId, 'race_podium', earned, false, t)).toBe(
      false,
    );
    const revoked = await achievementsDb(h).grants.findOne({ userId, code: 'race_podium' });
    expect(revoked?.revokedAt).toEqual(t);

    expect(await repository().restoreOrRefresh(userId, 'race_podium', earned, true, t)).toBe(true);
    expect(await repository().restoreOrRefresh(userId, 'race_podium', earned, true, t)).toBe(false);
    const restored = await achievementsDb(h).grants.findOne({ userId, code: 'race_podium' });
    expect(restored).toMatchObject({ revokedAt: null, seenAt: null });
  });
});

describe('POST /v1/achievements/seen (AC4)', () => {
  it('помечает только свои видимые; чужие, отозванные и незаработанные — без записи; повтор — 204', async () => {
    const me = await rider(h, 'me@example.com');
    const other = await rider(h, 'other@example.com');
    await list(me);
    await list(other);
    const season = await seedSeason(h);
    const race = await raceAt(h, season, [placedRow(me.userId, 1)], daysAgo(h, 2));
    await raceAt(h, season, [placedRow(other.userId, 4)], daysAgo(h, 2));
    await list(me);
    await list(other);

    // чужой код (у other есть race_first_finish) — помечается только свой
    expect((await seen(me, ['race_win', 'race_first_finish'])).status).toBe(204);
    expect(seenOf(await list(me))).toEqual({
      race_win: true,
      race_podium: false,
      race_first_finish: true,
    });
    expect(seenOf(await list(other))).toEqual({ race_first_finish: false });

    // отозванная — без записи; незаработанный код — без ошибки
    await addRevision(h, race, 2, [dqRow(me.userId)]);
    await list(me);
    const updated = async () =>
      (await achievementsDb(h).grants.find({ userId: me.userId }).sort({ code: 1 }).toArray()).map(
        (grant) => [grant.code, grant.seenAt, grant.updatedAt],
      );
    const before = await updated();
    expect((await seen(me, ['race_podium', 'rides_10'])).status).toBe(204);
    expect((await seen(me, ['race_win'])).status).toBe(204);
    expect(await updated()).toEqual(before);
    const podium = await achievementsDb(h).grants.findOne({
      userId: me.userId,
      code: 'race_podium',
    });
    expect(podium?.seenAt).toBeNull();
  });

  it('неверное тело — 400 VALIDATION_FAILED; без входа — 401', async () => {
    const me = await rider(h, 'me@example.com');
    for (const body of [
      { codes: [] },
      { codes: ['race_win', 'race_win'] },
      { codes: ['season_win'] },
      { codes: ['race_win'], extra: true },
      {},
    ]) {
      const res = await authed(h, me, 'POST', `${ACHIEVEMENTS}/seen`, body);
      expect([res.status, (res.body as { code: string }).code]).toEqual([400, 'VALIDATION_FAILED']);
    }
    expect((await call(h, 'POST', `${ACHIEVEMENTS}/seen`, { codes: ['race_win'] })).status).toBe(
      401,
    );
    expect((await call(h, 'GET', ACHIEVEMENTS)).status).toBe(401);
  });

  it('лимиты исчерпаны — 429 RATE_LIMITED (чтение и «показано»)', async () => {
    const me = await rider(h, 'me@example.com');
    const limiter = h.app.get(RateLimiter);
    const exhaust = async (key: string, rule: { limit: number; windowSec: number }) => {
      for (let i = 0; i < rule.limit; i += 1) await limiter.consume(key, rule, h.clock.now());
    };
    await exhaust(`achievements-read:${me.userId}`, ACHIEVEMENTS_POLICY.readLimit);
    await exhaust(`achievements-seen:${me.userId}`, ACHIEVEMENTS_POLICY.seenLimit);
    const read = await authed(h, me, 'GET', ACHIEVEMENTS);
    expect([read.status, (read.body as { code: string }).code]).toEqual([429, 'RATE_LIMITED']);
    const mark = await seen(me, ['race_win']);
    expect([mark.status, (mark.body as { code: string }).code]).toEqual([429, 'RATE_LIMITED']);
    expect(await achievementsDb(h).syncs.countDocuments({})).toBe(0);
  });
});

describe('параллельные GET одного райдера (AC5, RC-1, RC-2)', () => {
  const PARALLEL = 5;

  async function riderWithFacts() {
    const me = await rider(h, 'me@example.com');
    const season = await seedSeason(h);
    await raceAt(h, season, [placedRow(me.userId, 1)], daysAgo(h, 2));
    return { me, season };
  }
  /** Все параллельные GET читают состояние до записей (детерминированная гонка вставок). */
  const readTogether = () => {
    const wait = barrier(PARALLEL);
    const original = AchievementsRepository.prototype.syncedAt;
    vi.spyOn(repository(), 'syncedAt').mockImplementation(async function (
      this: AchievementsRepository,
      userId: string,
    ) {
      const result = await original.call(this, userId);
      await wait();
      return result;
    });
  };
  const parallel = (me: Rider) =>
    Promise.all(Array.from({ length: PARALLEL }, () => authed(h, me, 'GET', ACHIEVEMENTS)));

  it('первая и последующая сверка ×5 — без 500 и дублей, seen согласован', async () => {
    const { me, season } = await riderWithFacts();
    readTogether();
    const first = await parallel(me);
    expect(first.map((res) => res.status)).toEqual(Array(PARALLEL).fill(200));
    for (const res of first) {
      expect(seenOf(AchievementList.parse(res.body).items)).toEqual({
        race_win: true,
        race_podium: true,
        race_first_finish: true,
      });
    }
    expect(await achievementsDb(h).grants.countDocuments({ userId: me.userId })).toBe(3);
    expect(await achievementsDb(h).syncs.countDocuments({ _id: me.userId })).toBe(1);

    vi.restoreAllMocks();
    await raceAt(h, season, [placedRow(me.userId, 9)], daysAgo(h, 1));
    for (const another of [3, 4, 5]) {
      await raceAt(h, season, [placedRow(me.userId, another)], daysAgo(h, 10 + another));
    }
    readTogether();
    const next = await parallel(me);
    expect(next.map((res) => res.status)).toEqual(Array(PARALLEL).fill(200));
    for (const res of next) {
      expect(seenOf(AchievementList.parse(res.body).items)).toMatchObject({ races_5: false });
    }
    expect(await achievementsDb(h).grants.countDocuments({ userId: me.userId })).toBe(4);
  });

  it('отрицательное доказательство: дубль уникального индекса не перехвачен — параллельный GET падает 500', async () => {
    const { me } = await riderWithFacts();
    readTogether();
    vi.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    const grants = achievementsDb(h).grants;
    vi.spyOn(repository(), 'insertGrant').mockImplementation(
      async (userId, code, earned, seenAt, now) => {
        await grants.insertOne({
          _id: `${userId}:${code}:${Math.random()}`,
          userId,
          code,
          object: earned.object,
          factAt: earned.factAt,
          grantedAt: now,
          seenAt,
          revokedAt: null,
          updatedAt: now,
        });
        return true;
      },
    );
    const statuses = (await parallel(me)).map((res) => res.status);
    expect(statuses).toContain(500);
    expect(await achievementsDb(h).grants.countDocuments({ userId: me.userId })).toBe(3);
  });

  it('отрицательное доказательство RC-1: маркер до выдач — выдача первой сверки вспыхивает у параллельного GET', async () => {
    const run = async (markerFirst: boolean): Promise<Record<string, boolean>> => {
      await h.reset();
      const { me } = await riderWithFacts();
      const repo = repository();
      const original = AchievementsRepository.prototype.insertGrant;
      let paused = false;
      let release: () => void = () => undefined;
      const released = new Promise<void>((resolve) => {
        release = resolve;
      });
      let reachedPause: () => void = () => undefined;
      const atPause = new Promise<void>((resolve) => {
        reachedPause = resolve;
      });
      const spy = vi.spyOn(repo, 'insertGrant').mockImplementation(async function (
        this: AchievementsRepository,
        ...args: Parameters<AchievementsRepository['insertGrant']>
      ) {
        if (!paused) {
          paused = true;
          // нарушение порядка «выдачи → маркер» (симуляция): маркер ставится до вставки выдач
          if (markerFirst) await repo.markSynced(args[0], args[4]);
          reachedPause();
          await released;
        }
        return original.apply(this, args);
      });
      const a = authed(h, me, 'GET', ACHIEVEMENTS);
      await atPause;
      const b = await authed(h, me, 'GET', ACHIEVEMENTS);
      release();
      await a;
      spy.mockRestore();
      expect(b.status).toBe(200);
      return seenOf(await list(me));
    };
    // правильный порядок: второй GET видит «первую» сверку — тихо
    expect(Object.values(await run(false))).toEqual([true, true, true]);
    // маркер раньше выдач: второй GET считает сверку последующей — вспышка ретро-выдач (нарушение A3)
    expect(Object.values(await run(true))).toContain(false);
  });
});

describe('GET /v1/riders/:publicId/achievements (AC6)', () => {
  it('только гоночные; ключи — точный список, без seen/userId/времени; без записи; кэш 60 с', async () => {
    const me = await rider(h, 'me@example.com');
    const other = await rider(h, 'other@example.com');
    const publicId = await publicIdOf(me);
    const season = await seedSeason(h);
    const race = await raceAt(h, season, [placedRow(me.userId, 3)], daysAgo(h, 7), 'Кубок');
    await pastRide(h, other, [me], 2);
    await seedRouteRide(h, me.userId, await catalogCorridorRoute(h, me.userId), daysAgo(h, 1));

    const res = await call(h, 'GET', `/v1/riders/${publicId}/achievements`);
    expect(res.status).toBe(200);
    expect(res.headers['cache-control']).toBe('public, max-age=60');
    expect(PublicRiderAchievementList.parse(res.body)).toEqual({
      items: [
        {
          code: 'race_podium',
          object: { kind: 'race', id: race, title: 'Кубок' },
          factDate: minskToday(daysAgo(h, 7)),
          level: null,
        },
        {
          code: 'race_first_finish',
          object: { kind: 'race', id: race, title: 'Кубок' },
          factDate: minskToday(daysAgo(h, 7)),
          level: null,
        },
      ],
    });
    expect(Object.keys(res.body as object)).toEqual(['items']);
    for (const item of (res.body as { items: Record<string, unknown>[] }).items) {
      expect(Object.keys(item).sort()).toEqual(['code', 'factDate', 'level', 'object']);
    }
    expect(JSON.stringify(res.body)).not.toContain(me.userId);
    expect(await achievementsDb(h).grants.countDocuments({})).toBe(0);
    expect(await achievementsDb(h).syncs.countDocuments({})).toBe(0);
  });

  it('непубличный и неизвестный publicId — 404; мусор — 400; отзыв согласия — 404', async () => {
    const me = await rider(h, 'me@example.com');
    const publicId = await publicIdOf(me);
    expect((await call(h, 'GET', `/v1/riders/${publicId}/achievements`)).status).toBe(200);
    expect((await call(h, 'GET', `/v1/riders/${'z'.repeat(43)}/achievements`)).status).toBe(404);
    expect((await call(h, 'GET', '/v1/riders/not-a-token/achievements')).status).toBe(400);
    await call(h, 'PATCH', '/v1/profile', { showNameInResults: false }, bearer(me.token));
    expect((await call(h, 'GET', `/v1/riders/${publicId}/achievements`)).status).toBe(404);
  });
});

describe('уровни счётных (L1–L4, AC2–AC5)', () => {
  const races5 = async (who: Rider) => {
    const items = await list(who);
    const item = items.find((one) => one.code === 'races_5');
    return item ? { level: item.level, seen: item.seen, object: item.object.id } : null;
  };
  const grantOf = (userId: string) => achievementsDb(h).grants.findOne({ userId, code: 'races_5' });

  it('AC2: первая сверка на серебре — тихо; золото — вспышка; seen; DQ → серебро тихо; возврат → золото тихо', async () => {
    const me = await rider(h, 'me@example.com');
    const season = await seedSeason(h);
    const ids = await racesAt(h, season, me.userId, 15, 100);

    const first = await fullList(me);
    expect(first.items.find((item) => item.code === 'races_5')).toMatchObject({
      level: 'silver',
      seen: true,
      object: { id: ids[14] },
    });
    expect(first.progress).toEqual([{ code: 'races_5', level: 'gold', current: 15, target: 30 }]);

    const more = await racesAt(h, season, me.userId, 15, 50);
    expect(await races5(me)).toEqual({ level: 'gold', seen: false, object: more[14] });
    expect((await fullList(me)).progress).toEqual([]);

    expect((await seen(me, ['races_5'])).status).toBe(204);
    expect(await races5(me)).toEqual({ level: 'gold', seen: true, object: more[14] });
    expect(await grantOf(me.userId)).toMatchObject({ level: 3, seenLevel: 3 });

    // DQ первой гонки — 29 в зачёте: серебро, 15-я — первая из второй пачки; тихо (seenLevel 3 ≥ 2)
    await addRevision(h, ids[0]!, 2, [dqRow(me.userId)]);
    expect(await races5(me)).toEqual({ level: 'silver', seen: true, object: more[0] });
    expect(await grantOf(me.userId)).toMatchObject({ level: 2, seenLevel: 3 });

    // возврат строки (ревизия 3 — дата «сейчас»): снова золото, 30-я — вернувшаяся гонка; повторно не вспыхивает
    await addRevision(h, ids[0]!, 3, [placedRow(me.userId, 5)]);
    expect(await races5(me)).toEqual({ level: 'gold', seen: true, object: ids[0] });
    expect(
      await achievementsDb(h).grants.countDocuments({ userId: me.userId, code: 'races_5' }),
    ).toBe(1);
  });

  it('негатив RC-L10: устаревший план записал меньший уровень после seen на большем — следующая сверка тихо (seenLevel монотонен)', async () => {
    const me = await rider(h, 'me@example.com');
    const season = await seedSeason(h);
    await list(me);
    const ids = await racesAt(h, season, me.userId, 30, 100);
    expect(await races5(me)).toMatchObject({ level: 'gold', seen: false });
    expect((await seen(me, ['races_5'])).status).toBe(204);

    const silver = {
      object: { kind: 'race' as const, id: ids[14]! },
      factAt: daysAgo(h, 86),
      title: null,
      level: 2 as const,
    };
    const now = h.clock.now();
    expect(await repository().restoreOrRefresh(me.userId, 'races_5', silver, false, now)).toBe(
      true,
    );
    expect(await grantOf(me.userId)).toMatchObject({ level: 2, seenLevel: 3 });
    // повтор POST seen на документе «ниже показанного» — без записи
    expect(await repository().markSeen(me.userId, ['races_5'], [], now)).toBe(0);

    expect(await races5(me)).toEqual({ level: 'gold', seen: true, object: ids[29] });
    expect(await grantOf(me.userId)).toMatchObject({ level: 3, seenLevel: 3 });
  });

  it('AC3: документ v1 без level/seenLevel — бронза; seen по seenAt; без записей; повышение — одна вспышка (RC-L2)', async () => {
    const me = await rider(h, 'me@example.com');
    const season = await seedSeason(h);
    const ids = await racesAt(h, season, me.userId, 5, 100);
    await list(me);
    await achievementsDb(h).grants.deleteMany({
      userId: me.userId,
      code: { $in: ['races_5', 'race_first_finish'] },
    });
    const at = h.clock.now();
    const v1 = (
      code: 'races_5' | 'race_first_finish',
      race: string,
      factAt: Date,
      seenAt: Date | null,
    ) =>
      achievementsDb(h).grants.insertOne({
        _id: `${me.userId}:${code}`,
        userId: me.userId,
        code,
        object: { kind: 'race', id: race },
        factAt,
        grantedAt: at,
        seenAt,
        revokedAt: null,
        updatedAt: at,
      });
    await v1('races_5', ids[4]!, daysAgo(h, 96), at);
    await v1('race_first_finish', ids[0]!, daysAgo(h, 100), null);
    const before = await achievementsDb(h).grants.find({ userId: me.userId }).toArray();

    const items = await list(me);
    expect(items.find((item) => item.code === 'races_5')).toMatchObject({
      level: 'bronze',
      seen: true,
    });
    expect(items.find((item) => item.code === 'race_first_finish')).toMatchObject({
      level: null,
      seen: false,
    });
    expect(await achievementsDb(h).grants.find({ userId: me.userId }).toArray()).toEqual(before);

    // POST seen по v1-документу на бронзе: показанный — без записи
    expect(await repository().markSeen(me.userId, ['races_5'], [], at)).toBe(0);
    expect(await repository().markSeen(me.userId, ['race_first_finish'], [], at)).toBe(1);
    expect(await repository().markSeen(me.userId, ['race_first_finish'], [], at)).toBe(0);

    // +25 гонок — сразу золото, одна вспышка (не каскад)
    await racesAt(h, season, me.userId, 25, 50);
    expect(await races5(me)).toMatchObject({ level: 'gold', seen: false });
    expect(await repository().markSeen(me.userId, ['races_5'], [], at)).toBe(1);
    expect(await grantOf(me.userId)).toMatchObject({ level: 3, seenLevel: 3 });
  });

  it('AC4: прогресс по трём кодам; публичный — уровень races_5, без прогресса (точные ключи)', async () => {
    const me = await rider(h, 'me@example.com');
    const other = await rider(h, 'other@example.com');
    const publicId = await publicIdOf(me);
    const season = await seedSeason(h);
    await racesAt(h, season, me.userId, 7, 100);
    await seedRouteRide(h, me.userId, await catalogCorridorRoute(h, me.userId), daysAgo(h, 3));
    await pastRide(h, other, [me], 2);

    const res = await authed(h, me, 'GET', ACHIEVEMENTS);
    expect((res.body as { progress: unknown[] }).progress).toEqual([
      { code: 'races_5', level: 'silver', current: 7, target: 15 },
      { code: 'routes_5', level: 'bronze', current: 1, target: 5 },
      { code: 'rides_10', level: 'bronze', current: 1, target: 10 },
    ]);
    for (const step of (res.body as { progress: Record<string, unknown>[] }).progress) {
      expect(Object.keys(step).sort()).toEqual(['code', 'current', 'level', 'target']);
    }
    expect((await list(me)).find((item) => item.code === 'races_5')).toMatchObject({
      level: 'bronze',
      seen: true,
    });

    const pub = await call(h, 'GET', `/v1/riders/${publicId}/achievements`);
    expect(Object.keys(pub.body as object)).toEqual(['items']);
    const items = (pub.body as { items: Record<string, unknown>[] }).items;
    expect(items.find((item) => item.code === 'races_5')).toMatchObject({ level: 'bronze' });
    expect(items.find((item) => item.code === 'race_first_finish')).toMatchObject({ level: null });
    for (const item of items) {
      expect(Object.keys(item).sort()).toEqual(['code', 'factDate', 'level', 'object']);
    }
  });

  it('AC5: параллельные GET ×5 при повышении — без 500 и дублей, уровень и seen согласованы', async () => {
    const me = await rider(h, 'me@example.com');
    const season = await seedSeason(h);
    await racesAt(h, season, me.userId, 5, 100);
    expect(await races5(me)).toMatchObject({ level: 'bronze', seen: true });
    await racesAt(h, season, me.userId, 10, 50);

    const wait = barrier(5);
    const original = AchievementsRepository.prototype.syncedAt;
    vi.spyOn(repository(), 'syncedAt').mockImplementation(async function (
      this: AchievementsRepository,
      userId: string,
    ) {
      const result = await original.call(this, userId);
      await wait();
      return result;
    });
    const responses = await Promise.all(
      Array.from({ length: 5 }, () => authed(h, me, 'GET', ACHIEVEMENTS)),
    );
    expect(responses.map((res) => res.status)).toEqual(Array(5).fill(200));
    for (const res of responses) {
      expect(
        AchievementList.parse(res.body).items.find((item) => item.code === 'races_5'),
      ).toMatchObject({ level: 'silver', seen: false });
    }
    expect(
      await achievementsDb(h).grants.countDocuments({ userId: me.userId, code: 'races_5' }),
    ).toBe(1);
    expect(await grantOf(me.userId)).toMatchObject({ level: 2, seenLevel: 1 });
  });
});

describe('сезонные достижения (achievements-seasonal, AC2–AC6)', () => {
  const seasonalOf = <T extends { object: { kind: string } }>(items: T[]) =>
    items.filter((item) => item.object.kind === 'season');
  const seasonDoc = (userId: string, code: SeasonalAchievementCode, seasonId: string) =>
    achievementsDb(h).seasonGrants.findOne({ userId, code, seasonId });
  const seenSeasonal = (who: Rider, seasonal: unknown) =>
    authed(h, who, 'POST', `${ACHIEVEMENTS}/seen`, { seasonal });
  const item = (
    code: string,
    seasonId: string,
    title: string,
    year: number,
    seenFlag: boolean,
  ) => ({
    code,
    object: { kind: 'season', id: seasonId, title },
    factDate: `${year}-10-31`,
    level: null,
    seen: seenFlag,
  });

  it('AC2: чемпион сезона A и призёр сезона B — 2 × season_podium и 1 season_champion; первая сверка тихая; новая — seen: false; seen по (code, seasonId)', async () => {
    const me = await rider(h, 'me@example.com');
    const other = await rider(h, 'other@example.com');
    const a = await seedSeason(h, 'Сезон 2024', { year: 2024 });
    const b = await seedSeason(h, 'Сезон 2025', { year: 2025 });
    await seedProtocolRace(h, a, [placedRow(me.userId, 1), placedRow(other.userId, 2)]);
    await seedProtocolRace(h, b, [placedRow(other.userId, 1), placedRow(me.userId, 2)]);
    await syncStandings(h);

    const res = await authed(h, me, 'GET', ACHIEVEMENTS);
    expect(seasonalOf(AchievementList.parse(res.body).items)).toEqual([
      item('season_podium', b, 'Сезон 2025', 2025, true),
      item('season_champion', a, 'Сезон 2024', 2024, true),
      item('season_podium', a, 'Сезон 2024', 2024, true),
    ]);
    const seasonal = (res.body as { items: { object: { kind: string } }[] }).items.find(
      (entry) => entry.object.kind === 'season',
    )!;
    expect(Object.keys(seasonal).sort()).toEqual(['code', 'factDate', 'level', 'object', 'seen']);
    expect(JSON.stringify(res.body)).not.toContain(me.userId);
    expect(
      await achievementsDb(h).seasonGrants.countDocuments({
        userId: me.userId,
        code: 'season_podium',
      }),
    ).toBe(2);
    expect(
      await achievementsDb(h).seasonGrants.countDocuments({
        userId: me.userId,
        code: 'season_champion',
      }),
    ).toBe(1);
    // AC6: в achievement_grants сезонных документов нет
    expect(await h.db.collection('achievement_grants').countDocuments({ code: /^season_/ })).toBe(
      0,
    );

    // новый завершённый сезон после первой сверки — вспышка
    const c = await seedSeason(h, 'Сезон 2023', { year: 2023 });
    await seedProtocolRace(h, c, [placedRow(me.userId, 1)]);
    await syncStandings(h);
    expect(seasonalOf(await list(me)).filter((entry) => entry.object.id === c)).toEqual([
      item('season_champion', c, 'Сезон 2023', 2023, false),
      item('season_podium', c, 'Сезон 2023', 2023, false),
    ]);

    // сезонный код в `codes` — без записи
    expect((await seen(me, ['season_podium'])).status).toBe(204);
    expect((await seasonDoc(me.userId, 'season_podium', c))?.seenAt).toBeNull();
    // seen по (code, seasonId) — только эта выдача; чужая (у other нет) и незнакомая — без ошибки
    expect(
      (
        await seenSeasonal(me, [
          { code: 'season_champion', seasonId: c },
          { code: 'season_regular', seasonId: a },
        ])
      ).status,
    ).toBe(204);
    expect((await seasonDoc(me.userId, 'season_champion', c))?.seenAt).toEqual(h.clock.now());
    expect((await seasonDoc(me.userId, 'season_podium', c))?.seenAt).toBeNull();
    expect((await seenSeasonal(other, [{ code: 'season_podium', seasonId: c }])).status).toBe(204);
    expect((await seasonDoc(me.userId, 'season_podium', c))?.seenAt).toBeNull();
    // неверные адреса — 400
    for (const body of [
      { seasonal: [{ code: 'race_win', seasonId: c }] },
      { seasonal: [] },
      { codes: [], seasonal: [] },
    ]) {
      const bad = await authed(h, me, 'POST', `${ACHIEVEMENTS}/seen`, body);
      expect(bad.status, JSON.stringify(body)).toBe(400);
    }
    // AC6: `{ codes }` для несезонных работает как прежде
    expect((await seen(me, ['race_win'])).status).toBe(204);
  });

  it('AC3: пересчёт снимка сместил место — отзыв молча; между ревизией и пересчётом (`pending`) — без изменений; возврат — seen прежний', async () => {
    const me = await rider(h, 'me@example.com');
    const other = await rider(h, 'other@example.com');
    const season = await seedSeason(h, 'Сезон 2025', { year: 2025 });
    const race = await seedProtocolRace(h, season, [
      placedRow(me.userId, 1),
      placedRow(other.userId, 2),
    ]);
    await syncStandings(h);
    await list(me);
    const docs = () =>
      achievementsDb(h).seasonGrants.find({ userId: me.userId }).sort({ code: 1 }).toArray();

    await addRevision(h, race, 2, [placedRow(other.userId, 1), placedRow(me.userId, 2)]);
    const before = await docs();
    expect(seasonalOf(await list(me)).map((entry) => entry.code)).toEqual([
      'season_champion',
      'season_podium',
    ]);
    expect(await docs()).toEqual(before);

    await syncStandings(h);
    expect(seasonalOf(await list(me))).toEqual([
      item('season_podium', season, 'Сезон 2025', 2025, true),
    ]);
    expect((await seasonDoc(me.userId, 'season_champion', season))?.revokedAt).not.toBeNull();

    await addRevision(h, race, 3, [placedRow(me.userId, 1), placedRow(other.userId, 2)]);
    await syncStandings(h);
    expect(seasonalOf(await list(me))).toEqual([
      item('season_champion', season, 'Сезон 2025', 2025, true),
      item('season_podium', season, 'Сезон 2025', 2025, true),
    ]);
  });

  it('AC1: «Сезон в зачёте» — 3 гонки с местом в одной таблице; 2 и DQ — нет; незавершённый сезон — нет', async () => {
    const me = await rider(h, 'me@example.com');
    const other = await rider(h, 'other@example.com');
    const past = await seedSeason(h, 'Сезон 2025', { year: 2025 });
    const current = await seedSeason(h, 'Сезон 2026');
    // трое впереди в каждой гонке — в таблице сезона «я» не выше 4-го места
    const ahead = [other.userId, uuidv7(), uuidv7()];
    const leaders = ahead.map((userId, k) => placedRow(userId, k + 1));
    for (const place of [4, 5]) {
      await seedProtocolRace(h, past, [...leaders, placedRow(me.userId, place)]);
    }
    await seedProtocolRace(h, past, [...leaders, dqRow(me.userId)]);
    await seedProtocolRace(h, current, [placedRow(me.userId, 1)]);
    await syncStandings(h);
    expect(seasonalOf(await list(me))).toEqual([]);

    await seedProtocolRace(h, past, [...leaders, placedRow(me.userId, 4)]);
    await syncStandings(h);
    expect(seasonalOf(await list(me))).toEqual([
      item('season_regular', past, 'Сезон 2025', 2025, false),
    ]);
  });

  it('AC4: параллельные GET ×5 при первой выдаче — без 500 и дублей', async () => {
    const me = await rider(h, 'me@example.com');
    const season = await seedSeason(h, 'Сезон 2025', { year: 2025 });
    await seedProtocolRace(h, season, [placedRow(me.userId, 1)]);
    await syncStandings(h);
    const wait = barrier(5);
    const original = AchievementsRepository.prototype.listSeasonalOf;
    let calls = 0;
    vi.spyOn(repository(), 'listSeasonalOf').mockImplementation(async function (
      this: AchievementsRepository,
      userId: string,
    ) {
      const result = await original.call(this, userId);
      // только первое чтение каждого GET (до записей) ждёт остальных
      calls += 1;
      if (calls <= 5) await wait();
      return result;
    });
    const responses = await Promise.all(
      Array.from({ length: 5 }, () => authed(h, me, 'GET', ACHIEVEMENTS)),
    );
    expect(responses.map((res) => res.status)).toEqual(Array(5).fill(200));
    for (const res of responses) {
      expect(seasonalOf(AchievementList.parse(res.body).items).map((entry) => entry.code)).toEqual([
        'season_champion',
        'season_podium',
      ]);
    }
    for (const code of ['season_champion', 'season_podium']) {
      expect(
        await achievementsDb(h).seasonGrants.countDocuments({
          userId: me.userId,
          code: code as 'season_podium',
          seasonId: season,
        }),
      ).toBe(1);
    }
  });

  it('AC5: публичный список — сезонные включены (точные ключи), без записи; непубличный — 404', async () => {
    const me = await rider(h, 'me@example.com');
    const publicId = await publicIdOf(me);
    const season = await seedSeason(h, 'Сезон 2025', { year: 2025 });
    await seedProtocolRace(h, season, [placedRow(me.userId, 1)]);
    await syncStandings(h);

    const res = await call(h, 'GET', `/v1/riders/${publicId}/achievements`);
    expect(res.status).toBe(200);
    const items = PublicRiderAchievementList.parse(res.body).items;
    expect(seasonalOf(items)).toEqual([
      {
        code: 'season_champion',
        object: { kind: 'season', id: season, title: 'Сезон 2025' },
        factDate: '2025-10-31',
        level: null,
      },
      {
        code: 'season_podium',
        object: { kind: 'season', id: season, title: 'Сезон 2025' },
        factDate: '2025-10-31',
        level: null,
      },
    ]);
    for (const entry of (res.body as { items: Record<string, unknown>[] }).items) {
      expect(Object.keys(entry).sort()).toEqual(['code', 'factDate', 'level', 'object']);
    }
    expect(await achievementsDb(h).seasonGrants.countDocuments({})).toBe(0);

    await call(h, 'PATCH', '/v1/profile', { showNameInResults: false }, bearer(me.token));
    expect((await call(h, 'GET', `/v1/riders/${publicId}/achievements`)).status).toBe(404);
  });

  it('сбой порта сезонов — несезонные и прогресс отдаются, сезонные выдачи не трогаются (ревью pass 1, MEDIUM)', async () => {
    const me = await rider(h, 'me@example.com');
    const season = await seedSeason(h, 'Сезон 2025', { year: 2025 });
    await seedProtocolRace(h, season, [placedRow(me.userId, 1)]);
    await syncStandings(h);
    expect(seasonalOf(await list(me))).toHaveLength(2);

    const port = h.app.get<RiderSeasonStandings>(RIDER_SEASON_STANDINGS, { strict: false });
    vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    vi.spyOn(port, 'outcomesOf').mockRejectedValue(new Error('standings down'));
    const res = await authed(h, me, 'GET', ACHIEVEMENTS);
    expect(res.status).toBe(200);
    const items = AchievementList.parse(res.body).items;
    expect(codesOf(items)).toContain('race_win');
    expect(seasonalOf(items)).toEqual([]);
    expect(
      await achievementsDb(h).seasonGrants.countDocuments({ userId: me.userId, revokedAt: null }),
    ).toBe(2);
    const publicId = await publicIdOf(me);
    expect((await call(h, 'GET', `/v1/riders/${publicId}/achievements`)).status).toBe(200);
    vi.mocked(port.outcomesOf).mockRestore();
    expect(seasonalOf(await list(me))).toHaveLength(2);
  });

  it('AC6: документ v1 в achievement_grants — прежний ответ рядом с сезонными', async () => {
    const me = await rider(h, 'me@example.com');
    const season = await seedSeason(h, 'Сезон 2025', { year: 2025 });
    const race = await seedProtocolRace(h, season, [placedRow(me.userId, 1)]);
    await syncStandings(h);
    await list(me);
    await achievementsDb(h).grants.deleteMany({ userId: me.userId, code: 'race_win' });
    const at = h.clock.now();
    await achievementsDb(h).grants.insertOne({
      _id: `${me.userId}:race_win`,
      userId: me.userId,
      code: 'race_win',
      object: { kind: 'race', id: race },
      factAt: at,
      grantedAt: at,
      seenAt: null,
      revokedAt: null,
      updatedAt: at,
    });
    const items = await list(me);
    expect(items.find((entry) => entry.code === 'race_win')).toMatchObject({
      object: { kind: 'race', id: race },
      level: null,
      seen: false,
    });
    expect(seasonalOf(items)).toHaveLength(2);
    expect((await seen(me, ['race_win'])).status).toBe(204);
    expect(seenOf(await list(me))).toMatchObject({ race_win: true });
  });
});
