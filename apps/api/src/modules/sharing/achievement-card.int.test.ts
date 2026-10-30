import { getQueueToken } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { AchievementList, StoryCardStatus } from '@pokatim/contracts';
import type { Job, Queue } from 'bullmq';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  ACHIEVEMENTS,
  daysAgo,
  pastRide,
  raceAt,
  racesAt,
  seedRouteRide,
} from '../../../test/achievements';
import { createHarness, type Harness } from '../../../test/harness';
import { bearer, call } from '../../../test/identity';
import { catalogCorridorRoute, ownCorridorRoute } from '../../../test/route-rides';
import { authed, rider, type Rider } from '../../../test/rides';
import {
  addRevision,
  dqRow,
  placedRow,
  seedProtocolRace,
  seedSeason,
  syncStandings,
} from '../../../test/standings';
import { QUEUE } from '../../queues';
import { ACHIEVEMENTS_FOR_SHARING, type AchievementsForSharing } from '../achievements';
import { AchievementCardInputs } from './achievement-card.inputs';
import { ACHIEVEMENT_CARD_RENDER_JOB, type AchievementCardJob } from './story-card.cache';
import { StoryCardProcessor } from './story-card.processor';

/**
 * Карточка своего достижения (achievement-story-card, AC1–AC4): статус (HTTP), задача `achievement-card.render`
 * (процессор — напрямую), PNG по капабилити-токену. Достижения выдаёт сверка `GET /v1/achievements`. Redis и
 * MongoDB — настоящие.
 */
let h: Harness;
let me: Rider;
let other: Rider;
beforeAll(async () => {
  h = await createHarness({ TRUST_PROXY: '1' });
});
beforeEach(async () => {
  await h.reset();
  me = await rider(h, 'me@example.by');
  other = await rider(h, 'other@example.by');
});
afterEach(() => {
  vi.restoreAllMocks();
});
afterAll(async () => {
  await h.close();
});

const processor = () => h.worker.get(StoryCardProcessor);
const queue = () => h.app.get<Queue>(getQueueToken(QUEUE.storyCard));
const jobs = () => queue().getJobs(['waiting', 'delayed', 'active']);
const cardUrl = (code: string, query = '?template=line') =>
  `${ACHIEVEMENTS}/${code}/story-card${query}`;

/** Сверка выдач (`GET /v1/achievements`) — коды видимого списка. */
async function sync(who: Rider): Promise<string[]> {
  const res = await authed(h, who, 'GET', ACHIEVEMENTS);
  expect(res.status, JSON.stringify(res.body)).toBe(200);
  return AchievementList.parse(res.body).items.map((item) => item.code);
}

async function status(who: Rider, code: string, query?: string) {
  const res = await authed(h, who, 'GET', cardUrl(code, query));
  expect(res.status, JSON.stringify(res.body)).toBe(200);
  expect(res.headers['cache-control']).toBe('no-store');
  return StoryCardStatus.parse(res.body);
}

const image = (file: string) => h.app.inject({ method: 'GET', url: `/v1/story-cards/${file}` });

async function takeJob(): Promise<Job<AchievementCardJob>> {
  const [job] = await jobs();
  expect(job).toBeDefined();
  expect(job!.name).toBe(ACHIEVEMENT_CARD_RENDER_JOB);
  await job!.remove();
  return job as Job<AchievementCardJob>;
}
const runJob = async (options: { finalAttempt?: boolean } = {}) =>
  processor().buildAchievementCard((await takeJob()).data, options);

async function readyToken(who: Rider, code: string, query?: string): Promise<string> {
  const ready = await status(who, code, query);
  if (ready.status !== 'ready') throw new Error(`ожидалась картинка: ${ready.status}`);
  return ready.token;
}

/** Своя победа в гонке «Весенняя» 10 дней назад; выдана сверкой. */
async function winRace(who: Rider, title = 'Весенняя'): Promise<string> {
  const season = await seedSeason(h);
  const race = await raceAt(h, season, [placedRow(who.userId, 1)], daysAgo(h, 10), title);
  expect(await sync(who)).toContain('race_win');
  return race;
}

/** Входы, которые worker отдал бы рендеру (то же, что на картинке). */
const inputsOf = (who: Rider, code: 'race_win' | 'route_first' | 'ride_first') =>
  h.worker.get(AchievementCardInputs).resolve(who.userId, code, 'line');

describe('отказы (AC1)', () => {
  it('гость — 401; незнакомый код, кривой шаблон, лишний ключ — 400', async () => {
    expect((await call(h, 'GET', cardUrl('race_win'))).status).toBe(401);
    for (const url of [
      cardUrl('race_win', ''),
      cardUrl('race_win', '?template=foo'),
      cardUrl('race_win', '?template=line&userId=x'),
      cardUrl('unknown_code'),
    ]) {
      expect((await authed(h, me, 'GET', url)).status, url).toBe(400);
    }
  });

  it('не полученное — 409; чужое (у другого райдера) — 409 тому, у кого нет; без задачи', async () => {
    await winRace(other);
    for (const code of ['race_win', 'ride_first']) {
      const res = await authed(h, me, 'GET', cardUrl(code));
      expect(res.status).toBe(409);
      expect(res.body).toMatchObject({ code: 'STORY_CARD_UNAVAILABLE' });
    }
    expect(await jobs()).toHaveLength(0);
  });

  it('факт есть, но сверки ещё не было (выдачи нет) — 409', async () => {
    const season = await seedSeason(h);
    await raceAt(h, season, [placedRow(me.userId, 1)], daysAgo(h, 3));
    const res = await authed(h, me, 'GET', cardUrl('race_win'));
    expect(res.status).toBe(409);
  });

  it('сезонное достижение (выдано) — 409, без задачи (S7: карточки у сезонных нет)', async () => {
    const season = await seedSeason(h, 'Сезон 2025', { year: 2025 });
    await seedProtocolRace(h, season, [placedRow(me.userId, 1)]);
    await syncStandings(h);
    expect(await sync(me)).toContain('season_podium');
    for (const code of ['season_podium', 'season_champion']) {
      const res = await authed(h, me, 'GET', cardUrl(code));
      expect(res.status).toBe(409);
      expect(res.body).toMatchObject({ code: 'STORY_CARD_UNAVAILABLE' });
    }
    expect(await jobs()).toHaveLength(0);
  });

  it('отозванное (DQ новой ревизией) — 409', async () => {
    const race = await winRace(me);
    await addRevision(h, race, 2, [dqRow(me.userId)]);
    expect(await sync(me)).not.toContain('race_win');
    const res = await authed(h, me, 'GET', cardUrl('race_win'));
    expect(res.status).toBe(409);
  });
});

describe('pending → ready → PNG (AC2)', () => {
  it('одна задача; повтор — тот же токен; PNG 1080×1920; другой шаблон — своя', async () => {
    await winRace(me);
    expect(await status(me, 'race_win')).toEqual({ status: 'pending' });
    expect(await status(me, 'race_win')).toEqual({ status: 'pending' });
    expect(await jobs()).toHaveLength(1);

    expect(await runJob()).toBe('ready');
    const token = await readyToken(me, 'race_win');
    expect(await readyToken(me, 'race_win')).toBe(token);

    const res = await image(`${token}.png`);
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toBe('image/png');
    expect(res.rawPayload.readUInt32BE(16)).toBe(1080);
    expect(res.rawPayload.readUInt32BE(20)).toBe(1920);

    expect(await status(me, 'race_win', '?template=night')).toEqual({ status: 'pending' });
  });

  it('ответ — ровно статус, без userId и названий', async () => {
    await winRace(me, 'Тайная гонка');
    const res = await authed(h, me, 'GET', cardUrl('race_win'));
    expect(res.body).toEqual({ status: 'pending' });
  });
});

describe('объект и имя на картинке (AC3)', () => {
  it('гонка и райд — название; имя — только с согласием', async () => {
    await winRace(me, 'Весенняя');
    await pastRide(h, other, [me], 5, 'Утренний');
    expect(await sync(me)).toContain('ride_first');
    expect((await inputsOf(me, 'race_win'))?.input).toMatchObject({
      objectTitle: 'Весенняя',
      riderName: null,
    });
    expect((await inputsOf(me, 'ride_first'))?.input.objectTitle).toBe('Утренний');

    const consent = await call(
      h,
      'PATCH',
      '/v1/profile',
      { publicName: 'Анна К.', showNameInResults: false },
      bearer(me.token),
    );
    expect(consent.status).toBe(200);
    expect((await inputsOf(me, 'race_win'))?.input.riderName).toBeNull();
    await call(h, 'PATCH', '/v1/profile', { showNameInResults: true }, bearer(me.token));
    expect((await inputsOf(me, 'race_win'))?.input.riderName).toBe('Анна К.');
  });

  it('маршрут каталога — название; свой приватный — без строки объекта', async () => {
    const catalog = await catalogCorridorRoute(h, other.userId);
    await seedRouteRide(h, me.userId, catalog, daysAgo(h, 4));
    expect(await sync(me)).toContain('route_first');
    expect((await inputsOf(me, 'route_first'))?.input.objectTitle).toBe('Эталонный коридор');

    const third = await rider(h, 'third@example.by');
    const own = await ownCorridorRoute(h, third.userId);
    await seedRouteRide(h, third.userId, own, daysAgo(h, 2));
    expect(await sync(third)).toContain('route_first');
    const resolved = await inputsOf(third, 'route_first');
    expect(resolved?.input.facts.object).toMatchObject({ kind: 'route', id: own });
    expect(resolved?.input.objectTitle).toBeNull();
    expect(await status(third, 'route_first')).toEqual({ status: 'pending' });
    expect(await runJob()).toBe('ready');
  });
});

describe('worker (AC4)', () => {
  it('достижение отозвано между постановкой и рендером — skipped без PNG', async () => {
    const race = await winRace(me);
    await status(me, 'race_win');
    const job = await takeJob();
    await addRevision(h, race, 2, [dqRow(me.userId)]);
    expect(await processor().buildAchievementCard(job.data)).toBe('skipped');
  });

  it('вход изменился (имя) — skipped; новый запрос — новая задача', async () => {
    await winRace(me);
    await status(me, 'race_win');
    const stale = await takeJob();
    await call(
      h,
      'PATCH',
      '/v1/profile',
      { publicName: 'Анна К.', showNameInResults: true },
      bearer(me.token),
    );
    expect(await processor().buildAchievementCard(stale.data)).toBe('skipped');
    expect(await status(me, 'race_win')).toEqual({ status: 'pending' });
    expect(await runJob()).toBe('ready');
  });

  it('провал на последней попытке → failed один раз; в логе — только тип ошибки', async () => {
    await winRace(me, 'Весенняя');
    await status(me, 'race_win');
    const job = await takeJob();
    const port = h.worker.get<AchievementsForSharing>(ACHIEVEMENTS_FOR_SHARING);
    vi.spyOn(port, 'cardFacts').mockRejectedValueOnce(new TypeError('boom: Весенняя, Анна К.'));
    const warnings: string[] = [];
    vi.spyOn(Logger.prototype, 'warn').mockImplementation((message: unknown) => {
      warnings.push(String(message));
    });
    expect(await processor().buildAchievementCard(job.data, { finalAttempt: true })).toBe('failed');
    vi.restoreAllMocks();
    const warned = warnings.join('\n');
    expect(warned).toContain('achievement race_win line: failed (TypeError)');
    expect(warned).not.toContain('Весенняя');
    expect(await status(me, 'race_win')).toEqual({ status: 'failed' });
    expect(await status(me, 'race_win')).toEqual({ status: 'pending' });
  });

  it('логи рендера — без userId, названия и токена', async () => {
    await winRace(me, 'Весенняя');
    const logs: string[] = [];
    vi.spyOn(Logger.prototype, 'log').mockImplementation((message: unknown) => {
      logs.push(String(message));
    });
    await status(me, 'race_win');
    await runJob();
    vi.restoreAllMocks();
    const token = await readyToken(me, 'race_win');
    const text = logs.join('\n');
    expect(text).toContain('achievement race_win line: ready (badge)');
    for (const secret of [me.userId, 'Весенняя', token]) expect(text).not.toContain(secret);
  });
});

describe('уровни (AC6)', () => {
  it('серебро — картинка; +гонки до золота — новый хэш: pending и другой токен; уровень — во входах', async () => {
    const season = await seedSeason(h);
    await racesAt(h, season, me.userId, 15, 100);
    expect(await sync(me)).toContain('races_5');
    const silver = await h.worker.get(AchievementCardInputs).resolve(me.userId, 'races_5', 'line');
    expect(silver?.input.facts.level).toBe('silver');
    expect(await status(me, 'races_5')).toEqual({ status: 'pending' });
    expect(await runJob()).toBe('ready');
    const silverToken = await readyToken(me, 'races_5');

    await racesAt(h, season, me.userId, 15, 50);
    expect(await sync(me)).toContain('races_5');
    const gold = await h.worker.get(AchievementCardInputs).resolve(me.userId, 'races_5', 'line');
    expect(gold?.input.facts.level).toBe('gold');
    expect(gold?.hash).not.toBe(silver?.hash);
    expect(await status(me, 'races_5')).toEqual({ status: 'pending' });
    expect(await runJob()).toBe('ready');
    expect(await readyToken(me, 'races_5')).not.toBe(silverToken);
  });
});
