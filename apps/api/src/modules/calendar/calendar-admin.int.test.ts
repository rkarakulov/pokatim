import { PanelCalendarPage, PanelCalendarStart } from '@pokatim/contracts';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { createHarness, type Harness } from '../../../test/harness';
import { panel, panelCall } from '../../../test/panel';
import { fieldCodes, staff } from '../../../test/races';
import { calendarCollections } from './calendar.collection';

/** Календарь панели (AC1, AC7, AC9): только admin, создание сразу опубликованным, правка, снятие и возврат. */
let h: Harness;
beforeAll(async () => {
  h = await createHarness({ TRUST_PROXY: '1' });
});
beforeEach(async () => {
  await h.reset();
});
afterAll(async () => {
  await h.close();
});

const CALENDAR = '/v1/admin/calendar';
const startBody = (overrides: Record<string, unknown> = {}) => ({
  title: 'Гран-при Минска',
  startsOn: '2027-06-14',
  endsOn: null,
  startTime: '08:00',
  discipline: 'road',
  city: '  Минск ',
  place: 'Парк Победы',
  distancesKm: [80, 120],
  registrationUrl: 'https://example.by/race',
  description: null,
  ...overrides,
});

describe('права на календарь (AC1)', () => {
  it('moderator и organizer — 403 на всё; без сессии — 401', async () => {
    for (const role of ['moderator', 'organizer'] as const) {
      const member = await staff(h, `${role}@example.by`, role);
      expect((await panelCall(h, member.token, 'GET', CALENDAR)).status, role).toBe(403);
      expect((await panelCall(h, member.token, 'POST', CALENDAR, startBody())).status, role).toBe(
        403,
      );
    }
    expect((await panelCall(h, undefined, 'GET', CALENDAR)).status).toBe(401);
  });
});

describe('календарь: создание и правила (AC7)', () => {
  it('admin создаёт — 201 published, cityKey, журнал calendar.created', async () => {
    const admin = await staff(h, 'admin@example.by', 'admin');
    const res = await panelCall(h, admin.token, 'POST', CALENDAR, startBody());

    expect(res.status).toBe(201);
    const start = PanelCalendarStart.parse(res.body);
    expect(start).toMatchObject({ status: 'published', city: 'Минск', version: 0 });
    const doc = await calendarCollections(h.db).starts.findOne({ _id: start.id });
    expect(doc).toMatchObject({ cityKey: 'минск', createdByUserId: admin.userId });
    const audit = await panel(h).audit.find({ action: 'calendar.created' }).toArray();
    expect(audit.map((entry) => entry.subject)).toEqual([
      { kind: 'calendar_start', id: start.id, label: 'Гран-при Минска' },
    ]);
  });

  it('http/javascript-ссылка, конец раньше начала, дольше 14 дней, инъекция — 400 без записи', async () => {
    const admin = await staff(h, 'admin@example.by', 'admin');
    const create = (overrides: Record<string, unknown>) =>
      panelCall(h, admin.token, 'POST', CALENDAR, startBody(overrides));

    expect((await create({ registrationUrl: 'http://example.by' })).status).toBe(400);
    expect((await create({ registrationUrl: 'javascript:alert(1)' })).status).toBe(400);
    expect(fieldCodes((await create({ endsOn: '2027-06-13' })).body)).toEqual([
      'endsOn:DATE_ORDER',
    ]);
    expect(fieldCodes((await create({ endsOn: '2027-06-29' })).body)).toEqual(['endsOn:INVALID']);
    expect((await create({ title: { $ne: null } })).status).toBe(400);
    expect((await create({ status: 'unpublished' })).status).toBe(400);
    expect(await calendarCollections(h.db).starts.countDocuments()).toBe(0);
    expect((await create({ endsOn: '2027-06-28', registrationUrl: null })).status).toBe(201);
  });
});

describe('календарь: правка, снятие и возврат (AC7, AC9)', () => {
  it('правка — changedFields; снятие с причиной — reason в журнале; возврат; устаревшая версия — 409', async () => {
    const admin = await staff(h, 'admin@example.by', 'admin');
    const start = PanelCalendarStart.parse(
      (await panelCall(h, admin.token, 'POST', CALENDAR, startBody())).body,
    );
    const path = `${CALENDAR}/${start.id}`;

    const edited = await panelCall(h, admin.token, 'POST', path, {
      version: 0,
      city: 'Гродно',
      distancesKm: [100],
    });
    expect(PanelCalendarStart.parse(edited.body)).toMatchObject({ city: 'Гродно', version: 1 });
    expect(await calendarCollections(h.db).starts.findOne({ _id: start.id })).toMatchObject({
      cityKey: 'гродно',
    });

    expect(
      (await panelCall(h, admin.token, 'POST', `${path}/unpublish`, { version: 1 })).status,
    ).toBe(400);
    const unpublished = await panelCall(h, admin.token, 'POST', `${path}/unpublish`, {
      version: 1,
      reason: 'Старт перенесён организатором',
    });
    expect(PanelCalendarStart.parse(unpublished.body)).toMatchObject({
      status: 'unpublished',
      version: 2,
    });
    const again = await panelCall(h, admin.token, 'POST', `${path}/unpublish`, {
      version: 2,
      reason: 'Повтор снятия',
    });
    expect(again.status).toBe(409);

    const back = await panelCall(h, admin.token, 'POST', `${path}/republish`, { version: 2 });
    expect(PanelCalendarStart.parse(back.body)).toMatchObject({ status: 'published', version: 3 });
    expect(
      (await panelCall(h, admin.token, 'POST', path, { version: 1, title: 'Старое' })).status,
    ).toBe(409);

    const audit = await panel(h).audit.find({ 'subject.id': start.id }).sort({ _id: 1 }).toArray();
    expect(audit.map((entry) => [entry.action, entry.reason, entry.details])).toEqual([
      ['calendar.created', null, null],
      ['calendar.updated', null, { changedFields: ['city', 'distancesKm'] }],
      ['calendar.unpublished', 'Старт перенесён организатором', null],
      ['calendar.republished', null, null],
    ]);
  });

  it('список панели: и снятые, и прошедшие; новые даты сверху; курсор; фильтр статуса', async () => {
    const admin = await staff(h, 'admin@example.by', 'admin');
    const dates = ['2026-05-01', '2027-06-14', '2027-07-01'];
    for (const startsOn of dates) {
      await panelCall(h, admin.token, 'POST', CALENDAR, startBody({ startsOn }));
    }
    const first = PanelCalendarPage.parse(
      (await panelCall(h, admin.token, 'GET', `${CALENDAR}?limit=2`)).body,
    );
    expect(first.items.map((item) => item.startsOn)).toEqual(['2027-07-01', '2027-06-14']);
    const second = PanelCalendarPage.parse(
      (await panelCall(h, admin.token, 'GET', `${CALENDAR}?limit=2&cursor=${first.nextCursor}`))
        .body,
    );
    expect(second).toMatchObject({ items: [{ startsOn: '2026-05-01' }], nextCursor: null });
    const unpublished = PanelCalendarPage.parse(
      (await panelCall(h, admin.token, 'GET', `${CALENDAR}?status=unpublished`)).body,
    );
    expect(unpublished.items).toEqual([]);
    expect((await panelCall(h, admin.token, 'GET', `${CALENDAR}?cursor=zzz`)).status).toBe(400);
  });
});
