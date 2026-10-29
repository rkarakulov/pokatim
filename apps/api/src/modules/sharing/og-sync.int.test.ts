import { getQueueToken } from '@nestjs/bullmq';
import type { Job, Queue } from 'bullmq';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { createHarness, DAY, type Harness } from '../../../test/harness';
import { seedRace, seedStart, startsDb } from '../../../test/og';
import { createRide, hideInDb, rider, type Rider } from '../../../test/rides';
import { QUEUE } from '../../queues';
import { CALENDAR_FOR_SHARING, type CalendarForSharing } from '../calendar';
import { OgCardCache, type OgCardJob } from './og-card.cache';
import { OgSync, ogSweepMark } from './og-sync';
import { OG_CARD_POLICY } from './sharing.policy';
import { StoryCardProcessor } from './story-card.processor';

/**
 * Пререндер OG-картинок `og.sync` (og-images, AC3): изменившиеся публичные объекты получают задачу рендера без
 * HTTP; курсоры, лимиты пачки, полный проход при смене версии рендера/темы, сбой вида. Redis и MongoDB — настоящие.
 */
let h: Harness;
let organizer: Rider;
beforeAll(async () => {
  h = await createHarness();
});
beforeEach(async () => {
  await h.reset();
  organizer = await rider(h, 'org@example.by');
});
afterEach(() => {
  vi.restoreAllMocks();
});
afterAll(async () => {
  await h.close();
});

const sync = () => h.worker.get(OgSync);
const queue = () => h.app.get<Queue>(getQueueToken(QUEUE.storyCard));
const jobs = async () =>
  (await queue().getJobs(['waiting', 'prioritized', 'delayed', 'active'])) as Job<OgCardJob>[];
const queued = async () => (await jobs()).map((job) => `${job.data.kind}:${job.data.id}`).sort();
const cache = () => h.worker.get(OgCardCache);

/** Отрисовать всё поставленное (как worker) и очистить очередь. */
async function renderAll(): Promise<void> {
  for (const job of await jobs()) {
    await job.remove();
    await h.worker.get(StoryCardProcessor).buildOgCard(job.data);
  }
}

describe('og.sync (AC3)', () => {
  it('новый публичный объект → задача без HTTP, курсор сдвинут; второй прогон — пусто; бренд — один раз', async () => {
    const race = await seedRace(h);
    const start = await seedStart(h);
    const draft = await seedRace(h, { status: 'draft' });
    const hidden = await createRide(h, organizer);
    await hideInDb(h, hidden.id);

    const first = await sync().run();
    expect(first).toMatchObject({ reset: true, brand: true, enqueued: 3, failedKinds: [] });
    expect(await queued()).toEqual([`brand:site`, `calendar:${start}`, `race:${race}`].sort());
    expect(await queued()).not.toContain(`race:${draft}`);
    expect(await cache().cursor('race')).toMatchObject({ id: race });

    await renderAll();
    expect(await sync().run()).toMatchObject({ reset: false, brand: false, enqueued: 0 });
    expect(await jobs()).toHaveLength(0);
  });

  it('правка названия → новая задача; PNG уже есть — пропуск', async () => {
    const start = await seedStart(h);
    await sync().run();
    await renderAll();
    h.clock.advance(60_000);
    await startsDb(h).updateOne(
      { _id: start },
      { $set: { title: 'Новое название', updatedAt: h.clock.now() } },
    );
    expect(await sync().run()).toMatchObject({ enqueued: 1 });
    expect(await queued()).toEqual([`calendar:${start}`]);
    await renderAll();
    // курсор сброшен вручную — объект снова в выборке, но PNG текущего хэша есть
    await cache().resetCursors();
    expect(await sync().run()).toMatchObject({ enqueued: 0, scanned: { calendar: 1 } });
  });

  it('«неживые» объекты (вариант A) не пререндерятся', async () => {
    await seedRace(h, {
      windowStartsAt: new Date(h.clock.now().getTime() - 60 * DAY),
      windowEndsAt: new Date(h.clock.now().getTime() - 40 * DAY),
    });
    const run = await sync().run();
    expect(run.scanned.race).toBe(1);
    expect(await queued()).toEqual(['brand:site']);
  });

  it('syncRenderLimit: курсор — на последней обработанной строке, остаток — следующим прогоном', async () => {
    const policy = OG_CARD_POLICY as unknown as { syncRenderLimit: number };
    const limit = policy.syncRenderLimit;
    policy.syncRenderLimit = 3;
    try {
      const ids = [];
      for (let i = 0; i < 4; i += 1) {
        h.clock.advance(1000);
        ids.push(await seedStart(h, { updatedAt: h.clock.now() }));
      }
      // бренд + 2 старта
      expect(await sync().run()).toMatchObject({ enqueued: 3 });
      expect(await cache().cursor('calendar')).toMatchObject({ id: ids[1] });
      await renderAll();
      expect(await sync().run()).toMatchObject({ enqueued: 2 });
      expect(await queued()).toEqual([`calendar:${ids[2]}`, `calendar:${ids[3]}`].sort());
    } finally {
      policy.syncRenderLimit = limit;
    }
  });

  it('смена renderVersion или подменённый og:sweep → курсоры сброшены, полный проход', async () => {
    const start = await seedStart(h);
    await sync().run();
    await renderAll();
    expect(await sync().run()).toMatchObject({ reset: false, enqueued: 0 });

    await h.redis.set('og:sweep', 'chrono:1');
    expect(await sync().run()).toMatchObject({
      reset: true,
      enqueued: 0,
      scanned: { calendar: 1 },
    });
    expect(await cache().sweep()).toBe(ogSweepMark());

    const policy = OG_CARD_POLICY as unknown as { renderVersion: number };
    const version = policy.renderVersion;
    policy.renderVersion = version + 1;
    try {
      expect(await sync().run()).toMatchObject({ reset: true, brand: true, enqueued: 2 });
      expect(await queued()).toEqual(['brand:site', `calendar:${start}`]);
    } finally {
      policy.renderVersion = version;
    }
  });

  it('сбой одного вида — остальные прошли, курсор вида не сдвинут, задача падает', async () => {
    const race = await seedRace(h);
    await seedStart(h);
    vi.spyOn(h.worker.get<CalendarForSharing>(CALENDAR_FOR_SHARING), 'ogChanged').mockRejectedValue(
      new Error('boom'),
    );
    await expect(sync().run()).rejects.toThrow('og.sync failed: calendar');
    expect(await queued()).toEqual(['brand:site', `race:${race}`].sort());
    expect(await cache().cursor('race')).toMatchObject({ id: race });
    expect(await cache().cursor('calendar')).toBeNull();
  });

  it('сбой одной строки — строка пропущена, курсор идёт дальше, прогон не падает (ревью F3)', async () => {
    const a = await seedStart(h, { updatedAt: new Date(h.clock.now().getTime() - 2000) });
    const b = await seedStart(h, { updatedAt: new Date(h.clock.now().getTime() - 1000) });
    const port = h.worker.get<CalendarForSharing>(CALENDAR_FOR_SHARING);
    const ogFacts = port.ogFacts.bind(port);
    vi.spyOn(port, 'ogFacts').mockImplementation((id) =>
      id === a ? Promise.reject(new Error('poison')) : ogFacts(id),
    );
    const run = await sync().run();
    expect(run).toMatchObject({ failedKinds: [], scanned: { calendar: 2 } });
    expect(await queued()).toEqual(['brand:site', `calendar:${b}`].sort());
    expect(await cache().cursor('calendar')).toMatchObject({ id: b });
  });

  it('скрытие после пререндера — картинка 404 (выдача пересчитывает видимость)', async () => {
    const ride = await createRide(h, organizer);
    await sync().run();
    await renderAll();
    const card = await h.app.inject({ method: 'GET', url: `/v1/og/cards/ride/${ride.id}` });
    const { version } = card.json<{ version: string }>();
    const url = `/v1/og/images/ride/${ride.id}/${version}.png`;
    expect((await h.app.inject({ method: 'GET', url })).statusCode).toBe(200);
    await hideInDb(h, ride.id);
    const res = await h.app.inject({ method: 'GET', url });
    expect(res.statusCode).toBe(404);
    expect(res.headers['content-type']).toContain('application/json');
  });
});
