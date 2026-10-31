import { getQueueToken } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { InviteCodeResponse, StoryCardStatus } from '@pokatim/contracts';
import type { Job, Queue } from 'bullmq';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { createHarness, type Harness } from '../../../test/harness';
import { authed, rider, seedTeamRoute, type Rider } from '../../../test/rides';
import { QUEUE } from '../../queues';
import { InviteCodes } from '../social';
import { RouteCardInputs, routeCardHash } from './route-card.inputs';
import { ROUTE_CARD_RENDER_JOB, type RouteCardJob } from './story-card.cache';
import { StoryCardProcessor } from './story-card.processor';

/**
 * Короткая ссылка приглашения на карточках (P6, AC4, RC-P6-5/6): с `APP_WEB_ORIGIN` HTTP кладёт адрес
 * `<host>/i/<код>` в данные задачи и хэш, worker рендерит с адресом из задачи; сбой кодов — без адреса. Образец —
 * карточка маршрута (общий путь `InviteAddress` у всех четырёх видов).
 */
let h: Harness;
let viewer: Rider;
let other: Rider;
beforeAll(async () => {
  h = await createHarness({ APP_WEB_ORIGIN: 'https://pokatim.by' });
});
beforeEach(async () => {
  await h.reset();
  viewer = await rider(h, 'viewer@example.by');
  other = await rider(h, 'other@example.by');
});
afterEach(() => {
  vi.restoreAllMocks();
});
afterAll(async () => {
  await h.close();
});

const queue = () => h.app.get<Queue>(getQueueToken(QUEUE.storyCard));
const cardUrl = (routeId: string) => `/v1/routes/${routeId}/story-card?template=line`;

async function status(who: Rider, routeId: string) {
  const res = await authed(h, who, 'GET', cardUrl(routeId));
  expect(res.status, JSON.stringify(res.body)).toBe(200);
  return StoryCardStatus.parse(res.body);
}

async function takeJob(): Promise<RouteCardJob> {
  const [job] = await queue().getJobs(['waiting', 'delayed', 'active']);
  expect(job?.name).toBe(ROUTE_CARD_RENDER_JOB);
  await job!.remove();
  return (job as Job<RouteCardJob>).data;
}

async function inviteCode(who: Rider): Promise<string> {
  const res = await authed(h, who, 'GET', '/v1/social/invite-code');
  return InviteCodeResponse.parse(res.body).code;
}

describe('адрес /i/<код> на карточке (AC4)', () => {
  it('адрес владельца в задаче и хэше; worker рендерит с ним; у другого зрителя — своя картинка', async () => {
    const routeId = await seedTeamRoute(h);
    expect(await status(viewer, routeId)).toEqual({ status: 'pending' });
    const job = await takeJob();
    expect(job.address).toBe(`pokatim.by/i/${await inviteCode(viewer)}`);

    expect(await h.worker.get(StoryCardProcessor).buildRouteCard(job)).toBe('ready');
    expect((await status(viewer, routeId)).status).toBe('ready');

    // карточка с адресом личная: другой зритель — другой хэш и своя задача
    expect(await status(other, routeId)).toEqual({ status: 'pending' });
    const otherJob = await takeJob();
    expect(otherJob.address).toBe(`pokatim.by/i/${await inviteCode(other)}`);
    expect(otherJob.hash).not.toBe(job.hash);
  });

  it('хэш задачи = хэш входов с адресом из задачи (worker не пересчитывает адрес)', async () => {
    const routeId = await seedTeamRoute(h);
    await status(viewer, routeId);
    const job = await takeJob();
    const ensure = vi.spyOn(h.worker.get(InviteCodes), 'ensureOf');
    expect(await h.worker.get(StoryCardProcessor).buildRouteCard(job)).toBe('ready');
    expect(ensure).not.toHaveBeenCalled();
    // адрес — часть ключа: тот же вход без адреса дал бы другой хэш
    expect(job.hash).not.toBe(routeCardHash({ ...(await inputsOf(job)), address: null }));
  });

  it('сбой кодов — адрес null, карточка рендерится', async () => {
    const warn = vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    vi.spyOn(h.app.get(InviteCodes, { strict: false }), 'ensureOf').mockRejectedValue(
      new Error('boom'),
    );
    const routeId = await seedTeamRoute(h);
    await status(viewer, routeId);
    const job = await takeJob();
    expect(job.address).toBeNull();
    expect(await h.worker.get(StoryCardProcessor).buildRouteCard(job)).toBe('ready');
    expect(
      warn.mock.calls.some(([message]) => String(message).includes('invite_address_failed')),
    ).toBe(true);
  });
});

async function inputsOf(job: RouteCardJob) {
  const resolved = await h.worker
    .get(RouteCardInputs)
    .resolve(job.userId, job.routeId, job.template, job.address);
  if (!resolved) throw new Error('нет входов');
  expect(resolved.hash).toBe(job.hash);
  return resolved.input;
}
