import { ModerationRideDetail, ModerationRidePage } from '@pokatim/contracts';
import { uuidv7 } from '@rkarakulov/api-kit/mongo';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { createHarness, type Harness, MINUTE } from '../../../test/harness';
import { call } from '../../../test/identity';
import { eventsOfType } from '../../../test/notifications';
import { panel, panelCall } from '../../../test/panel';
import { staff } from '../../../test/races';
import {
  authed,
  createRide,
  MODERATION,
  report,
  RIDES,
  rider,
  ridesDb,
  type Rider,
} from '../../../test/rides';
import { PanelAudit } from '../panel';
import { rideReportsCollections } from './ride-reports.collection';

/**
 * Модерация кофе-райдов в панели (05b, AC3–AC6, AC8, AC10–AC12): `rides.moderate` — admin и moderator; очередь,
 * карточка без автора жалобы; «Скрыть» / «Вернуть» / «Отклонить жалобы» — запись райда, закрытие жалоб и журнал в
 * одной транзакции.
 */
let h: Harness;
let organizer: Rider;
let moderator: { userId: string; token: string };
beforeAll(async () => {
  h = await createHarness({ TRUST_PROXY: '1' });
});
beforeEach(async () => {
  await h.reset();
  organizer = await rider(h, 'org@example.by');
  moderator = await staff(h, 'moderator@example.by', 'moderator');
});
afterAll(async () => {
  await h.close();
});

const reportsDb = () => rideReportsCollections(h.db).reports;
const mod = (method: 'GET' | 'POST', path: string, body?: unknown) =>
  panelCall(h, moderator.token, method, `${MODERATION}${path}`, body);
const detailOf = async (id: string) =>
  ModerationRideDetail.parse((await mod('GET', `/${id}`)).body);
const queue = async (query = '') => ModerationRidePage.parse((await mod('GET', query)).body);

let reporterSeq = 0;
/** Жалоба от нового райдера. */
async function reportBy(id: string, reason = 'spam', comment: string | null = null) {
  const who = await rider(h, `reporter${++reporterSeq}@example.by`);
  const res = await report(h, who, id, { reason, comment });
  if (res.status !== 200) throw new Error(`жалоба: ${res.status}`);
  return who;
}

describe('права (AC8, AC12)', () => {
  it('без сессии — 401, organizer — 403, moderator и admin — 200', async () => {
    const ride = await createRide(h, organizer);
    const routes: ['GET' | 'POST', string][] = [
      ['GET', ''],
      ['GET', `/${ride.id}`],
      ['POST', `/${ride.id}/hide`],
      ['POST', `/${ride.id}/restore`],
      ['POST', `/${ride.id}/dismiss-reports`],
    ];
    const staffOrganizer = await staff(h, 'staff-org@example.by', 'organizer');
    for (const [method, path] of routes) {
      const url = `${MODERATION}${path}`;
      expect((await panelCall(h, undefined, method, url, {})).status, url).toBe(401);
      expect((await panelCall(h, staffOrganizer.token, method, url, {})).status, url).toBe(403);
    }
    const admin = await staff(h, 'admin@example.by', 'admin');
    for (const token of [moderator.token, admin.token]) {
      const res = await panelCall(h, token, 'GET', MODERATION);
      expect(res.status).toBe(200);
      expect(res.headers['cache-control']).toBe('no-store');
    }
  });
});

describe('очередь и карточка (AC3)', () => {
  it('«Открытые жалобы» — новые жалобы сверху, курсор; topReason — самая частая (ничья — по справочнику)', async () => {
    const first = await createRide(h, organizer, { title: 'Первый' });
    const second = await createRide(h, organizer, { title: 'Второй' });
    await createRide(h, organizer, { title: 'Без жалоб' });
    await reportBy(first.id, 'fake');
    await reportBy(first.id, 'offensive');
    h.clock.advance(MINUTE);
    await reportBy(second.id, 'dangerous');
    await reportBy(second.id, 'dangerous');
    await reportBy(second.id, 'spam');

    const all = await queue();
    expect(all.items.map((row) => [row.title, row.openReportCount, row.topReason])).toEqual([
      ['Второй', 3, 'dangerous'],
      ['Первый', 2, 'offensive'],
    ]);
    expect(all.items[0]).toMatchObject({ status: 'published', phase: 'upcoming', hiddenAt: null });

    const page1 = await queue('?limit=1');
    expect(page1.items.map((row) => row.id)).toEqual([second.id]);
    const page2 = await queue(`?limit=1&cursor=${page1.nextCursor}`);
    expect(page2.items.map((row) => row.id)).toEqual([first.id]);
    expect(page2.nextCursor).toBeNull();
    expect((await mod('GET', '?state=all')).status).toBe(400);
    expect((await mod('GET', '?cursor=garbage')).status).toBe(400);
  });

  it('карточка: райд целиком, жалобы новые сверху (≤ 100), без автора жалобы и id организатора', async () => {
    const ride = await createRide(h, organizer, { organizerName: 'Катя' });
    const reporter = await reportBy(ride.id, 'offensive', 'Мат в описании');
    const res = await mod('GET', `/${ride.id}`);
    expect(res.status).toBe(200);
    const text = JSON.stringify(res.body);
    expect(text).not.toContain(reporter.userId);
    expect(text).not.toContain(organizer.userId);
    expect(text).not.toContain('reporterUserId');
    expect(text).not.toContain('participants');
    const detail = ModerationRideDetail.parse(res.body);
    expect(detail).toMatchObject({
      title: 'Кофе-райд на море',
      organizerName: 'Катя',
      description: 'Едем спокойно',
      status: 'published',
      openReportCount: 1,
      version: 0,
      reports: [{ reason: 'offensive', comment: 'Мат в описании', resolution: null }],
    });

    // 101 жалоба (подготовка в БД) — в карточке 100 последних
    const base = h.clock.now();
    // uuidv7 внутри одной миллисекунды не упорядочен — порядок вставки задаём сортировкой id
    const ids = Array.from({ length: 101 }, () => uuidv7()).sort();
    await reportsDb().insertMany(
      ids.map((_id, i) => ({
        _id,
        rideId: ride.id,
        reporterUserId: `seed-${i}`,
        reason: 'spam' as const,
        comment: `#${i}`,
        createdAt: new Date(base.getTime() + i),
        resolvedAt: null,
        resolution: null,
        resolvedBy: null,
      })),
    );
    const many = await detailOf(ride.id);
    expect(many.reports).toHaveLength(100);
    expect(many.reports[0]?.comment).toBe('#100');
    expect((await mod('GET', '/01890a5d-ac96-774b-bcce-b302099a8057')).status).toBe(404);
  });
});

describe('«Скрыть» (AC4)', () => {
  it('скрыт: публично 404, жалобы закрыты hidden, счётчик 0, version + 1, журнал ride.hidden', async () => {
    const ride = await createRide(h, organizer);
    await reportBy(ride.id);
    await reportBy(ride.id, 'offensive');
    const res = await mod('POST', `/${ride.id}/hide`, { version: 0, reason: 'Оскорбления' });
    expect(res.status).toBe(200);
    const detail = ModerationRideDetail.parse(res.body);
    expect(detail).toMatchObject({
      status: 'hidden',
      phase: 'hidden',
      openReportCount: 0,
      version: 1,
      hiddenAt: h.clock.now().toISOString(),
    });
    expect(detail.reports.map((r) => r.resolution)).toEqual(['hidden', 'hidden']);
    expect(await reportsDb().countDocuments({ resolvedBy: moderator.userId })).toBe(2);
    expect((await call(h, 'GET', `${RIDES}/${ride.id}`)).status).toBe(404);
    expect(await ridesDb(h).findOne({ _id: ride.id })).toMatchObject({
      hiddenFromStatus: 'published',
    });

    const audit = await panel(h).audit.find({ action: 'ride.hidden' }).toArray();
    expect(audit).toHaveLength(1);
    expect(audit[0]).toMatchObject({
      actor: { kind: 'user', userId: moderator.userId },
      reason: 'Оскорбления',
      subject: { kind: 'ride', id: ride.id, label: 'Кофе-райд на море' },
      details: { reportCount: 2 },
    });
    expect((await queue()).items).toEqual([]);
    expect((await queue('?state=hidden')).items.map((row) => row.id)).toEqual([ride.id]);

    // правка организатором скрытого — 409
    expect(
      (await authed(h, organizer, 'POST', `${RIDES}/${ride.id}`, { version: 0, title: 'Новое' }))
        .status,
    ).toBe(409);
  });

  it('«Скрытые» — по времени скрытия, новые сверху; скрыть без жалоб — можно, reportCount 0', async () => {
    const older = await createRide(h, organizer, { title: 'Раньше' });
    const newer = await createRide(h, organizer, { title: 'Позже' });
    await mod('POST', `/${older.id}/hide`, { version: 0, reason: 'Спам' });
    h.clock.advance(MINUTE);
    await mod('POST', `/${newer.id}/hide`, { version: 0, reason: 'Спам' });
    const hidden = await queue('?state=hidden');
    expect(hidden.items.map((row) => row.title)).toEqual(['Позже', 'Раньше']);
    expect(hidden.items[0]).toMatchObject({ openReportCount: 0, topReason: null });
    const audit = await panel(h).audit.find({ action: 'ride.hidden' }).toArray();
    expect(audit.map((entry) => entry.details)).toEqual([{ reportCount: 0 }, { reportCount: 0 }]);
  });
});

describe('«Вернуть» (AC5)', () => {
  it('в прежний статус (published и cancelled), version + 1, журнал ride.restored без details', async () => {
    const published = await createRide(h, organizer, { title: 'Опубликованный' });
    const cancelled = await createRide(h, organizer, { title: 'Отменённый' });
    await authed(h, organizer, 'POST', `${RIDES}/${cancelled.id}/cancel`, { reason: 'weather' });
    for (const [ride, version, status] of [
      [published, 0, 'published'],
      [cancelled, 1, 'cancelled'],
    ] as const) {
      await reportBy(ride.id);
      await mod('POST', `/${ride.id}/hide`, { version, reason: 'Проверка' });
      const res = await mod('POST', `/${ride.id}/restore`, {
        version: version + 1,
        reason: 'Ошибочное скрытие',
      });
      expect(res.status).toBe(200);
      expect(ModerationRideDetail.parse(res.body)).toMatchObject({
        status,
        hiddenAt: null,
        version: version + 2,
        openReportCount: 0,
      });
      expect((await call(h, 'GET', `${RIDES}/${ride.id}`)).status).toBe(200);
    }
    const audit = await panel(h).audit.find({ action: 'ride.restored' }).sort({ _id: 1 }).toArray();
    expect(audit.map((entry) => [entry.subject?.label, entry.reason, entry.details])).toEqual([
      ['Опубликованный', 'Ошибочное скрытие', null],
      ['Отменённый', 'Ошибочное скрытие', null],
    ]);
    // жалобы, закрытые скрытием, не открываются снова
    expect(await reportsDb().countDocuments({ resolvedAt: null })).toBe(0);
  });
});

describe('«Отклонить жалобы» (AC6)', () => {
  it('жалобы dismissed, райд вне очереди, видимость и version прежние; журнал ride.reports_dismissed', async () => {
    const ride = await createRide(h, organizer);
    await reportBy(ride.id);
    const { lastReportAt } = await detailOf(ride.id);
    const res = await mod('POST', `/${ride.id}/dismiss-reports`, {
      version: 0,
      reason: 'Нарушений нет',
      lastReportAt,
    });
    expect(res.status).toBe(200);
    const detail = ModerationRideDetail.parse(res.body);
    expect(detail).toMatchObject({ status: 'published', openReportCount: 0, version: 0 });
    expect(detail.reports.map((r) => r.resolution)).toEqual(['dismissed']);
    expect((await queue()).items).toEqual([]);
    expect((await call(h, 'GET', `${RIDES}/${ride.id}`)).status).toBe(200);
    const audit = await panel(h).audit.find({ action: 'ride.reports_dismissed' }).toArray();
    expect(audit).toHaveLength(1);
    expect(audit[0]).toMatchObject({
      reason: 'Нарушений нет',
      subject: { kind: 'ride', id: ride.id },
      details: { reportCount: 1 },
    });
  });
});

describe('событие rides.reports-resolved (notifications, RC-3)', () => {
  const resolvedEvents = () => eventsOfType(h, 'rides.reports-resolved');

  it('«Скрыть» и «Отклонить» с жалобами — событие { rideId, resolvedAt } действия; без жалоб и «Вернуть» — нет', async () => {
    const hidden = await createRide(h, organizer, { title: 'Скрываемый' });
    await reportBy(hidden.id);
    await mod('POST', `/${hidden.id}/hide`, { version: 0, reason: 'Спам' });
    const hiddenAt = h.clock.now().toISOString();
    h.clock.advance(MINUTE);
    await mod('POST', `/${hidden.id}/restore`, { version: 1, reason: 'Ошибочное скрытие' });

    const dismissed = await createRide(h, organizer, { title: 'Отклонённый' });
    await reportBy(dismissed.id);
    const { lastReportAt } = await detailOf(dismissed.id);
    h.clock.advance(MINUTE);
    await mod('POST', `/${dismissed.id}/dismiss-reports`, {
      version: 0,
      reason: 'Нарушений нет',
      lastReportAt,
    });
    const dismissedAt = h.clock.now().toISOString();

    const clean = await createRide(h, organizer, { title: 'Без жалоб' });
    await mod('POST', `/${clean.id}/hide`, { version: 0, reason: 'Спам' });

    expect((await resolvedEvents()).map((event) => event.payload)).toEqual([
      { rideId: hidden.id, resolvedAt: hiddenAt },
      { rideId: dismissed.id, resolvedAt: dismissedAt },
    ]);
  });

  it('откат транзакции (сбой журнала) — события нет', async () => {
    const ride = await createRide(h, organizer);
    await reportBy(ride.id);
    const audit = h.app.get(PanelAudit, { strict: false });
    const spy = vi.spyOn(audit, 'append').mockRejectedValue(new Error('журнал недоступен'));
    try {
      expect((await mod('POST', `/${ride.id}/hide`, { version: 0, reason: 'Спам' })).status).toBe(
        500,
      );
    } finally {
      spy.mockRestore();
    }
    expect(await resolvedEvents()).toEqual([]);
  });
});

describe('конфликты и недопустимые переходы (AC10, AC12)', () => {
  it('устаревшая version — 409 CONFLICT без записи журнала; новая жалоба после карточки — 409 CONFLICT', async () => {
    const ride = await createRide(h, organizer);
    await reportBy(ride.id);
    const { lastReportAt } = await detailOf(ride.id);
    const stale = await mod('POST', `/${ride.id}/hide`, { version: 5, reason: 'Спам' });
    expect(stale.status).toBe(409);
    expect(stale.body).toMatchObject({ code: 'CONFLICT' });

    h.clock.advance(MINUTE);
    await reportBy(ride.id);
    const unseen = await mod('POST', `/${ride.id}/dismiss-reports`, {
      version: 0,
      reason: 'Нарушений нет',
      lastReportAt,
    });
    expect(unseen.status).toBe(409);
    expect(unseen.body).toMatchObject({ code: 'CONFLICT' });
    expect(await panel(h).audit.countDocuments({ action: /^ride\./ })).toBe(0);
    expect(await reportsDb().countDocuments({ resolvedAt: null })).toBe(2);
  });

  it('вернуть нескрытый, отклонить без жалоб, отклонить скрытый, скрыть скрытый — 409 RIDE_INVALID_STATE', async () => {
    const ride = await createRide(h, organizer);
    const at = h.clock.now().toISOString();
    const expectInvalid = async (path: string, body: Record<string, unknown>) => {
      const res = await mod('POST', `/${ride.id}/${path}`, body);
      expect(res.status, path).toBe(409);
      expect(res.body, path).toMatchObject({ code: 'RIDE_INVALID_STATE' });
    };
    await expectInvalid('restore', { version: 0, reason: 'Вернуть' });
    await expectInvalid('dismiss-reports', { version: 0, reason: 'Нет', lastReportAt: at });
    await reportBy(ride.id);
    await mod('POST', `/${ride.id}/hide`, { version: 0, reason: 'Спам' });
    const { lastReportAt } = await detailOf(ride.id);
    await expectInvalid('hide', { version: 1, reason: 'Снова' });
    await expectInvalid('dismiss-reports', {
      version: 1,
      reason: 'Нет',
      lastReportAt: lastReportAt ?? at,
    });
    expect(await panel(h).audit.countDocuments({ action: 'ride.hidden' })).toBe(1);
  });

  it('тело: причина короче 3, лишнее поле — 400; неизвестный райд — 404', async () => {
    const ride = await createRide(h, organizer);
    expect((await mod('POST', `/${ride.id}/hide`, { version: 0, reason: 'ab' })).status).toBe(400);
    expect(
      (await mod('POST', `/${ride.id}/hide`, { version: 0, reason: 'Спам', status: 'x' })).status,
    ).toBe(400);
    expect(
      (
        await mod('POST', '/01890a5d-ac96-774b-bcce-b302099a8057/hide', {
          version: 0,
          reason: 'Спам',
        })
      ).status,
    ).toBe(404);
  });
});

describe('откат транзакции (AC11)', () => {
  it('сбой журнала — райд и жалобы не изменены', async () => {
    const ride = await createRide(h, organizer);
    await reportBy(ride.id);
    const audit = h.app.get(PanelAudit, { strict: false });
    const spy = vi.spyOn(audit, 'append').mockRejectedValue(new Error('журнал недоступен'));
    try {
      const res = await mod('POST', `/${ride.id}/hide`, { version: 0, reason: 'Спам' });
      expect(res.status).toBe(500);
    } finally {
      spy.mockRestore();
    }
    expect(await ridesDb(h).findOne({ _id: ride.id })).toMatchObject({
      status: 'published',
      version: 0,
      openReportCount: 1,
      hiddenAt: null,
    });
    expect(await reportsDb().countDocuments({ resolvedAt: null })).toBe(1);
    expect(await panel(h).audit.countDocuments({ action: 'ride.hidden' })).toBe(0);
  });
});
