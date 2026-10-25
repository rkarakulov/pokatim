import {
  CalendarCities,
  CalendarPage,
  CalendarStartDetail,
  type CalendarStartInput,
} from '@pokatim/contracts';
import { uuidv7 } from '@rkarakulov/api-kit/mongo';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { createHarness, DAY, type Harness } from '../../../test/harness';
import { call } from '../../../test/identity';
import { panelCall } from '../../../test/panel';
import { staff } from '../../../test/races';

/**
 * Публичный календарь (AC7, AC8): только опубликованные; `from` по умолчанию — сегодня по Минску; фильтры
 * дисциплины, города (без учёта регистра) и месяца; уникальные города; снятый старт — 404 и нет в списке.
 * Стенд: «сейчас» — 22.10.2026 12:00 Минска.
 */
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

let ipCounter = 0;
const get = (url: string) =>
  call(h, 'GET', url, undefined, { 'x-forwarded-for': `203.0.113.${(ipCounter++ % 200) + 1}` });

const CALENDAR = '/v1/admin/calendar';

async function seed() {
  const admin = await staff(h, 'admin@example.by', 'admin');
  const create = async (overrides: Partial<CalendarStartInput>) => {
    const body: CalendarStartInput = {
      title: 'Старт',
      startsOn: '2026-11-01',
      endsOn: null,
      startTime: null,
      discipline: 'road',
      city: 'Минск',
      place: null,
      distancesKm: [100],
      registrationUrl: null,
      description: 'Описание',
      ...overrides,
    };
    const res = await panelCall(h, admin.token, 'POST', CALENDAR, body);
    if (res.status !== 201) throw new Error(`старт: ${res.status}`);
    return res.body as { id: string; version: number };
  };
  const past = await create({ title: 'Прошедший', startsOn: '2026-10-01' });
  const multiDay = await create({
    title: 'Идёт сейчас',
    startsOn: '2026-10-21',
    endsOn: '2026-10-22',
    city: 'Брест',
  });
  const today = await create({
    title: 'Сегодня',
    startsOn: '2026-10-22',
    discipline: 'gravel',
    city: 'гродно',
  });
  const nov = await create({
    title: 'Ноябрь',
    startsOn: '2026-11-14',
    discipline: 'mtb',
    city: 'Гродно ',
  });
  const dec = await create({ title: 'Декабрь', startsOn: '2026-12-05', city: 'МИНСК' });
  const hidden = await create({ title: 'Снят', startsOn: '2026-11-20', city: 'Витебск' });
  await panelCall(h, admin.token, 'POST', `${CALENDAR}/${hidden.id}/unpublish`, {
    version: hidden.version,
    reason: 'Отменён организатором',
  });
  return { admin, past, multiDay, today, nov, dec, hidden };
}

const titles = (body: unknown) => CalendarPage.parse(body).items.map((item) => item.title);

describe('GET /v1/calendar (AC8)', () => {
  it('from по умолчанию — сегодня по Минску (идущий многодневный — тоже); снятый — нет; по дате', async () => {
    await seed();
    const res = await get('/v1/calendar');
    expect(res.status).toBe(200);
    expect(res.headers['cache-control']).toBe('public, max-age=60');
    expect(titles(res.body)).toEqual(['Идёт сейчас', 'Сегодня', 'Ноябрь', 'Декабрь']);

    // 23.10 00:30 Минска: «сегодня» — уже 23.10
    h.clock.advance(12 * 3_600_000 + 30 * 60_000);
    expect(titles((await get('/v1/calendar')).body)).toEqual(['Ноябрь', 'Декабрь']);
    expect(titles((await get('/v1/calendar?from=2026-10-01')).body)).toEqual([
      'Прошедший',
      'Идёт сейчас',
      'Сегодня',
      'Ноябрь',
      'Декабрь',
    ]);
  });

  it('фильтры: дисциплина (ИЛИ), город без учёта регистра, месяц; курсор', async () => {
    await seed();
    expect(titles((await get('/v1/calendar?discipline=gravel&discipline=mtb')).body)).toEqual([
      'Сегодня',
      'Ноябрь',
    ]);
    expect(titles((await get(`/v1/calendar?city=${encodeURIComponent('ГРОДНО')}`)).body)).toEqual([
      'Сегодня',
      'Ноябрь',
    ]);
    expect(titles((await get('/v1/calendar?month=2026-11&month=2026-12')).body)).toEqual([
      'Ноябрь',
      'Декабрь',
    ]);
    expect(
      titles((await get(`/v1/calendar?city=${encodeURIComponent('минск')}&month=2026-12`)).body),
    ).toEqual(['Декабрь']);

    const first = CalendarPage.parse((await get('/v1/calendar?limit=3')).body);
    const second = CalendarPage.parse(
      (await get(`/v1/calendar?limit=3&cursor=${first.nextCursor}`)).body,
    );
    expect([...first.items, ...second.items].map((item) => item.title)).toEqual([
      'Идёт сейчас',
      'Сегодня',
      'Ноябрь',
      'Декабрь',
    ]);
    expect(second.nextCursor).toBeNull();
  });

  it('карточка: опубликованная — 200 без служебных полей; снятая и неизвестная — 404; вернули — снова видна', async () => {
    const { admin, nov, hidden } = await seed();
    const res = await get(`/v1/calendar/${nov.id}`);
    expect(CalendarStartDetail.parse(res.body)).toMatchObject({
      title: 'Ноябрь',
      description: 'Описание',
    });
    const text = JSON.stringify(res.body);
    for (const field of ['version', 'createdByUserId', 'cityKey', 'status', 'createdAt']) {
      expect(text).not.toContain(`"${field}"`);
    }
    expect((await get(`/v1/calendar/${hidden.id}`)).status).toBe(404);
    expect((await get(`/v1/calendar/${uuidv7()}`)).status).toBe(404);

    await panelCall(h, admin.token, 'POST', `${CALENDAR}/${hidden.id}/republish`, {
      version: hidden.version + 1,
    });
    expect((await get(`/v1/calendar/${hidden.id}`)).status).toBe(200);
    expect(titles((await get('/v1/calendar?month=2026-11')).body)).toEqual(['Ноябрь', 'Снят']);
  });

  it('cities — уникальные по cityKey (написание — ближайшего старта), будущие опубликованные, по алфавиту', async () => {
    await seed();
    const res = await get('/v1/calendar/cities');
    expect(res.headers['cache-control']).toBe('public, max-age=60');
    expect(CalendarCities.parse(res.body)).toEqual({ cities: ['Брест', 'гродно', 'МИНСК'] });
    h.clock.advance(60 * DAY);
    expect(CalendarCities.parse((await get('/v1/calendar/cities')).body)).toEqual({ cities: [] });
  });

  it('инъекции и мусор — 400', async () => {
    for (const query of [
      'city[$gt]=',
      'discipline=road&extra=1',
      'from=2026-02-30',
      'cursor=abc',
      'limit=0',
    ]) {
      expect((await get(`/v1/calendar?${query}`)).status, query).toBe(400);
    }
    expect((await get('/v1/calendar/abc')).status).toBe(400);
  });
});
