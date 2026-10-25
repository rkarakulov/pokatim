import { minskWallTimeToUtc, PanelRace, PanelRacePage } from '@pokatim/contracts';
import { uuidv7 } from '@rkarakulov/api-kit/mongo';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { createHarness, DAY, HOUR, type Harness } from '../../../test/harness';
import { panel, panelCall, panelSession } from '../../../test/panel';
import {
  createRace,
  createSeason,
  fieldCodes,
  publishedRace,
  raceBody,
  RACES,
  racesDb,
  staff,
} from '../../../test/races';
import { RacesRepository } from './races.repository';

/**
 * Гонки панели (AC1, AC3–AC6, AC9): права и владение (404 чужой), черновик и правила формы, публикация в сезон,
 * правка по фазам (V-11), отмена шаблонной причиной, удаление черновика, версия, журнал.
 * Стенд: «сейчас» — 22.10.2026 12:00 Минска; сезон 2026 — 01.04–31.10; окно по умолчанию — 24.10 00:00 — 26.10 23:59.
 */
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

const parse = (body: unknown) => PanelRace.parse(body);
const auditOf = (action: string) =>
  panel(h)
    .audit.find({ action: action as never })
    .toArray();

/** Админ с сезоном 2026 и организатор. */
async function setup() {
  const admin = await staff(h, 'admin@example.by', 'admin');
  const seasonId = await createSeason(h, admin.token);
  const org = await staff(h, 'org@example.by', 'organizer');
  return { admin, org, seasonId };
}

/** Перевести часы и войти заново (сессия панели живёт 2 ч простоя). */
async function travel(ms: number, ...emails: string[]): Promise<string[]> {
  h.clock.advance(ms);
  return Promise.all(emails.map((email) => panelSession(h, email)));
}

describe('права на гонки (AC1)', () => {
  it('moderator — GET 200, мутации 403; organizer — свои; без сессии — 401', async () => {
    const { admin, org } = await setup();
    const race = await createRace(h, admin.token);
    const mod = await staff(h, 'mod@example.by', 'moderator');

    expect((await panelCall(h, mod.token, 'GET', RACES)).status).toBe(200);
    expect((await panelCall(h, mod.token, 'GET', `${RACES}/${race.id}`)).status).toBe(200);
    expect((await panelCall(h, mod.token, 'POST', RACES, raceBody())).status).toBe(403);
    for (const action of ['', '/publish', '/cancel', '/discard']) {
      const res = await panelCall(h, mod.token, 'POST', `${RACES}/${race.id}${action}`, {
        version: 0,
      });
      expect(res.status, action).toBe(403);
    }
    expect((await panelCall(h, org.token, 'POST', RACES, raceBody())).status).toBe(201);
    expect((await panelCall(h, undefined, 'GET', RACES)).status).toBe(401);
    expect((await panelCall(h, undefined, 'POST', RACES, raceBody())).status).toBe(401);
  });
});

describe('черновик (AC3)', () => {
  it('организатор создаёт: 201 draft, сезон-предпросмотр, владелец — он, журнал race.created', async () => {
    const { org, seasonId } = await setup();
    const res = await panelCall(h, org.token, 'POST', RACES, raceBody());

    expect(res.status).toBe(201);
    const race = parse(res.body);
    expect(race).toMatchObject({
      status: 'draft',
      phase: 'draft',
      season: { id: seasonId, name: 'Сезон 2026', preview: true },
      owner: { userId: org.userId, displayName: 'Сотрудник organizer' },
      windowEndsAt: '2026-10-26T20:59:00.000Z',
      editable: { canPublish: true, canDiscard: true, canCancel: false, reasons: [] },
    });
    expect(JSON.stringify(res.body)).not.toMatch(/@example\.by/);
    expect((await racesDb(h).races.findOne({ _id: race.id }))?.seasonId).toBeNull();
    expect((await auditOf('race.created')).map((entry) => entry.subject)).toEqual([
      { kind: 'race', id: race.id, label: 'Минское кольцо' },
    ]);
  });

  it('правила: 48 ч, окно наоборот, секунды, лишние поля сервера — 400 без записи', async () => {
    const { org } = await setup();
    const create = (overrides: Record<string, unknown>, wall = {}) =>
      panelCall(h, org.token, 'POST', RACES, raceBody(overrides, wall));

    expect(fieldCodes((await create({}, { protocol: '2026-10-28T23:58' })).body)).toEqual([
      'protocolPlannedAt:PROTOCOL_TOO_EARLY',
    ]);
    expect(
      fieldCodes(
        (await create({}, { start: '2026-10-27T00:00', protocol: '2026-10-30T00:00' })).body,
      ),
    ).toEqual(['windowEndsAt:DATE_ORDER']);
    expect((await create({ windowStartsAt: '2026-10-23T21:00:30Z' })).status).toBe(400);
    expect((await create({ ownerUserId: uuidv7() })).status).toBe(400);
    expect((await create({ status: 'published' })).status).toBe(400);
    expect((await create({ title: { $ne: null } })).status).toBe(400);
    expect(await racesDb(h).races.countDocuments()).toBe(0);
    expect(await panel(h).audit.countDocuments({ action: 'race.created' })).toBe(0);
  });

  it('правка своей — 200 + race.updated { changedFields }; чужая без manage_any — 404 и нет в списке; admin — 200', async () => {
    const { admin, org } = await setup();
    const own = await createRace(h, org.token);
    const foreign = await createRace(h, admin.token, { title: 'Чужая гонка' });

    const res = await panelCall(h, org.token, 'POST', `${RACES}/${own.id}`, {
      version: 0,
      title: 'Минское кольцо — 2',
      distanceKm: 50,
    });
    expect(res.status).toBe(200);
    expect(parse(res.body)).toMatchObject({ title: 'Минское кольцо — 2', version: 1 });
    expect((await auditOf('race.updated')).map((entry) => entry.details)).toEqual([
      { changedFields: ['title', 'distanceKm'] },
    ]);

    for (const [method, path] of [
      ['GET', ''],
      ['POST', ''],
      ['POST', '/publish'],
      ['POST', '/discard'],
    ] as const) {
      const denied = await panelCall(h, org.token, method, `${RACES}/${foreign.id}${path}`, {
        version: 0,
      });
      expect(denied.status, `${method} ${path}`).toBe(404);
    }
    const orgList = PanelRacePage.parse((await panelCall(h, org.token, 'GET', RACES)).body);
    expect(orgList.items.map((item) => item.id)).toEqual([own.id]);

    const byAdmin = await panelCall(h, admin.token, 'POST', `${RACES}/${own.id}`, {
      version: 1,
      description: 'Правка администратора',
    });
    expect(byAdmin.status).toBe(200);
    const adminList = PanelRacePage.parse((await panelCall(h, admin.token, 'GET', RACES)).body);
    expect(adminList.items).toHaveLength(2);
    const mine = PanelRacePage.parse(
      (await panelCall(h, admin.token, 'GET', `${RACES}?mine=true`)).body,
    );
    expect(mine.items.map((item) => item.id)).toEqual([foreign.id]);
  });

  it('удаление черновика — 204 + race.discarded; опубликованную — 409 RACE_INVALID_STATE', async () => {
    const { org } = await setup();
    const draft = await createRace(h, org.token);
    const res = await panelCall(h, org.token, 'POST', `${RACES}/${draft.id}/discard`, {
      version: 0,
    });
    expect(res.status).toBe(204);
    expect(await racesDb(h).races.countDocuments({ _id: draft.id })).toBe(0);
    expect((await auditOf('race.discarded')).map((entry) => entry.subject?.label)).toEqual([
      'Минское кольцо',
    ]);

    const published = await publishedRace(h, org.token);
    const again = await panelCall(h, org.token, 'POST', `${RACES}/${published.id}/discard`, {
      version: published.version,
    });
    expect(again.status).toBe(409);
    expect(again.body).toMatchObject({ code: 'RACE_INVALID_STATE' });
  });
});

describe('публикация (AC4)', () => {
  it('конец окна в сезоне — 200, seasonId записан, race.published; повтор — 409 RACE_INVALID_STATE', async () => {
    const { org, seasonId } = await setup();
    const draft = await createRace(h, org.token);
    const res = await panelCall(h, org.token, 'POST', `${RACES}/${draft.id}/publish`, {
      version: 0,
    });

    expect(res.status).toBe(200);
    expect(parse(res.body)).toMatchObject({
      status: 'published',
      phase: 'upcoming',
      season: { id: seasonId, preview: false },
      version: 1,
      editable: { canCancel: true, canPublish: false, canDiscard: false },
    });
    expect((await racesDb(h).races.findOne({ _id: draft.id }))?.seasonId).toBe(seasonId);
    expect(await panel(h).audit.countDocuments({ action: 'race.published' })).toBe(1);

    for (const version of [0, 1]) {
      const again = await panelCall(h, org.token, 'POST', `${RACES}/${draft.id}/publish`, {
        version,
      });
      expect(again.status).toBe(409);
      expect(again.body).toMatchObject({ code: 'RACE_INVALID_STATE' });
    }
  });

  it('вне сезонов — OUTSIDE_SEASON; окно прошло — WINDOW_IN_PAST; устаревшая версия — 409 CONFLICT', async () => {
    const { org } = await setup();
    const outside = await createRace(
      h,
      org.token,
      {},
      {
        start: '2026-11-02T00:00',
        end: '2026-11-03T23:59',
        protocol: '2026-11-06T00:00',
      },
    );
    expect(
      parse((await panelCall(h, org.token, 'GET', `${RACES}/${outside.id}`)).body),
    ).toMatchObject({
      season: null,
      editable: { canPublish: false, reasons: ['outside_season'] },
    });
    const res = await panelCall(h, org.token, 'POST', `${RACES}/${outside.id}/publish`, {
      version: 0,
    });
    expect(fieldCodes(res.body)).toEqual(['windowEndsAt:OUTSIDE_SEASON']);

    const past = await createRace(
      h,
      org.token,
      {},
      {
        start: '2026-10-01T00:00',
        end: '2026-10-21T23:59',
        protocol: '2026-10-25T00:00',
      },
    );
    const late = await panelCall(h, org.token, 'POST', `${RACES}/${past.id}/publish`, {
      version: 0,
    });
    expect(fieldCodes(late.body)).toEqual(['windowEndsAt:WINDOW_IN_PAST']);

    const fresh = await createRace(h, org.token);
    await panelCall(h, org.token, 'POST', `${RACES}/${fresh.id}`, {
      version: 0,
      title: 'Новое имя',
    });
    const stale = await panelCall(h, org.token, 'POST', `${RACES}/${fresh.id}/publish`, {
      version: 0,
    });
    expect(stale.status).toBe(409);
    expect(stale.body).toMatchObject({ code: 'CONFLICT' });
    expect(await panel(h).audit.countDocuments({ action: 'race.published' })).toBe(0);
  });
});

describe('правка опубликованной по фазам (AC5, V-11)', () => {
  it('до окна — все поля; окно открыто — начало FIELD_LOCKED; закрыто — только описание и протокол позже', async () => {
    const { org } = await setup();
    let race = await publishedRace(h, org.token);
    const edit = (token: string, body: Record<string, unknown>) =>
      panelCall(h, token, 'POST', `${RACES}/${race.id}`, { version: race.version, ...body });

    const before = await edit(org.token, {
      windowStartsAt: minskWallTimeToUtc('2026-10-24T06:00'),
    });
    expect(before.status).toBe(200);
    race = parse(before.body);
    expect(race).toMatchObject({ phase: 'upcoming', editable: { reasons: [] } });

    // 24.10 12:00 — окно открыто
    let [token] = await travel(2 * DAY, 'org@example.by');
    const open = parse((await panelCall(h, token, 'GET', `${RACES}/${race.id}`)).body);
    expect(open.phase).toBe('open');
    expect(open.editable.fields).not.toContain('windowStartsAt');
    expect(open.editable.reasons).toEqual(['window_open']);
    const locked = await edit(token!, { windowStartsAt: minskWallTimeToUtc('2026-10-24T08:00') });
    expect(fieldCodes(locked.body)).toEqual(['windowStartsAt:FIELD_LOCKED']);
    const extended = await edit(token!, {
      windowEndsAt: minskWallTimeToUtc('2026-10-27T23:59'),
      protocolPlannedAt: minskWallTimeToUtc('2026-10-29T23:59'),
    });
    expect(extended.status).toBe(200);
    race = parse(extended.body);

    // 28.10 12:00 — окно закрыто
    [token] = await travel(4 * DAY, 'org@example.by');
    const closed = parse((await panelCall(h, token, 'GET', `${RACES}/${race.id}`)).body);
    expect(closed).toMatchObject({
      phase: 'closed',
      editable: { fields: ['description', 'protocolPlannedAt'], reasons: ['window_closed'] },
    });
    expect(fieldCodes((await edit(token!, { title: 'Новое' })).body)).toEqual([
      'title:FIELD_LOCKED',
    ]);
    const earlier = await edit(token!, {
      protocolPlannedAt: minskWallTimeToUtc('2026-10-29T23:00'),
    });
    expect(fieldCodes(earlier.body)).toContain('protocolPlannedAt:PROTOCOL_ONLY_LATER');
    const later = await edit(token!, {
      protocolPlannedAt: minskWallTimeToUtc('2026-10-31T12:00'),
      description: 'Протокол позже',
    });
    expect(later.status).toBe(200);
  });

  it('смена конца окна опубликованной вне сезона — OUTSIDE_SEASON; внутри — seasonId прежний', async () => {
    const { org, seasonId } = await setup();
    const race = await publishedRace(h, org.token);
    const res = await panelCall(h, org.token, 'POST', `${RACES}/${race.id}`, {
      version: race.version,
      windowEndsAt: minskWallTimeToUtc('2026-11-02T23:59'),
      protocolPlannedAt: minskWallTimeToUtc('2026-11-05T00:00'),
    });
    expect(fieldCodes(res.body)).toEqual(['windowEndsAt:OUTSIDE_SEASON']);
    expect((await racesDb(h).races.findOne({ _id: race.id }))?.seasonId).toBe(seasonId);
  });

  it('две вкладки с одной version — 200 и 409', async () => {
    const { org } = await setup();
    const race = await publishedRace(h, org.token);
    const results = await Promise.all(
      ['Вкладка А', 'Вкладка Б'].map((title) =>
        panelCall(h, org.token, 'POST', `${RACES}/${race.id}`, { version: race.version, title }),
      ),
    );
    expect(results.map((res) => res.status).sort()).toEqual([200, 409]);
    expect(await panel(h).audit.countDocuments({ action: 'race.updated' })).toBe(1);
  });
});

describe('отмена (AC6)', () => {
  it('опубликованная + шаблон — 200, phase cancelled, race.cancelled { cancelReason }; дальше — только чтение', async () => {
    const { admin, org } = await setup();
    const race = await publishedRace(h, org.token);

    const res = await panelCall(h, admin.token, 'POST', `${RACES}/${race.id}/cancel`, {
      version: race.version,
      reason: 'weather',
    });
    expect(res.status).toBe(200);
    expect(parse(res.body)).toMatchObject({
      status: 'cancelled',
      phase: 'cancelled',
      cancelReason: 'weather',
      editable: { fields: [], canCancel: false, reasons: ['cancelled'] },
    });
    const audit = await auditOf('race.cancelled');
    expect(audit.map((entry) => [entry.actor, entry.details])).toEqual([
      [{ kind: 'user', userId: admin.userId }, { cancelReason: 'weather' }],
    ]);

    const version = parse(res.body).version;
    for (const [path, body] of [
      ['', { version, title: 'Правка' }],
      ['/cancel', { version, reason: 'weather' }],
      ['/publish', { version }],
    ] as const) {
      const again = await panelCall(h, admin.token, 'POST', `${RACES}/${race.id}${path}`, body);
      expect(again.status, path).toBe(409);
      expect(again.body).toMatchObject({ code: 'RACE_INVALID_STATE' });
    }
  });

  it('свободный текст и неизвестная причина — 400; черновик — 409 RACE_INVALID_STATE', async () => {
    const { org } = await setup();
    const race = await publishedRace(h, org.token);
    for (const reason of ['Дождь и ветер', 'flood', undefined]) {
      const res = await panelCall(h, org.token, 'POST', `${RACES}/${race.id}/cancel`, {
        version: race.version,
        reason,
      });
      expect(res.status).toBe(400);
    }
    const draft = await createRace(h, org.token);
    const res = await panelCall(h, org.token, 'POST', `${RACES}/${draft.id}/cancel`, {
      version: 0,
      reason: 'weather',
    });
    expect(res.status).toBe(409);
    expect(res.body).toMatchObject({ code: 'RACE_INVALID_STATE' });
  });
});

describe('журнал и список (AC9, AC11)', () => {
  it('откат действия — без записи журнала', async () => {
    const { org } = await setup();
    const race = await createRace(h, org.token);
    vi.spyOn(RacesRepository.prototype, 'seasonCovering').mockRejectedValueOnce(new Error('сбой'));
    const res = await panelCall(h, org.token, 'POST', `${RACES}/${race.id}/publish`, {
      version: 0,
    });
    expect(res.status).toBe(500);
    expect(await panel(h).audit.countDocuments({ action: 'race.published' })).toBe(0);
    expect((await racesDb(h).races.findOne({ _id: race.id }))?.status).toBe('draft');
  });

  it('курсор панели: новые окна сверху, без дублей и пропусков; фильтры статуса и класса; мусорный курсор — 400', async () => {
    const { admin } = await setup();
    const ids: string[] = [];
    for (let day = 0; day < 5; day += 1) {
      const start = new Date(Date.parse('2026-10-23T21:00:00Z') + day * HOUR);
      const race = await createRace(h, admin.token, {
        windowStartsAt: start.toISOString(),
        bikeClass: day % 2 === 0 ? 'road' : 'gravel',
      });
      ids.push(race.id);
    }
    const seen: string[] = [];
    let cursor: string | null = null;
    do {
      const query: string = `?limit=2${cursor ? `&cursor=${cursor}` : ''}`;
      const page = PanelRacePage.parse(
        (await panelCall(h, admin.token, 'GET', `${RACES}${query}`)).body,
      );
      seen.push(...page.items.map((item) => item.id));
      cursor = page.nextCursor;
    } while (cursor);
    expect(seen).toEqual([...ids].reverse());

    const gravel = PanelRacePage.parse(
      (await panelCall(h, admin.token, 'GET', `${RACES}?bikeClass=gravel&status=draft`)).body,
    );
    expect(gravel.items).toHaveLength(2);
    for (const query of ['?cursor=abc', '?status[$ne]=x', `?ownerUserId=${admin.userId}`]) {
      expect((await panelCall(h, admin.token, 'GET', `${RACES}${query}`)).status, query).toBe(400);
    }
  });
});
