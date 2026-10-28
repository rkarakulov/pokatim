import { rm } from 'node:fs/promises';

import { getQueueToken } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { MyRaceEntry, StoryCardStatus } from '@pokatim/contracts';
import { sliceLine } from '@pokatim/route-view';
import { uuidv7 } from '@rkarakulov/api-kit/mongo';
import type { Queue } from 'bullmq';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { createHarness, type Harness } from '../../../test/harness';
import { call } from '../../../test/identity';
import {
  corridorRace,
  enterRace,
  myEntry,
  protocolAction,
  protocolRace,
  resultsDb,
  resultsWorker,
  rideGpx,
  rider,
  seedBest,
  signIn,
  travelTo,
  uploadRide,
  withdraw,
} from '../../../test/results';
import { TRACK_STORAGE_DIR_TEST } from '../../../test/test-env';
import { QUEUE } from '../../queues';
import { RESULTS_FOR_SHARING, type ResultsForSharing } from '../results';
import { ACTIVITY_SOURCE, type ActivitySource } from '../tracks';
import { STORY_CARD_POLICY } from './sharing.policy';
import { StoryCardCache } from './story-card.cache';
import { StoryCardProcessor } from './story-card.processor';

/**
 * Карточка для сторис (story-cards, AC1–AC6): статус своего результата (HTTP), задача `story-card` (процессор —
 * напрямую), PNG по капабилити-токену; Redis и MongoDB — настоящие.
 */
let h: Harness;
beforeAll(async () => {
  h = await createHarness({ TRUST_PROXY: '1' });
});
beforeEach(async () => {
  await h.reset();
  await rm(TRACK_STORAGE_DIR_TEST, { recursive: true, force: true });
});
afterAll(async () => {
  await h.close();
  await rm(TRACK_STORAGE_DIR_TEST, { recursive: true, force: true });
});

const RIDE = new Date('2026-10-25T06:00:00Z');
const AFTER_RIDE = new Date('2026-10-25T08:00:00Z');
const processor = () => h.worker.get(StoryCardProcessor);
const queue = () => h.app.get<Queue>(getQueueToken(QUEUE.storyCard));
const jobs = () => queue().getJobs(['waiting', 'delayed', 'active']);
const cardUrl = (raceId: string, query = '?template=line') =>
  `/v1/races/${raceId}/entry/story-card${query}`;

async function status(auth: Record<string, string>, raceId: string, query?: string) {
  const res = await call(h, 'GET', cardUrl(raceId, query), undefined, auth);
  expect(res.status, JSON.stringify(res.body)).toBe(200);
  expect(res.headers['cache-control']).toBe('no-store');
  return StoryCardStatus.parse(res.body);
}

const image = (file: string) => h.app.inject({ method: 'GET', url: `/v1/story-cards/${file}` });

/** Единственная задача очереди → процессор напрямую. */
async function runJob(options: { finalAttempt?: boolean } = {}) {
  const [job] = await jobs();
  expect(job).toBeDefined();
  await job!.remove();
  return processor().build(job!.data, options);
}

/** Гонка и своя заявка с лучшим временем (вставкой; попытки нет — линия маршрута). */
async function timedEntry(elapsedSec = 9_754) {
  const race = await corridorRace(h);
  const me = await rider(h);
  const entry = MyRaceEntry.parse((await enterRace(h, me.auth, race.raceId)).body).entry!;
  await seedBest(h, entry.id, elapsedSec, new Date('2026-10-25T06:00:00Z'));
  return { ...race, ...me, entryId: entry.id };
}

/** Настоящий заезд эталона в окне гонки: засчитанная попытка с разметкой `trackMap`. */
async function riddenEntry() {
  const race = await corridorRace(h);
  const me = await rider(h);
  expect((await enterRace(h, me.auth, race.raceId)).status).toBe(201);
  const worker = resultsWorker(h);
  await worker.drain();
  travelTo(h, AFTER_RIDE);
  const auth = await signIn(h, me.email);
  const ride = await uploadRide(h, auth, rideGpx('clean.gpx', RIDE));
  await worker.drain();
  const attempt = await resultsDb(h).attempts.findOne({ userId: me.userId });
  expect(attempt).toMatchObject({ status: 'counted' });
  return { ...race, ...me, auth, attempt: attempt!, activityId: ride.activityId! };
}

describe('отказы (AC5, AC1)', () => {
  it('гость — 401; шаблон: нет, незнакомый, лишний ключ — 400; неизвестная гонка — 404', async () => {
    const { raceId, auth } = await timedEntry();
    expect((await call(h, 'GET', cardUrl(raceId))).status).toBe(401);
    for (const query of ['', '?template=foo', '?template=line&theme=chrono']) {
      expect((await call(h, 'GET', cardUrl(raceId, query), undefined, auth)).status).toBe(400);
    }
    const unknown = await call(h, 'GET', cardUrl(uuidv7()), undefined, auth);
    expect(unknown.status).toBe(404);
  });

  it('409 STORY_CARD_UNAVAILABLE: без заявки, без времени, снятая заявка, DQ; canShareStory — false', async () => {
    const race = await corridorRace(h);
    const outsider = await rider(h, 'outsider@example.com');
    const refuse = async (auth: Record<string, string>) => {
      const res = await call(h, 'GET', cardUrl(race.raceId), undefined, auth);
      expect(res.status).toBe(409);
      expect(res.body).toMatchObject({ code: 'STORY_CARD_UNAVAILABLE' });
    };
    await refuse(outsider.auth);

    const me = await rider(h);
    const entry = MyRaceEntry.parse((await enterRace(h, me.auth, race.raceId)).body).entry!;
    await refuse(me.auth);
    expect((await myEntry(h, me.auth, race.raceId)).actions.canShareStory).toBe(false);

    await seedBest(h, entry.id, 3600, new Date('2026-10-25T06:00:00Z'));
    expect((await myEntry(h, me.auth, race.raceId)).actions.canShareStory).toBe(true);
    await resultsDb(h).entries.updateOne(
      { _id: entry.id },
      { $set: { disqualified: { at: h.clock.now(), disputeId: uuidv7() } } },
    );
    await refuse(me.auth);
    expect((await myEntry(h, me.auth, race.raceId)).actions.canShareStory).toBe(false);

    await resultsDb(h).entries.updateOne({ _id: entry.id }, { $set: { disqualified: null } });
    expect((await withdraw(h, me.auth, race.raceId)).status).toBe(200);
    await refuse(me.auth);
    expect(await jobs()).toHaveLength(0);
  });

  it('неизвестный токен и кривое имя файла — 404 JSON без image/png', async () => {
    for (const file of ['AbCdEfGhIjKlMnOpQrSt_-.png', 'short.png', 'AbCdEfGhIjKlMnOpQrSt_-.jpg']) {
      const res = await image(file);
      expect(res.statusCode).toBe(404);
      expect(res.headers['content-type']).toMatch(/application\/json/);
      expect(res.json()).toMatchObject({ code: 'NOT_FOUND' });
    }
  });
});

describe('pending → ready → PNG (AC2, AC4)', () => {
  it('первый запрос ставит одну задачу, опрос — без новой; процессор → токен; PNG 1080×1920 с заголовками', async () => {
    const { raceId, auth } = await timedEntry();
    expect(await status(auth, raceId)).toEqual({ status: 'pending' });
    expect(await status(auth, raceId)).toEqual({ status: 'pending' });
    expect(await jobs()).toHaveLength(1);

    expect(await runJob()).toBe('ready');
    const ready = await status(auth, raceId);
    if (ready.status !== 'ready') throw new Error(`ожидалась картинка: ${ready.status}`);
    expect(await status(auth, raceId)).toEqual(ready);

    const res = await image(`${ready.token}.png`);
    expect(res.statusCode).toBe(200);
    expect(res.headers).toMatchObject({
      'content-type': 'image/png',
      'cache-control': 'private, max-age=86400, immutable',
      'x-content-type-options': 'nosniff',
      'content-security-policy': "default-src 'none'; sandbox",
      'referrer-policy': 'no-referrer',
      'content-disposition': 'inline; filename="pokatim-story.png"',
    });
    const png = res.rawPayload;
    expect(png.subarray(12, 16).toString('ascii')).toBe('IHDR');
    expect(png.readUInt32BE(16)).toBe(1080);
    expect(png.readUInt32BE(20)).toBe(1920);

    // другой шаблон — своя картинка
    expect(await status(auth, raceId, '?template=night')).toEqual({ status: 'pending' });
  });

  it('смена темы и согласия на имя — новая картинка (pending, другой ключ)', async () => {
    const { raceId, auth } = await timedEntry();
    await status(auth, raceId);
    await runJob();
    const first = await status(auth, raceId);
    expect(first.status).toBe('ready');

    await h.db.collection('platform_settings').insertOne({
      _id: 'appearance' as never,
      themeId: 'chrono',
      version: 1,
      updatedAt: h.clock.now(),
    });
    expect(await status(auth, raceId)).toEqual({ status: 'pending' });
    await runJob();
    const themed = await status(auth, raceId);
    if (themed.status !== 'ready' || first.status !== 'ready')
      throw new Error('ожидалась картинка');
    expect(themed.token).not.toBe(first.token);

    const named = await call(
      h,
      'PATCH',
      '/v1/profile',
      { publicName: 'Анна К.', showNameInResults: true },
      auth,
    );
    expect(named.status).toBe(200);
    expect(await status(auth, raceId)).toEqual({ status: 'pending' });
  });

  it('логи рендера — без userId и токена', async () => {
    const { raceId, auth, userId, entryId } = await timedEntry();
    const logs: string[] = [];
    vi.spyOn(Logger.prototype, 'log').mockImplementation((message: unknown) => {
      logs.push(String(message));
    });
    await status(auth, raceId);
    await runJob();
    const ready = await status(auth, raceId);
    vi.restoreAllMocks();
    if (ready.status !== 'ready') throw new Error('ожидалась картинка');
    const text = logs.join('\n');
    expect(text).toContain(`entry ${entryId} line: ready`);
    expect(text).not.toContain(userId);
    expect(text).not.toContain(ready.token);
  });
});

describe('провал, лимит, отрицательные доказательства', () => {
  it('провал на последней попытке → failed один раз, следующий запрос ставит заново', async () => {
    const { raceId, auth } = await timedEntry();
    await status(auth, raceId);
    const results = h.worker.get<ResultsForSharing>(RESULTS_FOR_SHARING);
    // длинное сообщение (фрагменты разметки satori/resvg) — в лог только начало
    vi.spyOn(results, 'storyCardLine').mockRejectedValue(new Error(`boom ${'x'.repeat(500)}`));
    const [job] = await jobs();
    await job!.remove();
    await expect(processor().build(job!.data)).rejects.toThrow('boom');
    const warnings: string[] = [];
    vi.spyOn(Logger.prototype, 'warn').mockImplementation((message: unknown) => {
      warnings.push(String(message));
    });
    expect(await processor().build(job!.data, { finalAttempt: true })).toBe('failed');
    vi.restoreAllMocks();
    // причина провала видна эксплуатации: тип и сообщение ошибки, без userId
    expect(warnings.join('\n')).toMatch(/failed \(Error: boom x+…\)/);
    expect(warnings.join('\n')).not.toContain('x'.repeat(250));
    expect(await status(auth, raceId)).toEqual({ status: 'failed' });
    expect(await status(auth, raceId)).toEqual({ status: 'pending' });
    expect(await jobs()).toHaveLength(1);
  });

  it('лимит постановок → 429, ключ постановки снят (следующий запрос после окна ставит)', async () => {
    const { raceId, auth, email } = await timedEntry();
    const cache = h.app.get(StoryCardCache);
    const release = vi.spyOn(cache, 'release');
    for (let i = 0; i < STORY_CARD_POLICY.renderLimit.limit; i += 1) {
      await status(auth, raceId);
      await cache.release((await jobs())[0]!.data.hash);
      for (const job of await jobs()) await job.remove();
    }
    const limited = await call(h, 'GET', cardUrl(raceId), undefined, auth);
    expect(limited.status).toBe(429);
    expect(release).toHaveBeenCalledTimes(STORY_CARD_POLICY.renderLimit.limit + 1);
    expect(await jobs()).toHaveLength(0);
    h.clock.advance(STORY_CARD_POLICY.renderLimit.windowSec * 1000);
    expect(await status(await signIn(h, email), raceId)).toEqual({ status: 'pending' });
  });

  it('устаревший хэш (место сменилось) → skipped, PNG не записан ни под старым, ни под новым ключом', async () => {
    const { raceId, auth, entryId } = await timedEntry();
    await status(auth, raceId);
    const [job] = await jobs();
    await job!.remove();
    // пока задача в очереди, время (и место) сменилось
    await seedBest(h, entryId, 5_000, new Date('2026-10-25T06:00:00Z'));
    expect(await processor().build(job!.data)).toBe('skipped');
    const cache = h.app.get(StoryCardCache);
    expect(await cache.readyToken(job!.data.hash)).toBeNull();
    // новый запрос — новая постановка под новым хэшем, не старая картинка
    expect(await status(auth, raceId)).toEqual({ status: 'pending' });
    const [next] = await jobs();
    expect(next!.data.hash).not.toBe(job!.data.hash);
  });

  it('без ключа NX два запроса ставят задачу дважды (ключ постановки — дедупликация)', async () => {
    const { raceId, auth } = await timedEntry();
    const add = vi.spyOn(queue(), 'add');
    await status(auth, raceId);
    await status(auth, raceId);
    expect(add).toHaveBeenCalledTimes(1);
    vi.spyOn(h.app.get(StoryCardCache), 'claim').mockResolvedValue(true);
    await status(auth, raceId);
    expect(add).toHaveBeenCalledTimes(2);
    vi.restoreAllMocks();
  });
});

describe('предварительность и группа (ревью pass 1)', () => {
  it('финишёр до публикации протокола — provisional', async () => {
    const race = await corridorRace(h);
    const me = await rider(h);
    const entry = MyRaceEntry.parse((await enterRace(h, me.auth, race.raceId)).body).entry!;
    await seedBest(h, entry.id, 3600, new Date('2026-10-25T06:00:00Z'), { ranked: false });
    const results = h.app.get<ResultsForSharing>(RESULTS_FOR_SHARING);
    expect(await results.storyCardFacts(me.userId, race.raceId)).toMatchObject({
      status: 'finisher',
      provisional: true,
    });
  });

  it('после публикации — не provisional, группа — из строки протокола (как место)', async () => {
    const published = await protocolRace(h, [3600]);
    const [winner] = published.riders;
    const publish = await protocolAction(h, published.token, published.raceId, '/protocol');
    expect(publish.status).toBe(200);
    // группа заявки разошлась со строкой снимка: место и подпись группы — из одной строки протокола
    await resultsDb(h).entries.updateOne({ _id: winner!.entryId }, { $set: { groupKey: 'm_u40' } });
    const results = h.app.get<ResultsForSharing>(RESULTS_FOR_SHARING);
    expect(await results.storyCardFacts(winner!.userId, published.raceId)).toMatchObject({
      status: 'final',
      provisional: false,
      place: 1,
      group: 'overall',
    });
  });
});

describe('приватность линии на настоящей сверке (AC3, AC6)', () => {
  it('линия карточки — отрезок попытки между воротами по trackMap.segment, без точек подъезда', async () => {
    const { raceId, userId, attempt, activityId, auth } = await riddenEntry();
    const results = h.worker.get<ResultsForSharing>(RESULTS_FOR_SHARING);
    const facts = await results.storyCardFacts(userId, raceId);
    expect(facts).toMatchObject({
      attempt: { id: attempt._id, checkRevision: attempt.checkRevision },
    });
    const [from, to] = attempt.trackMap!.segment!;
    const raw = await h.worker.get<ActivitySource>(ACTIVITY_SOURCE).trackLine(userId, activityId);
    const line = await results.storyCardLine(userId, facts!);
    expect(line).toEqual({ kind: 'attempt', line: sliceLine(raw!, from, to) });
    // ни одна точка линии активности до ворот старта и после ворот финиша не попала в карточку
    expect(from).toBeGreaterThan(0);
    const before = raw!.slice(0, Math.ceil(from));
    const after = raw!.slice(Math.floor(to) + 1);
    expect(before.length + after.length).toBeGreaterThan(0);
    const inside = new Set(line!.line.slice(1, -1).map((p) => p.join(',')));
    for (const point of [...before, ...after]) expect(inside.has(point.join(','))).toBe(false);

    // карточка рендерится с этой линией
    await status(auth, raceId);
    expect(await runJob()).toBe('ready');
    expect((await status(auth, raceId)).status).toBe('ready');
  });

  it('разметки нет — линия маршрута гонки', async () => {
    const { raceId, userId, attempt } = await riddenEntry();
    await resultsDb(h).attempts.updateOne({ _id: attempt._id }, { $unset: { trackMap: '' } });
    const results = h.worker.get<ResultsForSharing>(RESULTS_FOR_SHARING);
    const line = await results.storyCardLine(
      userId,
      (await results.storyCardFacts(userId, raceId))!,
    );
    expect(line?.kind).toBe('route');
  });
});
