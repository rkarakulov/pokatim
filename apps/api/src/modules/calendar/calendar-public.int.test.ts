import {
  CALENDAR_MONTHS_CAP,
  CalendarCities,
  CalendarMonths,
  CalendarPage,
  CalendarStartDetail,
  type CalendarStartInput,
} from '@pokatim/contracts';
import { uuidv7 } from '@rkarakulov/api-kit/mongo';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { createHarness, DAY, type Harness, HOUR, MINUTE } from '../../../test/harness';
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

async function creator() {
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
  const unpublish = async (start: { id: string; version: number }) => {
    await panelCall(h, admin.token, 'POST', `${CALENDAR}/${start.id}/unpublish`, {
      version: start.version,
      reason: 'Отменён организатором',
    });
  };
  return { admin, create, unpublish };
}

async function seed() {
  const { admin, create, unpublish } = await creator();
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
  await unpublish(hidden);
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
      'from=0099-01-01',
      'month=0099-01',
      'cursor=abc',
      'limit=0',
    ]) {
      expect((await get(`/v1/calendar?${query}`)).status, query).toBe(400);
    }
    expect((await get('/v1/calendar/abc')).status).toBe(400);
  });
});

const phaseOf = async (id: string) =>
  CalendarStartDetail.parse((await get(`/v1/calendar/${id}`)).body).phase;

describe('фаза старта (AC2)', () => {
  it('по CLOCK и датам Минска: граница 00:00 Минска (20:59:59Z / 21:00:00Z)', async () => {
    const { past, multiDay, today, nov } = await seed();
    const phases = () =>
      get('/v1/calendar').then((res) =>
        CalendarPage.parse(res.body).items.map((item) => [item.title, item.phase]),
      );
    expect(await phases()).toEqual([
      ['Идёт сейчас', 'ongoing'],
      ['Сегодня', 'ongoing'],
      ['Ноябрь', 'upcoming'],
      ['Декабрь', 'upcoming'],
    ]);
    expect(await phaseOf(past.id)).toBe('finished');

    // 22.10 23:59:59 Минска — ещё сегодня
    h.clock.advance(11 * HOUR + 59 * MINUTE + 59_000);
    expect(await phaseOf(today.id)).toBe('ongoing');
    expect(await phaseOf(multiDay.id)).toBe('ongoing');

    // 23.10 00:00 Минска — вчерашний по ссылке — finished
    h.clock.advance(1_000);
    expect(await phaseOf(today.id)).toBe('finished');
    expect(await phaseOf(multiDay.id)).toBe('finished');
    expect(await phaseOf(nov.id)).toBe('upcoming');
  });

  it('в ответах нет служебных полей', async () => {
    await seed();
    const text = JSON.stringify((await get('/v1/calendar')).body);
    for (const field of ['version', 'createdByUserId', 'cityKey', 'status', 'unpublishedAt']) {
      expect(text).not.toContain(`"${field}"`);
    }
  });
});

describe('GET /v1/calendar/months (AC2)', () => {
  it('месяцы будущих опубликованных: многодневный через границу — оба; снятые и прошедшие — нет; возр.', async () => {
    const { create, unpublish } = await creator();
    await create({ title: 'Прошедший', startsOn: '2026-09-10' });
    await create({ title: 'Через границу', startsOn: '2027-01-30', endsOn: '2027-02-01' });
    await create({ title: 'Ноябрь', startsOn: '2026-11-14' });
    await create({ title: 'Ноябрь-2', startsOn: '2026-11-20' });
    await unpublish(await create({ title: 'Снят', startsOn: '2027-03-01' }));

    const res = await get('/v1/calendar/months');
    expect(res.status).toBe(200);
    expect(res.headers['cache-control']).toBe('public, max-age=60');
    expect(CalendarMonths.parse(res.body)).toEqual({
      months: ['2026-11', '2027-01', '2027-02'],
    });
  });

  it('идущий многодневный, начавшийся в прошлом месяце, — без прошлого месяца', async () => {
    const { create } = await creator();
    await create({ title: 'Идёт', startsOn: '2026-10-30', endsOn: '2026-11-02' });
    h.clock.advance(10 * DAY); // 01.11.2026
    expect(CalendarMonths.parse((await get('/v1/calendar/months')).body)).toEqual({
      months: ['2026-11'],
    });
  });

  it(`не больше ${CALENDAR_MONTHS_CAP}: 25 месяцев — хвост обрезан`, async () => {
    const { create } = await creator();
    for (let i = 0; i < 25; i += 1) {
      const year = 2027 + Math.floor(i / 12);
      const month = String((i % 12) + 1).padStart(2, '0');
      await create({ title: `Старт ${i}`, startsOn: `${year}-${month}-10` });
    }
    const { months } = CalendarMonths.parse((await get('/v1/calendar/months')).body);
    expect(months).toHaveLength(CALENDAR_MONTHS_CAP);
    expect(months[0]).toBe('2027-01');
    expect(months.at(-1)).toBe('2028-12');
  });

  it('порядок маршрутов: months и cities — не `:id`; `:id` по-прежнему 200/404/400', async () => {
    const { nov } = await seed();
    expect((await get('/v1/calendar/months')).status).toBe(200);
    expect((await get('/v1/calendar/cities')).status).toBe(200);
    expect((await get(`/v1/calendar/${nov.id}`)).status).toBe(200);
    expect((await get(`/v1/calendar/${uuidv7()}`)).status).toBe(404);
    expect((await get('/v1/calendar/monthz')).status).toBe(400);
  });

  it('IP-лимит public-read: 301-й запрос — 429', async () => {
    const ip = '198.51.100.91';
    const at = (url: string) => call(h, 'GET', url, undefined, { 'x-forwarded-for': ip });
    for (let i = 0; i < 300; i += 1) {
      const res = await at('/v1/calendar/months');
      if (res.status !== 200) throw new Error(`запрос ${i}: ${res.status}`);
    }
    const limited = await at('/v1/calendar/months');
    expect(limited.status).toBe(429);
    expect(limited.body).toMatchObject({ code: 'RATE_LIMITED' });
  });
});
