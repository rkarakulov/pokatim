import { PanelSeason, PanelSeasonList } from '@pokatim/contracts';
import { uuidv7 } from '@rkarakulov/api-kit/mongo';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { createHarness, DAY, type Harness } from '../../../test/harness';
import { gate, untilBlocked } from '../../../test/identity';
import { panel, panelCall, panelSession } from '../../../test/panel';
import { createSeason, fieldCodes, racesDb, SEASONS, seasonBody, staff } from '../../../test/races';
import { RacesRepository } from './races.repository';

/** Сезоны (AC1, AC2, AC9): права, правила дат, версия, журнал, гонка создания (R2) с отрицательным доказательством. */
let h: Harness;
beforeAll(async () => {
  h = await createHarness({ TRUST_PROXY: '1' });
});
beforeEach(async () => {
  await h.reset();
});
afterEach(() => {
  vi.restoreAllMocks();
});
afterAll(async () => {
  await h.close();
});

const repository = () => h.app.get(RacesRepository, { strict: false });

/** Опубликованная гонка сезона напрямую в БД (подготовка). */
async function seedPublishedRace(seasonId: string, windowEndsAt: Date) {
  const now = h.clock.now();
  await racesDb(h).races.insertOne({
    _id: uuidv7(),
    ownerUserId: uuidv7(),
    status: 'published',
    title: 'Гонка',
    bikeClass: 'road',
    surfaces: ['asphalt'],
    distanceKm: 40,
    description: null,
    windowStartsAt: new Date(windowEndsAt.getTime() - DAY),
    windowEndsAt,
    protocolPlannedAt: new Date(windowEndsAt.getTime() + 3 * DAY),
    seasonId,
    cancelReason: null,
    corridor: null,
    createdAt: now,
    updatedAt: now,
    publishedAt: now,
    cancelledAt: null,
    version: 1,
  });
}

describe('права на сезоны (AC1)', () => {
  it('admin — всё; moderator и organizer — чтение 200, изменение 403; без сессии — 401', async () => {
    const admin = await staff(h, 'admin@example.by', 'admin');
    const id = await createSeason(h, admin.token);
    for (const role of ['moderator', 'organizer'] as const) {
      const member = await staff(h, `${role}@example.by`, role);
      expect((await panelCall(h, member.token, 'GET', SEASONS)).status, role).toBe(200);
      const create = await panelCall(
        h,
        member.token,
        'POST',
        SEASONS,
        seasonBody({ startsOn: '2027-04-01', endsOn: '2027-10-31' }),
      );
      expect(create.status, role).toBe(403);
      const update = await panelCall(h, member.token, 'POST', `${SEASONS}/${id}`, {
        version: 0,
        name: 'X сезон',
      });
      expect(update.status, role).toBe(403);
    }
    expect((await panelCall(h, undefined, 'GET', SEASONS)).status).toBe(401);
    expect((await panelCall(h, undefined, 'POST', SEASONS, seasonBody())).status).toBe(401);
  });
});

describe('создание сезона (AC2)', () => {
  it('201, фаза по CLOCK, границы по Минску, журнал season.created с объектом', async () => {
    const admin = await staff(h, 'admin@example.by', 'admin');
    const res = await panelCall(h, admin.token, 'POST', SEASONS, seasonBody());

    expect(res.status).toBe(201);
    const season = PanelSeason.parse(res.body);
    expect(season).toMatchObject({
      name: 'Сезон 2026',
      phase: 'current',
      raceCount: 0,
      version: 0,
    });
    const doc = await racesDb(h).seasons.findOne({ _id: season.id });
    expect(doc?.startsAt.toISOString()).toBe('2026-03-31T21:00:00.000Z');
    expect(doc?.endsBefore.toISOString()).toBe('2026-10-31T21:00:00.000Z');
    const audit = await panel(h).audit.find({ action: 'season.created' }).toArray();
    expect(audit).toHaveLength(1);
    expect(audit[0]).toMatchObject({
      actor: { kind: 'user', userId: admin.userId },
      subject: { kind: 'season', id: season.id, label: 'Сезон 2026' },
    });

    const list = PanelSeasonList.parse((await panelCall(h, admin.token, 'GET', SEASONS)).body);
    expect(list.items.map((item) => item.id)).toEqual([season.id]);
  });

  it('пересечение — SEASON_OVERLAP на поле внутри чужого сезона; порядок дат; в прошлом', async () => {
    const admin = await staff(h, 'admin@example.by', 'admin');
    await createSeason(h, admin.token);
    const create = (body: Record<string, unknown>) =>
      panelCall(h, admin.token, 'POST', SEASONS, seasonBody(body));

    expect(
      fieldCodes((await create({ startsOn: '2026-10-31', endsOn: '2027-03-01' })).body),
    ).toEqual(['startsOn:SEASON_OVERLAP']);
    expect(
      fieldCodes((await create({ startsOn: '2026-03-01', endsOn: '2026-10-25' })).body),
    ).toEqual(['endsOn:SEASON_OVERLAP']);
    expect(
      fieldCodes((await create({ startsOn: '2026-01-01', endsOn: '2027-01-01' })).body),
    ).toEqual(['startsOn:SEASON_OVERLAP']);
    expect(
      fieldCodes((await create({ startsOn: '2027-05-01', endsOn: '2027-04-01' })).body),
    ).toEqual(['endsOn:DATE_ORDER']);
    expect(
      fieldCodes((await create({ startsOn: '2025-04-01', endsOn: '2025-10-31' })).body),
    ).toEqual(['endsOn:SEASON_IN_PAST']);
    // соседний сезон без пересечения — можно (промежутки допустимы, C8)
    expect(
      (await create({ name: 'Сезон 2027', startsOn: '2026-11-01', endsOn: '2027-10-31' })).status,
    ).toBe(201);
    expect(await racesDb(h).seasons.countDocuments()).toBe(2);
    expect(await panel(h).audit.countDocuments({ action: 'season.created' })).toBe(2);
  });

  it('инъекции и мусор — 400: оператор в поле, лишний ключ, 2026-02-30', async () => {
    const admin = await staff(h, 'admin@example.by', 'admin');
    for (const body of [
      seasonBody({ name: { $ne: null } }),
      seasonBody({ startsOn: '2026-02-30' }),
      seasonBody({ startsOn: '0099-01-01', endsOn: '0099-12-31' }),
      seasonBody({ endsOn: '9999-12-31' }),
      { ...seasonBody(), version: 3 },
      { ...seasonBody(), startsAt: '2026-01-01T00:00:00Z' },
    ]) {
      expect((await panelCall(h, admin.token, 'POST', SEASONS, body)).status).toBe(400);
    }
    expect((await panelCall(h, admin.token, 'POST', `${SEASONS}/abc`, { version: 0 })).status).toBe(
      400,
    );
    expect(await racesDb(h).seasons.countDocuments()).toBe(0);
  });
});

describe('изменение сезона (AC2)', () => {
  it('имя и даты: 200, version растёт, журнал season.updated { changedFields }', async () => {
    const admin = await staff(h, 'admin@example.by', 'admin');
    const id = await createSeason(h, admin.token);
    const res = await panelCall(h, admin.token, 'POST', `${SEASONS}/${id}`, {
      version: 0,
      name: 'Сезон-2026',
      endsOn: '2026-11-15',
    });
    expect(res.status).toBe(200);
    expect(PanelSeason.parse(res.body)).toMatchObject({
      name: 'Сезон-2026',
      endsOn: '2026-11-15',
      version: 1,
    });
    const audit = await panel(h).audit.find({ action: 'season.updated' }).toArray();
    expect(audit.map((entry) => [entry.subject?.label, entry.details])).toEqual([
      ['Сезон-2026', { changedFields: ['name', 'endsOn'] }],
    ]);
  });

  it('устаревшая version — 409 CONFLICT, без записи; несуществующий — 404', async () => {
    const admin = await staff(h, 'admin@example.by', 'admin');
    const id = await createSeason(h, admin.token);
    const results = await Promise.all([
      panelCall(h, admin.token, 'POST', `${SEASONS}/${id}`, { version: 0, name: 'Вкладка А' }),
      panelCall(h, admin.token, 'POST', `${SEASONS}/${id}`, { version: 0, name: 'Вкладка Б' }),
    ]);
    expect(results.map((res) => res.status).sort()).toEqual([200, 409]);
    expect(results.find((res) => res.status === 409)?.body).toMatchObject({ code: 'CONFLICT' });
    expect(await panel(h).audit.countDocuments({ action: 'season.updated' })).toBe(1);
    expect(
      (
        await panelCall(h, admin.token, 'POST', `${SEASONS}/${uuidv7()}`, {
          version: 0,
          name: 'Сезон',
        })
      ).status,
    ).toBe(404);
  });

  it('завершённый — даты SEASON_FINISHED, имя меняется', async () => {
    const admin = await staff(h, 'admin@example.by', 'admin');
    const id = await createSeason(h, admin.token, { startsOn: '2026-04-01', endsOn: '2026-10-23' });
    h.clock.advance(2 * DAY); // 24.10 — сезон завершён; сессия панели истекла по простою — вход заново
    admin.token = await panelSession(h, 'admin@example.by');
    const dates = await panelCall(h, admin.token, 'POST', `${SEASONS}/${id}`, {
      version: 0,
      endsOn: '2026-12-31',
    });
    expect(fieldCodes(dates.body)).toEqual(['endsOn:SEASON_FINISHED']);
    const name = await panelCall(h, admin.token, 'POST', `${SEASONS}/${id}`, {
      version: 0,
      name: 'Архив 2026',
    });
    expect(name.status).toBe(200);
    expect(PanelSeason.parse(name.body)).toMatchObject({ phase: 'finished', name: 'Архив 2026' });
  });

  it('сжатие, выбрасывающее опубликованную гонку, — SEASON_EXCLUDES_RACES; пересечение с другим — SEASON_OVERLAP', async () => {
    const admin = await staff(h, 'admin@example.by', 'admin');
    const id = await createSeason(h, admin.token);
    await createSeason(h, admin.token, {
      name: 'Сезон 2027',
      startsOn: '2027-04-01',
      endsOn: '2027-10-31',
    });
    await seedPublishedRace(id, new Date('2026-10-25T20:59:00Z'));

    const shrink = await panelCall(h, admin.token, 'POST', `${SEASONS}/${id}`, {
      version: 0,
      endsOn: '2026-10-24',
    });
    expect(fieldCodes(shrink.body)).toEqual(['endsOn:SEASON_EXCLUDES_RACES']);
    const overlap = await panelCall(h, admin.token, 'POST', `${SEASONS}/${id}`, {
      version: 0,
      endsOn: '2027-05-01',
    });
    expect(fieldCodes(overlap.body)).toEqual(['endsOn:SEASON_OVERLAP']);
    const widen = await panelCall(h, admin.token, 'POST', `${SEASONS}/${id}`, {
      version: 0,
      endsOn: '2026-11-30',
    });
    expect(PanelSeason.parse(widen.body)).toMatchObject({ raceCount: 1, version: 1 });
  });
});

/**
 * Два создания пересекающихся сезонов (R2): первое встаёт на воротах после проверки пересечения; второе идёт до
 * упора — с замком повторяется на `lockSchedule`, без замка — коммитится.
 */
async function concurrentCreates() {
  const admin = await staff(h, 'admin@example.by', 'admin');
  const target = repository();
  const overlapping = target.overlapping.bind(target);
  const paused = gate();
  vi.spyOn(target, 'overlapping').mockImplementationOnce(async (...args) => {
    const found = await overlapping(...args);
    await paused.wait(); // снимок первой транзакции: пересечений нет
    return found;
  });
  const lockSpy = vi.spyOn(target, 'lockSchedule');

  const first = panelCall(h, admin.token, 'POST', SEASONS, seasonBody({ name: 'Первый' }));
  await paused.reached;
  const second = panelCall(
    h,
    admin.token,
    'POST',
    SEASONS,
    seasonBody({ name: 'Второй', startsOn: '2026-06-01' }),
  );
  await untilBlocked(second, () => Promise.resolve(lockSpy.mock.calls.length >= 3));
  paused.open();
  return Promise.all([first, second]);
}

describe('гонка двух созданий пересекающихся сезонов (AC2, R2)', () => {
  it('ровно один 201, второй — SEASON_OVERLAP', async () => {
    const results = await concurrentCreates();
    expect(results.map((res) => res.status).sort()).toEqual([201, 400]);
    expect(await racesDb(h).seasons.countDocuments()).toBe(1);
    expect(await panel(h).audit.countDocuments({ action: 'season.created' })).toBe(1);
  });

  it('отрицательное доказательство: без lockSchedule — два пересекающихся сезона', async () => {
    vi.spyOn(RacesRepository.prototype, 'lockSchedule').mockResolvedValue(undefined);
    const results = await concurrentCreates();
    expect(results.map((res) => res.status)).toEqual([201, 201]);
    expect(await racesDb(h).seasons.countDocuments()).toBe(2);
  });
});
