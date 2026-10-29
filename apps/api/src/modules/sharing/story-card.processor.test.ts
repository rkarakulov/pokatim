import type { Job } from 'bullmq';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { OG_CARD_RENDER_JOB } from './og-card.cache';
import {
  ACHIEVEMENT_CARD_RENDER_JOB,
  RIDE_INVITE_RENDER_JOB,
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
    expect(buildAchievementCard).toHaveBeenCalledWith(achievement, { finalAttempt: true });
    expect(
      await p.process(job(ACHIEVEMENT_CARD_RENDER_JOB, { ...achievement, code: 'nope' })),
    ).toBe('skipped');
    expect(await p.process(job(ACHIEVEMENT_CARD_RENDER_JOB, invite))).toBe('skipped');
    expect(await p.process(job(RIDE_INVITE_RENDER_JOB, achievement))).toBe('skipped');
    expect(buildAchievementCard).toHaveBeenCalledTimes(1);
  });
});
