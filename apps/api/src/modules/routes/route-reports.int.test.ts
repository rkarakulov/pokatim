import { Logger } from '@nestjs/common';
import { CatalogRouteViewer, RiderRouteModerationPage } from '@pokatim/contracts';
import { uuidv7 } from '@rkarakulov/api-kit/mongo';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { createHarness, type Harness } from '../../../test/harness';
import { call, holdTransaction, retried, untilBlocked } from '../../../test/identity';
import { staff } from '../../../test/races';
import { rider, type Rider } from '../../../test/rides';
import {
  moderationCall,
  publicationDoc,
  reportRoute,
  riderCall,
  routeReportsDb,
  routesDb,
  seedApprovedRiderRoute,
  seedRiderRoute,
} from '../../../test/routes';
import { ROUTE_POLICY } from './routes.policy';
import { RoutesRepository } from './routes.repository';

/**
 * Жалобы на маршруты райдеров в каталоге (routes-06, AC5, A4; N5): одна от пользователя, автор и маршрут команды —
 * отказ, не в каталоге — 404, лимит частоты; `me` — состояние зрителя; счётчик открытых жалоб — в той же транзакции,
 * запись маршрута первой (гонка с «Скрыть»).
 */
let h: Harness;
let author: Rider;
let a: Rider;
beforeAll(async () => {
  h = await createHarness();
});
beforeEach(async () => {
  await h.reset();
  author = await rider(h, 'author@example.by');
  a = await rider(h, 'a@example.by');
});
afterAll(async () => {
  await h.close();
});

const viewer = (who: Rider | undefined, id: string) =>
  riderCall(h, who?.token, 'GET', `/v1/routes/${id}/me`);
const publication = async (id: string) =>
  (await routesDb(h).routes.findOne({ _id: id }))?.publication;

/** Маршрут команды в каталоге (подготовка). */
async function teamRoute(): Promise<string> {
  const id = await seedRiderRoute(h, uuidv7(), {
    catalog: { city: 'minsk', surfaces: ['asphalt'], publishedAt: h.clock.now() },
  });
  await routesDb(h).routes.updateOne({ _id: id }, { $set: { origin: 'platform' } });
  return id;
}

describe('жалоба (AC5)', () => {
  it('200: reported; запись с причиной и комментарием; счётчик и время в маршруте; маршрут в очереди «Жалобы»', async () => {
    const id = await seedApprovedRiderRoute(h, author.userId);
    const res = await reportRoute(h, a.token, id, {
      reason: 'private_area',
      comment: ' Через двор ',
    });
    expect(res.status).toBe(200);
    expect(res.headers['cache-control']).toBe('no-store');
    expect(CatalogRouteViewer.parse(res.body)).toEqual({ canReport: false, reported: true });
    expect(await routeReportsDb(h).find().toArray()).toEqual([
      {
        _id: expect.any(String),
        routeId: id,
        reporterUserId: a.userId,
        reason: 'private_area',
        comment: 'Через двор',
        createdAt: h.clock.now(),
        resolvedAt: null,
        resolution: null,
        resolvedBy: null,
      },
    ]);
    expect(await publication(id)).toMatchObject({
      openReportCount: 1,
      lastReportAt: h.clock.now(),
      reportRevision: 1,
      version: 0,
    });
    const moderator = await staff(h, 'moderator@example.by', 'moderator');
    const queue = RiderRouteModerationPage.parse(
      (await moderationCall(h, moderator.token, 'GET', '?state=reported')).body,
    );
    expect(queue.items.map((item) => [item.id, item.topReason])).toEqual([[id, 'private_area']]);
  });

  it('повтор — 200 без второй записи (комментарий не меняется); параллельные дубли — одна запись; два райдера — счётчик 2', async () => {
    const id = await seedApprovedRiderRoute(h, author.userId);
    await reportRoute(h, a.token, id, { reason: 'spam' });
    const again = await reportRoute(h, a.token, id, { reason: 'other', comment: 'другое' });
    expect(again.status).toBe(200);
    expect(CatalogRouteViewer.parse(again.body).reported).toBe(true);
    expect(await routeReportsDb(h).countDocuments()).toBe(1);
    expect((await routeReportsDb(h).findOne())?.reason).toBe('spam');

    const b = await rider(h, 'b@example.by');
    const results = await Promise.all(
      Array.from({ length: 4 }, () => reportRoute(h, b.token, id, { reason: 'dangerous' })),
    );
    expect(results.map((res) => res.status)).toEqual([200, 200, 200, 200]);
    expect(await routeReportsDb(h).countDocuments({ reporterUserId: b.userId })).toBe(1);
    expect((await publication(id))?.openReportCount).toBe(2);
  });

  it('свой — 409 own_route; маршрут команды — 409 team_route; гость — 401; лишнее поле, чужая причина, > 500 — 400', async () => {
    const id = await seedApprovedRiderRoute(h, author.userId);
    const own = await reportRoute(h, author.token, id);
    expect(own.status).toBe(409);
    expect(own.body).toMatchObject({
      code: 'ROUTE_INVALID_STATE',
      details: { reason: 'own_route' },
    });
    const team = await reportRoute(h, a.token, await teamRoute());
    expect(team.status).toBe(409);
    expect(team.body).toMatchObject({
      code: 'ROUTE_INVALID_STATE',
      details: { reason: 'team_route' },
    });
    expect((await call(h, 'POST', `/v1/routes/${id}/reports`, { reason: 'spam' })).status).toBe(
      401,
    );
    for (const body of [
      { reason: 'spam', userId: a.userId },
      { reason: 'boring' },
      { reason: 'spam', comment: 'x'.repeat(501) },
    ]) {
      expect((await reportRoute(h, a.token, id, body)).status).toBe(400);
    }
    expect(await routeReportsDb(h).countDocuments()).toBe(0);
  });

  it('не в каталоге (pending, rejected, hidden, withdrawn, без заявки, неизвестный) — 404 и на me', async () => {
    const targets = [
      ...(await Promise.all(
        (['pending', 'rejected', 'hidden', 'withdrawn'] as const).map((status) =>
          seedRiderRoute(h, author.userId, {
            publication: publicationDoc(h, status),
            catalog: { city: 'minsk', surfaces: ['asphalt'], publishedAt: h.clock.now() },
          }),
        ),
      )),
      await seedRiderRoute(h, author.userId),
      uuidv7(),
    ];
    for (const id of targets) {
      expect((await reportRoute(h, a.token, id)).status, id).toBe(404);
      expect((await viewer(a, id)).status, id).toBe(404);
    }
    expect(await routeReportsDb(h).countDocuments()).toBe(0);
  });

  it('лимит routes-report: 21-я за сутки — 429 + retryAfterSec (повторы тоже считаются) (N5)', async () => {
    const id = await seedApprovedRiderRoute(h, author.userId);
    for (let i = 0; i < ROUTE_POLICY.reportLimit.limit; i += 1) {
      expect((await reportRoute(h, a.token, id)).status).toBe(200);
    }
    const limited = await reportRoute(h, a.token, id);
    expect(limited.status).toBe(429);
    expect(limited.body).toMatchObject({
      code: 'RATE_LIMITED',
      details: { retryAfterSec: expect.any(Number) },
    });
  });

  it('лог: id маршрута, пользователя и причина — без комментария', async () => {
    const id = await seedApprovedRiderRoute(h, author.userId, {}, 'Секретное название');
    const log = vi.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
    try {
      await reportRoute(h, a.token, id, { reason: 'other', comment: 'Секретный комментарий' });
      const lines = log.mock.calls.map((args) => String(args[0]));
      expect(lines).toContain(`routes.reported route=${id} uid=${a.userId} reason=other`);
      expect(lines.join('\n')).not.toMatch(/Секретн/);
    } finally {
      log.mockRestore();
    }
  });
});

describe('состояние зрителя GET /v1/routes/:id/me', () => {
  it('другой — canReport; после жалобы — reported; автор и маршрут команды — false/false; гость — 401; no-store', async () => {
    const id = await seedApprovedRiderRoute(h, author.userId);
    const before = await viewer(a, id);
    expect(before.status).toBe(200);
    expect(before.headers['cache-control']).toBe('no-store');
    expect(CatalogRouteViewer.parse(before.body)).toEqual({ canReport: true, reported: false });
    await reportRoute(h, a.token, id);
    expect(CatalogRouteViewer.parse((await viewer(a, id)).body)).toEqual({
      canReport: false,
      reported: true,
    });
    expect(CatalogRouteViewer.parse((await viewer(author, id)).body)).toEqual({
      canReport: false,
      reported: false,
    });
    expect(CatalogRouteViewer.parse((await viewer(a, await teamRoute())).body)).toEqual({
      canReport: false,
      reported: false,
    });
    expect((await viewer(undefined, id)).status).toBe(401);
    expect((await viewer(a, 'not-a-uuid')).status).toBe(400);
  });
});

describe('гонка «Скрыть ↔ жалоба» (запись маршрута первой)', () => {
  it('удерживаемое скрытие: жалоба повторяется и получает 404; открытых жалоб нет, счётчик 0', async () => {
    const id = await seedApprovedRiderRoute(h, author.userId);
    const repository = h.app.get(RoutesRepository, { strict: false });
    const spy = vi.spyOn(repository, 'recordRouteReport');
    const now = h.clock.now();
    const held = await holdTransaction(h, async (session) => {
      await routesDb(h).routes.updateOne(
        { _id: id },
        {
          $set: {
            'publication.status': 'hidden',
            'publication.hiddenAt': now,
            'publication.openReportCount': 0,
            catalog: null,
          },
          $inc: { 'publication.version': 1 },
        },
        { session },
      );
      await routeReportsDb(h).updateMany(
        { routeId: id, resolvedAt: null },
        { $set: { resolvedAt: now, resolution: 'hidden', resolvedBy: author.userId } },
        { session },
      );
    });
    const pending = reportRoute(h, a.token, id);
    await untilBlocked(pending, retried(spy));
    await held.commit();
    const res = await pending;
    spy.mockRestore();

    expect(res.status).toBe(404);
    expect((await publication(id))?.openReportCount).toBe(0);
    expect(await routeReportsDb(h).countDocuments({ routeId: id, resolvedAt: null })).toBe(0);
  });

  it('параллельно: жалобы и «Скрыть» — openReportCount = числу открытых жалоб', async () => {
    const moderator = await staff(h, 'moderator@example.by', 'moderator');
    for (let round = 0; round < 3; round += 1) {
      const id = await seedApprovedRiderRoute(h, author.userId);
      const reporters = await Promise.all(
        [1, 2, 3].map((i) => rider(h, `r${round}-${i}@example.by`)),
      );
      await Promise.all([
        ...reporters.map((who) => reportRoute(h, who.token, id)),
        moderationCall(h, moderator.token, 'POST', `/${id}/hide`, {
          version: 0,
          reason: 'Скрыть маршрут',
        }),
      ]);
      const open = await routeReportsDb(h).countDocuments({ routeId: id, resolvedAt: null });
      expect((await publication(id))?.openReportCount).toBe(open);
    }
  });
});
