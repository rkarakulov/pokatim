import type { Job } from 'bullmq';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { RIDE_INVITE_RENDER_JOB, STORY_CARD_RENDER_JOB } from './story-card.cache';
import { StoryCardProcessor } from './story-card.processor';

/** Диспетчер очереди `story-card`: имя задачи → схема данных → рендер своей карточки (зависимости не нужны). */
const processor = () =>
  new StoryCardProcessor(
    undefined as never,
    undefined as never,
    undefined as never,
    undefined as never,
    undefined as never,
  );

const job = (name: string, data: unknown, attemptsMade = 0) =>
  ({ id: 'job', name, data, attemptsMade, opts: { attempts: 2 } }) as unknown as Job<unknown>;

const story = { userId: 'u', raceId: 'r', template: 'line', hash: 'h' };
const invite = { userId: 'u', rideId: 'ride', template: 'night', hash: 'h' };

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
});
