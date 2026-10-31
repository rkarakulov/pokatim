import { Logger } from '@nestjs/common';
import type { Job } from 'bullmq';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { OG_FIXTURES } from '../../../test/og-fixtures';
import { OG_CARD_RENDER_JOB } from './og-card.cache';
import { ogCardHash, type OgCardInput } from './og-card.inputs';
import {
  ACHIEVEMENT_CARD_RENDER_JOB,
  type AchievementCardJob,
  RIDE_INVITE_RENDER_JOB,
  ROUTE_CARD_RENDER_JOB,
  STORY_CARD_RENDER_JOB,
} from './story-card.cache';
import { StoryCardProcessor } from './story-card.processor';

/** Диспетчер очереди `story-card`: имя задачи → схема данных → рендер своей карточки (зависимости не нужны). */
const processor = () =>
  new StoryCardProcessor(
    ...(Array.from({ length: 11 }, () => undefined) as unknown as ConstructorParameters<
      typeof StoryCardProcessor
    >),
  );

const job = (name: string, data: unknown, attemptsMade = 0) =>
  ({ id: 'job', name, data, attemptsMade, opts: { attempts: 2 } }) as unknown as Job<unknown>;

const story = { userId: 'u', raceId: 'r', template: 'line', hash: 'h' };
const invite = { userId: 'u', rideId: 'ride', template: 'night', hash: 'h' };
const achievement = { userId: 'u', code: 'race_win', template: 'line', hash: 'h' };
const og = { kind: 'ride', id: 'ride', hash: 'a'.repeat(64) };
const routeCard = {
  userId: 'u',
  routeId: '01a1744e-823f-7fc6-b68d-f2d921f7f69b',
  template: 'line',
  hash: 'h',
};

afterEach(() => {
  vi.restoreAllMocks();
});

describe('StoryCardProcessor.process', () => {
  it('сторис гонки → build, приглашение → buildRideInvite; последняя попытка — finalAttempt', async () => {
    const p = processor();
    const build = vi.spyOn(p, 'build').mockResolvedValue('ready');
    const buildRideInvite = vi.spyOn(p, 'buildRideInvite').mockResolvedValue('ready');
    expect(await p.process(job(STORY_CARD_RENDER_JOB, story))).toBe('ready');
    expect(build).toHaveBeenCalledWith(story, { finalAttempt: false });
    expect(await p.process(job(RIDE_INVITE_RENDER_JOB, invite, 1))).toBe('ready');
    expect(buildRideInvite).toHaveBeenCalledWith(invite, { finalAttempt: true });
    expect(build).toHaveBeenCalledTimes(1);
    expect(buildRideInvite).toHaveBeenCalledTimes(1);
  });

  it('данные не своей схемы — skipped без рендера; незнакомое имя — ошибка', async () => {
    const p = processor();
    const build = vi.spyOn(p, 'build');
    const buildRideInvite = vi.spyOn(p, 'buildRideInvite');
    expect(await p.process(job(STORY_CARD_RENDER_JOB, invite))).toBe('skipped');
    expect(await p.process(job(RIDE_INVITE_RENDER_JOB, story))).toBe('skipped');
    expect(build).not.toHaveBeenCalled();
    expect(buildRideInvite).not.toHaveBeenCalled();
    await expect(p.process(job('other', story))).rejects.toThrow('unknown job other');
  });

  it('OG-картинка → buildOgCard по имени задачи; чужая схема и бренд с кривым хэшем — skipped', async () => {
    const p = processor();
    const buildOgCard = vi.spyOn(p, 'buildOgCard').mockResolvedValue('ready');
    const build = vi.spyOn(p, 'build');
    expect(await p.process(job(OG_CARD_RENDER_JOB, og, 1))).toBe('ready');
    expect(buildOgCard).toHaveBeenCalledWith(og, { finalAttempt: true });
    expect(await p.process(job(OG_CARD_RENDER_JOB, story))).toBe('skipped');
    expect(await p.process(job(OG_CARD_RENDER_JOB, { ...og, kind: 'brand', hash: 'h' }))).toBe(
      'skipped',
    );
    // данные OG под именем сторис — не сторис
    expect(await p.process(job(STORY_CARD_RENDER_JOB, og))).toBe('skipped');
    expect(buildOgCard).toHaveBeenCalledTimes(1);
    expect(build).not.toHaveBeenCalled();
  });

  it('достижение → buildAchievementCard; незнакомый код и чужая схема — skipped', async () => {
    const p = processor();
    const buildAchievementCard = vi.spyOn(p, 'buildAchievementCard').mockResolvedValue('ready');
    expect(await p.process(job(ACHIEVEMENT_CARD_RENDER_JOB, achievement, 1))).toBe('ready');
    // задача до выката (без `seasonId`) — `seasonId: null`
    expect(buildAchievementCard).toHaveBeenCalledWith(
      { ...achievement, seasonId: null },
      { finalAttempt: true },
    );
    expect(
      await p.process(job(ACHIEVEMENT_CARD_RENDER_JOB, { ...achievement, code: 'nope' })),
    ).toBe('skipped');
    expect(await p.process(job(ACHIEVEMENT_CARD_RENDER_JOB, invite))).toBe('skipped');
    expect(await p.process(job(RIDE_INVITE_RENDER_JOB, achievement))).toBe('skipped');
    expect(buildAchievementCard).toHaveBeenCalledTimes(1);
  });
});

describe('StoryCardProcessor.buildAchievementCard — сезонное (achievement-season-story-card)', () => {
  const SEASON = '0190a6f4-0000-7000-8000-000000000301';
  const withInputs = () => {
    const resolve = vi.fn().mockResolvedValue(null);
    const release = vi.fn().mockResolvedValue(undefined);
    const args = Array.from({ length: 11 }, () => undefined) as unknown[];
    args[0] = { release };
    args[3] = { resolve };
    vi.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
    const p = new StoryCardProcessor(
      ...(args as unknown as ConstructorParameters<typeof StoryCardProcessor>),
    );
    return { p, resolve };
  };

  it('сезонная задача передаёт адрес с сезоном во входы; не получено — skipped', async () => {
    const { p, resolve } = withInputs();
    const data: AchievementCardJob = {
      userId: 'u',
      code: 'season_champion',
      seasonId: SEASON,
      template: 'line',
      hash: 'h',
    };
    expect(await p.buildAchievementCard(data)).toBe('skipped');
    expect(resolve).toHaveBeenCalledWith(
      'u',
      { code: 'season_champion', seasonId: SEASON },
      'line',
    );
  });

  it('код и сезон не сходятся — skipped без чтения входов', async () => {
    const { p, resolve } = withInputs();
    const data: AchievementCardJob = {
      userId: 'u',
      code: 'race_win',
      seasonId: SEASON,
      template: 'line',
      hash: 'h',
    };
    expect(await p.buildAchievementCard(data)).toBe('skipped');
    expect(resolve).not.toHaveBeenCalled();
  });
});

describe('StoryCardProcessor.process — карточка маршрута (route-story-card)', () => {
  it('route-card.render → buildRouteCard; чужая схема — skipped без рендера', async () => {
    const p = processor();
    const buildRouteCard = vi.spyOn(p, 'buildRouteCard').mockResolvedValue('ready');
    expect(await p.process(job(ROUTE_CARD_RENDER_JOB, routeCard, 1))).toBe('ready');
    expect(buildRouteCard).toHaveBeenCalledWith(routeCard, { finalAttempt: true });
    expect(await p.process(job(ROUTE_CARD_RENDER_JOB, invite))).toBe('skipped');
    expect(await p.process(job(ROUTE_CARD_RENDER_JOB, { ...routeCard, template: 'foo' }))).toBe(
      'skipped',
    );
    // данные маршрута под именем приглашения — не приглашение
    expect(await p.process(job(RIDE_INVITE_RENDER_JOB, routeCard))).toBe('skipped');
    expect(buildRouteCard).toHaveBeenCalledTimes(1);
  });
});

describe('StoryCardProcessor.buildOgCard — сезон и райдер (og-rider-season-dark)', () => {
  /** Процессор с входами OG одного объекта и кэшем-шпионом; остальные зависимости не нужны. */
  function ogProcessor(input: OgCardInput) {
    const hash = ogCardHash(input);
    const storeReady = vi.fn().mockResolvedValue(undefined);
    const deps = Array.from({ length: 11 }, () => undefined) as unknown[];
    deps[6] = { storeReady, release: vi.fn(), holdFailed: vi.fn() };
    deps[7] = { resolve: vi.fn().mockResolvedValue({ input, hash, version: hash.slice(0, 16) }) };
    deps[10] = { now: () => new Date('2026-10-22T09:00:00Z') };
    const p = new StoryCardProcessor(
      ...(deps as unknown as ConstructorParameters<typeof StoryCardProcessor>),
    );
    return { p, hash, storeReady };
  }

  it('без линии; лог райдера — префикс хэша вместо publicId', async () => {
    const log = vi.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
    const rider = OG_FIXTURES.rider;
    const { p, hash, storeReady } = ogProcessor(rider);
    expect(await p.buildOgCard({ kind: 'rider', id: rider.facts.publicId, hash })).toBe('ready');
    expect(storeReady).toHaveBeenCalledTimes(1);
    const lines = log.mock.calls.map(([message]) => String(message));
    expect(lines.join('\n')).not.toContain(rider.facts.publicId);
    expect(
      lines.some((line) => line.startsWith(`og rider ${hash.slice(0, 8)}: ready (no line)`)),
    ).toBe(true);
  });

  it('сезон — без линии, в логе id сезона', async () => {
    const log = vi.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
    const season = OG_FIXTURES.season;
    const { p, hash } = ogProcessor(season);
    expect(await p.buildOgCard({ kind: 'season', id: season.facts.seasonId, hash })).toBe('ready');
    const lines = log.mock.calls.map(([message]) => String(message));
    expect(
      lines.some((line) => line.startsWith(`og season ${season.facts.seasonId}: ready (no line)`)),
    ).toBe(true);
  });
});
