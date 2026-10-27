import {
  type AuditAction,
  RiderRouteModerationDetail,
  RiderRouteModerationPage,
} from '@pokatim/contracts';
import { MongoOutboxPublisher, uuidv7 } from '@rkarakulov/api-kit/mongo';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { createHarness, type Harness, MINUTE } from '../../../test/harness';
import { call, outboxEvents } from '../../../test/identity';
import { panel } from '../../../test/panel';
import { staff } from '../../../test/races';
import { rider, type Rider } from '../../../test/rides';
import {
  moderationCall,
  MY_ROUTES,
  publicationDoc,
  reportRoute,
  RIDER_ROUTES,
  riderCall,
  routeReportsDb,
  routesDb,
  seedRiderRoute,
  submissionBody,
  submitPublication,
  withdrawPublication,
} from '../../../test/routes';
import { PanelAudit } from '../panel';
import { ROUTE_PUBLICATION_DECIDED } from './routes.events';

/**
 * Модерация маршрутов райдеров в панели (routes-06, AC2, AC3, AC5; N4, N7, N8): права `routes.moderate`, очереди и
 * курсоры, карточка без имени автора, одобрить/отклонить/скрыть/вернуть/отклонить жалобы — запись маршрута, жалобы,
 * журнал и outbox в одной транзакции; конфликты версий и гонка с отзывом автора.
 */
let h: Harness;
let author: Rider;
let moderator: { userId: string; token: string };
beforeAll(async () => {
  h = await createHarness({ TRUST_PROXY: '1' });
});
beforeEach(async () => {
  await h.reset();
  author = await rider(h, 'author@example.by');
  moderator = await staff(h, 'moderator@example.by', 'moderator');
});
afterAll(async () => {
  await h.close();
});

const mod = (method: 'GET' | 'POST', path: string, body?: unknown) =>
  moderationCall(h, moderator.token, method, path, body);
const detailOf = async (id: string) => {
  const res = await mod('GET', `/${id}`);
  expect(res.status, JSON.stringify(res.body)).toBe(200);
  return RiderRouteModerationDetail.parse(res.body);
};
const queue = async (query = '') => RiderRouteModerationPage.parse((await mod('GET', query)).body);
const catalogIds = async () =>
  ((await call(h, 'GET', '/v1/routes')).body as { items: { id: string }[] }).items.map(
    (item) => item.id,
  );
const auditOf = (action: AuditAction) => panel(h).audit.find({ action }).toArray();

/** Маршрут автора, поданный через API. */
async function submitted(body = submissionBody()): Promise<string> {
  const id = await seedRiderRoute(h, author.userId);
  const res = await submitPublication(h, author.token, id, body);
  if (res.status !== 200) throw new Error(`подача: ${res.status} ${JSON.stringify(res.body)}`);
  return id;
}

async function approved(): Promise<string> {
  const id = await submitted();
  const res = await mod('POST', `/${id}/approve`, {
    version: 0,
    city: 'minsk',
    surfaces: ['asphalt'],
  });
  if (res.status !== 200) throw new Error(`одобрение: ${res.status}`);
  return id;
}

let reporterSeq = 0;
async function reportBy(id: string, reason = 'dangerous', comment: string | null = null) {
  const who = await rider(h, `reporter${++reporterSeq}@example.by`);
  const res = await reportRoute(h, who.token, id, { reason, comment });
  if (res.status !== 200) throw new Error(`жалоба: ${res.status} ${JSON.stringify(res.body)}`);
  return who;
}

describe('права (N4)', () => {
  it('без сессии — 401; organizer (races.manage) — 403 на все 7 путей; moderator и admin — 200, no-store', async () => {
    const id = await submitted();
    const paths: ['GET' | 'POST', string][] = [
      ['GET', ''],
      ['GET', `/${id}`],
      ['POST', `/${id}/approve`],
      ['POST', `/${id}/reject`],
      ['POST', `/${id}/hide`],
      ['POST', `/${id}/restore`],
      ['POST', `/${id}/dismiss-reports`],
    ];
    const organizer = await staff(h, 'org@example.by', 'organizer');
    for (const [method, path] of paths) {
      expect((await moderationCall(h, undefined, method, path, {})).status, path).toBe(401);
      expect((await moderationCall(h, organizer.token, method, path, {})).status, path).toBe(403);
    }
    // токен приложения райдера панели не открывает
    expect(
      (await call(h, 'GET', RIDER_ROUTES, undefined, { authorization: `Bearer ${author.token}` }))
        .status,
    ).toBe(401);
    const admin = await staff(h, 'admin@example.by', 'admin');
    for (const token of [moderator.token, admin.token]) {
      const res = await moderationCall(h, token, 'GET', '');
      expect(res.status).toBe(200);
      expect(res.headers['cache-control']).toBe('no-store');
    }
    expect((await routesDb(h).routes.findOne({ _id: id }))?.publication?.status).toBe('pending');
  });
});

describe('очереди и карточка (A5)', () => {
  it('«На проверке» — старые сверху, курсор; «Жалобы» — новые жалобы сверху, только опубликованные; «Скрытые» — недавно скрытые сверху', async () => {
    const first = await submitted();
    h.clock.advance(MINUTE);
    const second = await submitted();
    h.clock.advance(MINUTE);
    const third = await submitted();
    const page1 = await queue('?limit=2');
    expect(page1.items.map((item) => item.id)).toEqual([first, second]);
    const page2 = await queue(`?limit=2&cursor=${page1.nextCursor}`);
    expect(page2.items.map((item) => item.id)).toEqual([third]);
    expect(page2.nextCursor).toBeNull();
    expect(page1.items[0]).toMatchObject({
      authorUserId: author.userId,
      status: 'pending',
      city: 'minsk',
      surfaces: ['asphalt'],
      distanceM: 1300,
      openReportCount: 0,
      topReason: null,
    });

    for (const id of [first, second, third]) {
      expect(
        (await mod('POST', `/${id}/approve`, { version: 0, city: 'minsk', surfaces: ['asphalt'] }))
          .status,
      ).toBe(200);
    }
    expect((await queue()).items).toEqual([]);
    await reportBy(first, 'spam');
    h.clock.advance(MINUTE);
    await reportBy(second, 'private_area');
    await reportBy(second, 'spam');
    await reportBy(second, 'private_area');
    h.clock.advance(MINUTE);
    await reportBy(third);
    const reported = await queue('?state=reported&limit=2');
    expect(reported.items.map((item) => [item.id, item.openReportCount, item.topReason])).toEqual([
      [third, 1, 'dangerous'],
      [second, 3, 'private_area'],
    ]);
    const reported2 = await queue(`?state=reported&limit=2&cursor=${reported.nextCursor}`);
    expect(reported2.items.map((item) => item.id)).toEqual([first]);

    // снят автором — из очереди жалоб уходит (жалобы остаются открытыми, 8.1 RC-4)
    expect((await withdrawPublication(h, author.token, first)).status).toBe(200);
    expect((await queue('?state=reported')).items.map((item) => item.id)).toEqual([third, second]);
    expect(await routeReportsDb(h).countDocuments({ routeId: first, resolvedAt: null })).toBe(1);

    const hideBody = { reason: 'Жалобы подтвердились' };
    expect((await mod('POST', `/${second}/hide`, { version: 1, ...hideBody })).status).toBe(200);
    h.clock.advance(MINUTE);
    expect((await mod('POST', `/${third}/hide`, { version: 1, ...hideBody })).status).toBe(200);
    expect((await queue('?state=hidden')).items.map((item) => item.id)).toEqual([third, second]);
    expect((await queue('?state=reported')).items).toEqual([]);
  });

  it('карточка: линия, цифры, профиль; жалобы новые сверху без автора; без имени автора (N8); 404 — отозванный, не подававшийся, команды, неизвестный', async () => {
    await h.db.collection<Record<string, unknown> & { _id: string }>('profiles').insertOne({
      _id: author.userId,
      rideReasons: [],
      surveyCompletedAt: null,
      publicName: 'Секретное Имя',
      showNameInResults: true,
    });
    const id = await submitted(submissionBody({ showAuthorName: true }));
    expect(
      (await mod('POST', `/${id}/approve`, { version: 0, city: 'minsk', surfaces: ['asphalt'] }))
        .status,
    ).toBe(200);
    const who = await reportBy(id, 'spam', 'Реклама магазина');
    const res = await mod('GET', `/${id}`);
    expect(JSON.stringify(res.body)).not.toContain('Секретное Имя');
    expect(JSON.stringify(res.body)).not.toContain(who.userId);
    expect(Object.keys(res.body as object).sort()).toEqual(
      Object.keys(RiderRouteModerationDetail.shape).sort(),
    );
    const detail = RiderRouteModerationDetail.parse(res.body);
    expect(detail).toMatchObject({
      id,
      authorUserId: author.userId,
      showAuthorName: true,
      status: 'approved',
      submissionCount: 1,
      version: 1,
      distanceM: 1300,
      isLoop: false,
      openReportCount: 1,
      elevation: null,
    });
    expect(detail.line).toHaveLength(3);
    expect(detail.reports).toEqual([
      {
        id: expect.any(String),
        reason: 'spam',
        comment: 'Реклама магазина',
        createdAt: h.clock.now().toISOString(),
        resolution: null,
        resolvedAt: null,
      },
    ]);
    expect(JSON.stringify((await queue('?state=reported')).items)).not.toContain('Секретное Имя');

    const withdrawn = await submitted();
    expect((await withdrawPublication(h, author.token, withdrawn)).status).toBe(200);
    const never = await seedRiderRoute(h, author.userId);
    const team = await seedRiderRoute(h, author.userId, {
      publication: publicationDoc(h, 'pending'),
    });
    await routesDb(h).routes.updateOne({ _id: team }, { $set: { origin: 'platform' } });
    for (const target of [withdrawn, never, team, uuidv7()]) {
      expect((await mod('GET', `/${target}`)).status, target).toBe(404);
      const act = await mod('POST', `/${target}/approve`, {
        version: 0,
        city: 'minsk',
        surfaces: ['asphalt'],
      });
      expect(act.status, target).toBe(404);
    }
    expect((await mod('GET', '/not-a-uuid')).status).toBe(400);
  });
});

describe('одобрение и отклонение (AC2, AC3)', () => {
  it('одобрить с правкой города — в каталоге и чипах; журнал changedFields; outbox approved — ровно 4 ключа, без маршрута в очередь', async () => {
    const id = await submitted(submissionBody({ city: 'minsk', surfaces: ['asphalt'] }));
    const res = await mod('POST', `/${id}/approve`, {
      version: 0,
      city: 'brest',
      surfaces: ['asphalt'],
    });
    expect(res.status).toBe(200);
    const detail = RiderRouteModerationDetail.parse(res.body);
    expect(detail).toMatchObject({
      status: 'approved',
      city: 'brest',
      version: 1,
      decidedAt: h.clock.now().toISOString(),
      approvedAt: h.clock.now().toISOString(),
    });
    expect(await catalogIds()).toEqual([id]);
    expect(
      ((await call(h, 'GET', '/v1/routes/cities')).body as { cities: string[] }).cities,
    ).toEqual(['brest']);
    expect(await routesDb(h).routes.findOne({ _id: id })).toMatchObject({
      catalog: { city: 'brest', surfaces: ['asphalt'], publishedAt: h.clock.now() },
    });

    const [entry] = await auditOf('route.submission_approved');
    expect(entry).toMatchObject({
      actor: { kind: 'user', userId: moderator.userId },
      targetUserId: null,
      reason: null,
      subject: { kind: 'route', id, label: 'Мой маршрут' },
      details: { changedFields: ['city'] },
    });

    const events = (await outboxEvents(h)).filter(
      (event) => event.type === ROUTE_PUBLICATION_DECIDED,
    );
    expect(events).toHaveLength(1);
    expect(events[0]!.payload).toEqual({
      routeId: id,
      authorUserId: author.userId,
      decision: 'approved',
      decidedAt: h.clock.now().toISOString(),
    });
    await h.worker.get(MongoOutboxPublisher).publishBatch();
    const after = (await outboxEvents(h)).find((event) => event.type === ROUTE_PUBLICATION_DECIDED);
    expect(after?.publishedAt).toBeNull();

    // без правки — details: null
    const plain = await submitted();
    await mod('POST', `/${plain}/approve`, { version: 0, city: 'minsk', surfaces: ['asphalt'] });
    const entries = await auditOf('route.submission_approved');
    expect(entries.find((item) => item.subject?.id === plain)?.details).toBeNull();
  });

  it('отклонить с причиной и комментарием — автору видна причина; в каталоге нет; журнал и outbox rejected', async () => {
    const id = await submitted();
    const res = await mod('POST', `/${id}/reject`, {
      version: 0,
      reason: 'bad_title',
      comment: ' Название с рекламой ',
    });
    expect(res.status).toBe(200);
    expect(RiderRouteModerationDetail.parse(res.body)).toMatchObject({
      status: 'rejected',
      rejection: { reason: 'bad_title', comment: 'Название с рекламой' },
      version: 1,
    });
    expect(await catalogIds()).toEqual([]);
    const mine = await call(h, 'GET', `/v1/routes/mine/${id}`, undefined, {
      authorization: `Bearer ${author.token}`,
    });
    expect((mine.body as { publication: unknown }).publication).toMatchObject({
      status: 'rejected',
      rejection: { reason: 'bad_title', comment: 'Название с рекламой' },
    });
    const [entry] = await auditOf('route.submission_rejected');
    expect(entry).toMatchObject({
      reason: 'Название с рекламой',
      details: { rejectionReason: 'bad_title' },
      subject: { kind: 'route', id },
    });
    const events = (await outboxEvents(h)).filter(
      (event) => event.type === ROUTE_PUBLICATION_DECIDED,
    );
    expect(events.map((event) => event.payload)).toEqual([
      {
        routeId: id,
        authorUserId: author.userId,
        decision: 'rejected',
        decidedAt: h.clock.now().toISOString(),
      },
    ]);
    // тело: чужая причина, комментарий > 500, лишнее поле — 400
    const other = await submitted();
    for (const body of [
      { version: 0, reason: 'spam' },
      { version: 0, reason: 'other', comment: 'a'.repeat(501) },
      { version: 0, reason: 'other', extra: 1 },
    ]) {
      expect((await mod('POST', `/${other}/reject`, body)).status).toBe(400);
    }
  });
});

describe('скрыть, вернуть, отклонить жалобы (AC5)', () => {
  it('скрыть — вне каталога, жалобы закрыты hidden, журнал reportCount; вернуть — прежний publishedAt, жалобы не трогает', async () => {
    const id = await approved();
    const publishedAt = h.clock.now();
    await reportBy(id);
    await reportBy(id, 'spam');
    h.clock.advance(MINUTE);
    const hidden = await mod('POST', `/${id}/hide`, { version: 1, reason: 'Опасный участок' });
    expect(hidden.status).toBe(200);
    expect(RiderRouteModerationDetail.parse(hidden.body)).toMatchObject({
      status: 'hidden',
      hiddenAt: h.clock.now().toISOString(),
      openReportCount: 0,
      version: 2,
    });
    expect(await catalogIds()).toEqual([]);
    expect((await call(h, 'GET', `/v1/routes/${id}`)).status).toBe(404);
    expect(await routeReportsDb(h).countDocuments({ routeId: id, resolution: 'hidden' })).toBe(2);
    expect((await auditOf('route.rider_hidden'))[0]).toMatchObject({
      reason: 'Опасный участок',
      details: { reportCount: 2 },
    });

    h.clock.advance(MINUTE);
    const restored = await mod('POST', `/${id}/restore`, {
      version: 2,
      reason: 'Участок исправлен',
    });
    expect(restored.status).toBe(200);
    expect(RiderRouteModerationDetail.parse(restored.body)).toMatchObject({
      status: 'approved',
      hiddenAt: null,
      version: 3,
    });
    expect(await routesDb(h).routes.findOne({ _id: id })).toMatchObject({
      catalog: { city: 'minsk', surfaces: ['asphalt'], publishedAt },
    });
    expect(await catalogIds()).toEqual([id]);
    expect((await auditOf('route.rider_restored'))[0]).toMatchObject({
      reason: 'Участок исправлен',
      details: null,
    });
  });

  it('отклонить жалобы — dismissed, маршрут в каталоге, version прежняя, вне очереди; журнал', async () => {
    const id = await approved();
    await reportBy(id);
    const before = await detailOf(id);
    const res = await mod('POST', `/${id}/dismiss-reports`, {
      version: before.version,
      reason: 'Жалобы ложные',
      reportRevision: before.reportRevision,
    });
    expect(res.status).toBe(200);
    expect(RiderRouteModerationDetail.parse(res.body)).toMatchObject({
      status: 'approved',
      openReportCount: 0,
      version: before.version,
    });
    expect(await routeReportsDb(h).countDocuments({ routeId: id, resolution: 'dismissed' })).toBe(
      1,
    );
    expect(await catalogIds()).toEqual([id]);
    expect((await queue('?state=reported')).items).toEqual([]);
    expect((await auditOf('route.rider_reports_dismissed'))[0]).toMatchObject({
      reason: 'Жалобы ложные',
      details: { reportCount: 1 },
    });
  });
});

describe('конфликты (N7)', () => {
  it('повторное решение: устаревшая version — 409 CONFLICT, актуальная — 409 ROUTE_INVALID_STATE; без записи журнала', async () => {
    const id = await submitted();
    expect(
      (await mod('POST', `/${id}/approve`, { version: 0, city: 'minsk', surfaces: ['asphalt'] }))
        .status,
    ).toBe(200);
    const audits = await panel(h).audit.countDocuments();
    for (const [body, code] of [
      [{ version: 0, city: 'minsk', surfaces: ['asphalt'] }, 'CONFLICT'],
      [{ version: 1, city: 'minsk', surfaces: ['asphalt'] }, 'ROUTE_INVALID_STATE'],
    ] as const) {
      const res = await mod('POST', `/${id}/approve`, body);
      expect(res.status).toBe(409);
      expect(res.body).toMatchObject({ code });
    }
    const reject = await mod('POST', `/${id}/reject`, { version: 1, reason: 'other' });
    expect(reject.body).toMatchObject({ code: 'ROUTE_INVALID_STATE' });
    const restore = await mod('POST', `/${id}/restore`, { version: 1, reason: 'Вернуть' });
    expect(restore.body).toMatchObject({ code: 'ROUTE_INVALID_STATE' });
    const dismiss = await mod('POST', `/${id}/dismiss-reports`, {
      version: 1,
      reason: 'Жалоб нет',
      reportRevision: 0,
    });
    expect(dismiss.body).toMatchObject({ code: 'ROUTE_INVALID_STATE' });
    const hidePending = await mod('POST', `/${await submitted()}/hide`, {
      version: 0,
      reason: 'Скрыть',
    });
    expect(hidePending.body).toMatchObject({ code: 'ROUTE_INVALID_STATE' });
    expect(await panel(h).audit.countDocuments()).toBe(audits);
  });

  // новая жалоба — монотонная `reportRevision` (`$inc`), не время: задержанная жалоба с более ранним `now` и жалоба в ту
  // же миллисекунду тоже дают конфликт (ревью pass 1)
  it.each([
    ['позже', MINUTE],
    ['в ту же миллисекунду', 0],
    ['задержанная, с более ранним временем', -MINUTE],
  ])(
    '«Отклонить жалобы» после новой жалобы (%s) — 409 CONFLICT, жалобы открыты',
    async (_, shift) => {
      const id = await approved();
      const late = await rider(h, 'late-reporter@example.by');
      h.clock.advance(MINUTE);
      await reportBy(id);
      const seen = await detailOf(id);
      expect(seen.reportRevision).toBe(1);
      h.clock.advance(shift);
      expect((await reportRoute(h, late.token, id, { reason: 'spam' })).status).toBe(200);
      const res = await mod('POST', `/${id}/dismiss-reports`, {
        version: seen.version,
        reason: 'Ложные',
        reportRevision: seen.reportRevision,
      });
      expect(res.status).toBe(409);
      expect(res.body).toMatchObject({ code: 'CONFLICT' });
      expect(await routeReportsDb(h).countDocuments({ routeId: id, resolvedAt: null })).toBe(2);
      expect(await panel(h).audit.countDocuments({ action: 'route.rider_reports_dismissed' })).toBe(
        0,
      );
    },
  );

  it('«Вернуть» после переименования скрытого автором — 409 CONFLICT, вне каталога; по новой версии — 200', async () => {
    const id = await approved();
    expect(
      (await mod('POST', `/${id}/hide`, { version: 1, reason: 'Плохое название' })).status,
    ).toBe(200);
    const seen = await detailOf(id);
    const renamed = await riderCall(h, author.token, 'POST', `${MY_ROUTES}/${id}/rename`, {
      title: 'Другое название',
    });
    expect(renamed.status).toBe(200);
    const stale = await mod('POST', `/${id}/restore`, {
      version: seen.version,
      reason: 'Исправлено',
    });
    expect(stale.status).toBe(409);
    expect(stale.body).toMatchObject({ code: 'CONFLICT' });
    expect(await catalogIds()).toEqual([]);
    const fresh = await detailOf(id);
    expect(fresh).toMatchObject({ title: 'Другое название', version: seen.version + 1 });
    const restored = await mod('POST', `/${id}/restore`, {
      version: fresh.version,
      reason: 'Проверено',
    });
    expect(restored.status).toBe(200);
    expect(await catalogIds()).toEqual([id]);
  });

  it('действие по заявке, отозванной автором после открытия карточки, — 404; снятой после одобрения — 404', async () => {
    const id = await submitted();
    const seen = await detailOf(id);
    expect((await withdrawPublication(h, author.token, id)).status).toBe(200);
    expect(
      (
        await mod('POST', `/${id}/approve`, {
          version: seen.version,
          city: 'minsk',
          surfaces: ['asphalt'],
        })
      ).status,
    ).toBe(404);
  });

  it('гонка: одобрение ↔ отзыв автором параллельно — исход согласован: withdrawn и вне каталога, одобрение 200 или 404/409', async () => {
    for (let i = 0; i < 5; i += 1) {
      const id = await submitted();
      const [approve, withdraw] = await Promise.all([
        mod('POST', `/${id}/approve`, { version: 0, city: 'minsk', surfaces: ['asphalt'] }),
        withdrawPublication(h, author.token, id),
      ]);
      expect(withdraw.status).toBe(200);
      expect([200, 404, 409]).toContain(approve.status);
      const doc = await routesDb(h).routes.findOne({ _id: id });
      expect(doc).toMatchObject({ catalog: null, publication: { status: 'withdrawn' } });
      expect(await catalogIds()).not.toContain(id);
      const approvals = await panel(h).audit.countDocuments({
        action: 'route.submission_approved',
        'subject.id': id,
      });
      expect(approvals).toBe(approve.status === 200 ? 1 : 0);
    }
  });
});

describe('откат транзакции', () => {
  it('сбой журнала — маршрут не одобрен, событий outbox нет', async () => {
    const id = await submitted();
    const audit = h.app.get(PanelAudit, { strict: false });
    const spy = vi.spyOn(audit, 'append').mockRejectedValue(new Error('журнал недоступен'));
    try {
      const res = await mod('POST', `/${id}/approve`, {
        version: 0,
        city: 'minsk',
        surfaces: ['asphalt'],
      });
      expect(res.status).toBe(500);
    } finally {
      spy.mockRestore();
    }
    expect(await routesDb(h).routes.findOne({ _id: id })).toMatchObject({
      catalog: null,
      publication: { status: 'pending', version: 0 },
    });
    expect(
      (await outboxEvents(h)).filter((event) => event.type === ROUTE_PUBLICATION_DECIDED),
    ).toEqual([]);
  });
});
