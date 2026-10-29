import { PanelOverview } from '@pokatim/contracts';
import { uuidv7 } from '@rkarakulov/api-kit/mongo';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { createHarness, DAY, type Harness, HOUR, MINUTE } from '../../../test/harness';
import { panelCall, panelSession } from '../../../test/panel';
import { createSeason, publishedRace, staff } from '../../../test/races';
import { travelTo, WINDOW } from '../../../test/results';
import { CALENDAR_COLLECTIONS } from '../calendar/calendar.collection';
import { DISPUTES_COLLECTIONS } from '../disputes/disputes.collection';
import { IDENTITY_COLLECTIONS } from '../identity/identity.collection';
import { PROFILE_COLLECTIONS } from '../profile/profile.collection';
import { RESULTS_COLLECTIONS } from '../results/results.collection';
import { RIDES_COLLECTIONS } from '../rides/rides.collection';
import { ROUTES_COLLECTIONS } from '../routes/routes.collection';
import { TRACKS_COLLECTIONS } from '../tracks/tracks.collection';

/**
 * «Обзор» панели (admin-overview): блоки по правам роли (нет права — нет поля), гонки организатора — только свои,
 * счётчики — те же фильтры, что у очередей разделов. Документы чужих модулей тест сеет напрямую: проверяются фильтры
 * портов, а не сценарии создания.
 */
const OVERVIEW = '/v1/admin/overview';

let h: Harness;
beforeAll(async () => {
  h = await createHarness();
});
beforeEach(async () => {
  await h.reset();
});
afterAll(async () => {
  await h.close();
});

type Doc = { _id: string } & Record<string, unknown>;
const seed = (collection: string, docs: Record<string, unknown>[]) =>
  h.db.collection<Doc>(collection).insertMany(docs.map((doc) => ({ _id: uuidv7(), ...doc })));

async function overviewOf(token: string): Promise<PanelOverview> {
  const res = await panelCall(h, token, 'GET', OVERVIEW);
  expect(res.status).toBe(200);
  expect(res.headers['cache-control']).toBe('no-store');
  return PanelOverview.parse(res.body);
}

/** Перевести часы (только вперёд) и войти заново: сессия панели истекает после 2 ч простоя. */
async function travelAndSignIn(at: Date) {
  travelTo(h, at);
  return {
    admin: await panelSession(h, 'admin@example.by'),
    organizer: await panelSession(h, 'organizer@example.by'),
  };
}

/** Сотрудники трёх ролей; две опубликованные гонки (окно стенда) — организатора и админа. */
async function team() {
  const admin = await staff(h, 'admin@example.by', 'admin');
  const moderator = await staff(h, 'moderator@example.by', 'moderator');
  const organizer = await staff(h, 'organizer@example.by', 'organizer');
  await createSeason(h, admin.token);
  const own = await publishedRace(h, organizer.token, { title: 'Своя гонка' });
  const foreign = await publishedRace(h, admin.token, { title: 'Чужая гонка' });
  return { admin, moderator, organizer, own: own.id, foreign: foreign.id };
}

describe('доступ и блоки по ролям', () => {
  it('без сессии — 401', async () => {
    expect((await panelCall(h, undefined, 'GET', OVERVIEW)).status).toBe(401);
  });

  it('организатор — только протоколы и «Сейчас идёт»; модератор — без KPI и удалений; admin — всё', async () => {
    const { admin, moderator, organizer } = await team();

    const org = await overviewOf(organizer.token);
    expect(Object.keys(org.attention)).toEqual(['protocols']);
    expect(org.live).toBeDefined();
    expect(org.kpi).toBeUndefined();

    const mod = await overviewOf(moderator.token);
    expect(Object.keys(mod.attention).sort()).toEqual(
      ['disputes', 'protocols', 'riderProfiles', 'riderRoutes', 'rides'].sort(),
    );
    expect(mod.kpi).toBeUndefined();

    const all = await overviewOf(admin.token);
    expect(Object.keys(all.attention).sort()).toEqual(
      ['accountDeletions', 'disputes', 'protocols', 'riderProfiles', 'riderRoutes', 'rides'].sort(),
    );
    expect(all.kpi).toBeDefined();
    // ответ с отсутствующими блоками — без `null`-заглушек
    const raw = (await panelCall(h, organizer.token, 'GET', OVERVIEW)).body as Record<
      string,
      unknown
    >;
    expect(Object.keys(raw).sort()).toEqual(['attention', 'live']);
  });
});

describe('гонки: «Сейчас идёт» и протоколы', () => {
  it('открытое окно: участники и попытки (без снятых); организатор видит только свою гонку', async () => {
    const { own, foreign } = await team();
    const tokens = await travelAndSignIn(new Date(WINDOW.startsAt.getTime() + HOUR));
    await seed(RESULTS_COLLECTIONS.entries, [
      { raceId: own, status: 'active', userId: uuidv7() },
      { raceId: own, status: 'active', userId: uuidv7() },
      { raceId: own, status: 'withdrawn', userId: uuidv7() },
    ]);
    await seed(RESULTS_COLLECTIONS.attempts, [
      { raceId: own, status: 'counted', activityId: uuidv7() },
      { raceId: own, status: 'queued', activityId: uuidv7() },
      { raceId: own, status: 'withdrawn', activityId: uuidv7() },
      { raceId: foreign, status: 'rejected', activityId: uuidv7() },
    ]);

    const org = await overviewOf(tokens.organizer);
    expect(org.live?.racesTotal).toBe(1);
    expect(org.live?.races).toEqual([
      {
        id: own,
        title: 'Своя гонка',
        windowEndsAt: expect.any(String),
        participants: 2,
        attempts: 2,
      },
    ]);
    expect(org.attention.protocols).toEqual({ awaiting: 0, ready: 0, blockers: 0 });

    const all = await overviewOf(tokens.admin);
    expect(all.live?.racesTotal).toBe(2);
    expect(all.live?.races.find((race) => race.id === foreign)).toMatchObject({
      participants: 0,
      attempts: 1,
    });
  });

  it('окно закрыто, протокола нет — «ждут протокола» с блокерами чек-листа; организатор — только свои', async () => {
    await team();
    const tokens = await travelAndSignIn(new Date(WINDOW.closesAt.getTime() + MINUTE));

    const org = await overviewOf(tokens.organizer);
    expect(org.live?.racesTotal).toBe(0);
    // без коридора (`no_corridor`) и приём файлов ещё идёт (`window_open`, сутки после окна)
    expect(org.attention.protocols).toEqual({ awaiting: 1, ready: 0, blockers: 2 });

    const all = await overviewOf(tokens.admin);
    expect(all.attention.protocols).toEqual({ awaiting: 2, ready: 0, blockers: 4 });
  });
});

describe('очереди модерации и споры', () => {
  it('счётчики — по фильтрам очередей разделов; ноль — тоже значение', async () => {
    const { moderator } = await team();
    const empty = await overviewOf(moderator.token);
    expect(empty.attention).toMatchObject({
      disputes: { open: 0 },
      rides: { reported: 0 },
      riderRoutes: { pending: 0, reported: 0 },
      riderProfiles: { reported: 0 },
    });

    const dispute = (status: string) => ({
      status,
      raceId: uuidv7(),
      complainantUserId: uuidv7(),
      targetEntryId: uuidv7(),
      filedAt: new Date(),
    });
    await seed(DISPUTES_COLLECTIONS.disputes, [
      dispute('open'),
      dispute('open'),
      dispute('rejected'),
    ]);
    await seed(RIDES_COLLECTIONS.rides, [
      { status: 'published', openReportCount: 2, lastReportAt: new Date() },
      { status: 'hidden', openReportCount: 0, lastReportAt: new Date() },
    ]);
    const riderRoute = (
      publication: Record<string, unknown>,
      extra: Record<string, unknown> = {},
    ) => ({
      origin: 'rider',
      ownerUserId: uuidv7(),
      sha256: uuidv7(),
      status: 'ready',
      publication: { submittedAt: new Date(), ...publication },
      ...extra,
    });
    await seed(ROUTES_COLLECTIONS.routes, [
      riderRoute({ status: 'pending' }),
      riderRoute({ status: 'pending' }),
      riderRoute({ status: 'pending' }, { status: 'processing' }),
      riderRoute({ status: 'approved', openReportCount: 1, lastReportAt: new Date() }),
      riderRoute({ status: 'hidden', openReportCount: 1, lastReportAt: new Date() }),
    ]);
    await seed(PROFILE_COLLECTIONS.profiles, [
      { openReportCount: 3, lastReportAt: new Date() },
      { openReportCount: 0 },
    ]);

    expect((await overviewOf(moderator.token)).attention).toMatchObject({
      disputes: { open: 2 },
      rides: { reported: 1 },
      riderRoutes: { pending: 2, reported: 1 },
      riderProfiles: { reported: 1 },
    });
  });
});

describe('KPI и удаления аккаунтов (только admin)', () => {
  it('регистрации и загрузки за 7 суток, активные райды, удаления без очистки дольше суток', async () => {
    const { admin } = await team();
    const now = h.clock.now();
    const ago = (ms: number) => new Date(now.getTime() - ms);
    const users = h.db.collection<Doc>(IDENTITY_COLLECTIONS.users);
    const recent = await users.countDocuments({ createdAt: { $gte: ago(7 * DAY) } });
    await seed(IDENTITY_COLLECTIONS.users, [
      { email: 'old@example.by', createdAt: ago(8 * DAY), deletedAt: null },
      // удалён двое суток назад, очистка не завершилась — зависло
      { email: 'gone1', createdAt: ago(30 * DAY), deletedAt: ago(2 * DAY), erasureSweptAt: null },
      // удалён час назад — штатно ещё в работе; давно удалённый с завершённой очисткой
      { email: 'gone2', createdAt: ago(30 * DAY), deletedAt: ago(HOUR), erasureSweptAt: null },
      {
        email: 'gone3',
        createdAt: ago(30 * DAY),
        deletedAt: ago(3 * DAY),
        erasureSweptAt: ago(DAY),
      },
    ]);
    await seed(TRACKS_COLLECTIONS.uploads, [
      { userId: uuidv7(), sha256: 'a', createdAt: ago(HOUR) },
      { userId: uuidv7(), sha256: 'b', createdAt: ago(6 * DAY) },
      { userId: uuidv7(), sha256: 'c', createdAt: ago(8 * DAY) },
    ]);
    await seed(RIDES_COLLECTIONS.rides, [
      { status: 'published', startsAt: new Date(now.getTime() + DAY) },
      { status: 'published', startsAt: ago(HOUR) },
      { status: 'cancelled', startsAt: new Date(now.getTime() + DAY) },
    ]);

    const all = await overviewOf(admin.token);
    expect(all.kpi).toEqual({ newUsers: recent, uploads: 2, activeRides: 1 });
    expect(recent).toBeGreaterThanOrEqual(3);
    expect(all.attention.accountDeletions).toEqual({ stuck: 1 });
  });
});

describe('календарь', () => {
  it('ближайшие опубликованные старты, не закончившиеся к сегодняшнему дню Минска, по дате (≤ 5)', async () => {
    const { organizer } = await team();
    const start = (startsOn: string, extra: Record<string, unknown> = {}) => ({
      status: 'published',
      title: `Старт ${startsOn}`,
      startsOn,
      endsOn: null,
      city: 'Минск',
      ...extra,
    });
    await seed(CALENDAR_COLLECTIONS.starts, [
      start('2026-10-01'),
      start('2026-10-20', { endsOn: '2026-12-31' }),
      start('2026-11-05'),
      start('2026-11-01', { status: 'unpublished' }),
      start('2026-11-10'),
      start('2026-11-11'),
      start('2026-11-12'),
      start('2026-11-13'),
    ]);
    const calendar = (await overviewOf(organizer.token)).live?.calendar ?? [];
    expect(calendar.map((row) => row.startsOn)).toEqual([
      '2026-10-20',
      '2026-11-05',
      '2026-11-10',
      '2026-11-11',
      '2026-11-12',
    ]);
    expect(calendar[0]).toMatchObject({ endsOn: '2026-12-31', city: 'Минск' });
  });
});
