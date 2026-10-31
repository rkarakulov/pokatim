import { Logger } from '@nestjs/common';
import {
  AchievementList,
  AuditPage,
  minskToday,
  PublicRiderAchievementList,
  RiderAchievementsAdmin,
} from '@pokatim/contracts';
import { RateLimiter } from '@rkarakulov/api-kit/core';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  ACHIEVEMENTS,
  achievementsDb,
  daysAgo,
  MANUAL_REASON,
  panelAchievement,
  pastRide,
  raceAt,
  racesAt,
  RIDER_ACHIEVEMENTS_ADMIN,
} from '../../../test/achievements';
import { createHarness, type Harness } from '../../../test/harness';
import { bearer, call, collections } from '../../../test/identity';
import { eventsOfType } from '../../../test/notifications';
import { panelCall } from '../../../test/panel';
import { racesDb, staff } from '../../../test/races';
import { catalogCorridorRoute, ownCorridorRoute } from '../../../test/route-rides';
import { authed, createRide, hideInDb, rider, type Rider } from '../../../test/rides';
import {
  addRevision,
  placedRow,
  seedProtocolRace,
  seedSeason,
  syncStandings,
} from '../../../test/standings';
import { AchievementErasure } from './achievement-erasure';
import {
  ACHIEVEMENTS_FOR_SHARING,
  type AchievementsForSharing,
} from './achievements-for-sharing.port';
import { ACHIEVEMENTS_PANEL_LIMIT } from './achievements-panel.service';
import { AchievementsReconciler } from './achievements-reconciler';
import { ACHIEVEMENTS_GRANT_NOTICED, AchievementsGrantNoticed } from './achievements.events';

/**
 * Ручная выдача и отзыв достижений в панели (achievements-panel, AC1–AC3): права, проверка объекта портами владельцев,
 * журнал, уведомление, ответы райдера (M7), сверка не трогает ручные решения, снятие решения и немедленная сверка,
 * публичный список и карточка (RC-1), сезонные, стирание.
 */
let h: Harness;
beforeAll(async () => {
  h = await createHarness();
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

const reconciler = () => h.app.get(AchievementsReconciler, { strict: false });
const sharing = () =>
  h.app.get<AchievementsForSharing>(ACHIEVEMENTS_FOR_SHARING, { strict: false });
const grants = () => achievementsDb(h).grants;
const seasonGrants = () => achievementsDb(h).seasonGrants;

async function admin() {
  return (await staff(h, 'admin@example.com', 'admin')).token;
}

async function riderList(who: Rider) {
  const res = await authed(h, who, 'GET', ACHIEVEMENTS);
  if (res.status !== 200) throw new Error(`достижения: ${res.status} ${JSON.stringify(res.body)}`);
  return AchievementList.parse(res.body);
}

async function panelList(token: string, userId: string) {
  const res = await panelCall(h, token, 'GET', `${RIDER_ACHIEVEMENTS_ADMIN}/${userId}`);
  if (res.status !== 200) throw new Error(`панель: ${res.status} ${JSON.stringify(res.body)}`);
  expect(res.headers['cache-control']).toBe('no-store');
  return { body: res.body, parsed: RiderAchievementsAdmin.parse(res.body) };
}

async function auditOf(token: string) {
  const res = await panelCall(h, token, 'GET', '/v1/admin/audit');
  return AuditPage.parse(res.body).items.filter((item) => item.action.startsWith('achievement.'));
}

const noticed = async () =>
  (await eventsOfType(h, ACHIEVEMENTS_GRANT_NOTICED)).map((event) =>
    AchievementsGrantNoticed.parse(event.payload),
  );

/** Публичный профиль через API: имя и согласие; `publicId`. */
async function publicIdOf(who: Rider): Promise<string> {
  const res = await call(
    h,
    'PATCH',
    '/v1/profile',
    { publicName: 'Анна К.', showNameInResults: true },
    bearer(who.token),
  );
  return (res.body as { publicId: string }).publicId;
}

const fieldsOf = (body: unknown) =>
  ((body as { details?: { fields?: { path: string; code: string }[] } }).details?.fields ?? []).map(
    (field) => `${field.path}:${field.code}`,
  );

describe('доступ (AC1)', () => {
  it('без сессии — 401; moderator и organizer — 403; admin — 200', async () => {
    const me = await rider(h, 'me@example.com');
    const moderator = (await staff(h, 'mod@example.com', 'moderator')).token;
    const organizer = (await staff(h, 'org@example.com', 'organizer')).token;
    const token = await admin();
    const url = `${RIDER_ACHIEVEMENTS_ADMIN}/${me.userId}`;
    expect((await panelCall(h, undefined, 'GET', url)).status).toBe(401);
    for (const who of [moderator, organizer]) {
      expect((await panelCall(h, who, 'GET', url)).status).toBe(403);
      expect(
        (
          await panelAchievement(h, who, me.userId, 'grant', {
            code: 'race_win',
            objectId: me.userId,
          })
        ).status,
      ).toBe(403);
    }
    // access JWT приложения панель не принимает
    expect((await call(h, 'GET', url, undefined, bearer(me.token))).status).toBe(401);
    expect((await panelCall(h, token, 'GET', url)).status).toBe(200);
    expect((await panelCall(h, token, 'GET', `${RIDER_ACHIEVEMENTS_ADMIN}/nope`)).status).toBe(400);
  });
});

describe('проверка запроса и объекта (AC2)', () => {
  it('400: без причины, уровень у разового, сезонный без seasonId; объект не найден или не подходит виду кода', async () => {
    const me = await rider(h, 'me@example.com');
    const other = await rider(h, 'other@example.com');
    const token = await admin();
    const season = await seedSeason(h);
    const race = await raceAt(h, season, [placedRow(other.userId, 1)], daysAgo(h, 5));
    const draft = await seedProtocolRace(h, season, [], { protocol: false });
    await racesDb(h).races.updateOne({ _id: draft }, { $set: { status: 'draft' } });
    const hidden = await pastRide(h, other, [], 3);
    await hideInDb(h, hidden);
    const future = (await createRide(h, other)).id;
    const foreign = await ownCorridorRoute(h, other.userId);
    const current = await seedSeason(h, 'Сезон 2026 б', { year: 2026 });

    const post = (action: 'grant' | 'revoke' | 'clear', body: Record<string, unknown>) =>
      panelAchievement(h, token, me.userId, action, body);
    const noReason = await panelCall(
      h,
      token,
      'POST',
      `${RIDER_ACHIEVEMENTS_ADMIN}/${me.userId}/grant`,
      {
        code: 'race_win',
        objectId: race,
      },
    );
    expect(noReason.status).toBe(400);
    expect(fieldsOf(noReason.body)).toEqual(['reason:REQUIRED']);
    for (const action of ['revoke', 'clear'] as const) {
      const res = await panelCall(
        h,
        token,
        'POST',
        `${RIDER_ACHIEVEMENTS_ADMIN}/${me.userId}/${action}`,
        {
          code: 'race_win',
        },
      );
      expect(fieldsOf(res.body)).toEqual(['reason:REQUIRED']);
    }
    expect(
      fieldsOf((await post('grant', { code: 'race_win', objectId: race, level: 'gold' })).body),
    ).toEqual(['level:INVALID']);
    expect(fieldsOf((await post('revoke', { code: 'season_podium' })).body)).toEqual([
      'seasonId:REQUIRED',
    ]);

    for (const [code, objectId] of [
      ['race_win', me.userId], // неизвестный id
      ['race_win', draft], // черновик
      ['race_win', hidden], // объект чужого вида (райд для гоночного)
      ['ride_first', hidden], // скрытый райд
      ['ride_first', future], // старт не прошёл
      ['route_first', foreign], // чужой приватный маршрут
      ['season_champion', current], // сезон не завершён
      ['season_champion', race], // не сезон
    ] as const) {
      const res = await post('grant', { code, objectId });
      expect(res.status, `${code} ${objectId}`).toBe(400);
      expect(fieldsOf(res.body)).toEqual(['objectId:INVALID']);
    }
    expect(await grants().countDocuments()).toBe(0);
    expect(await auditOf(token)).toEqual([]);
  });

  it('404 — удалённый и неизвестный райдер; 429 — лимит сотрудника', async () => {
    const me = await rider(h, 'me@example.com');
    const token = await admin();
    const season = await seedSeason(h);
    const race = await raceAt(h, season, [placedRow(me.userId, 1)], daysAgo(h, 5));
    await collections(h).users.updateOne(
      { _id: me.userId },
      { $set: { deletedAt: h.clock.now() } },
    );
    expect(
      (await panelAchievement(h, token, me.userId, 'grant', { code: 'race_win', objectId: race }))
        .status,
    ).toBe(404);
    expect((await panelAchievement(h, token, race, 'revoke', { code: 'race_win' })).status).toBe(
      404,
    );
  });

  it('429 — лимит мутаций по сотруднику (ключ — сотрудник, не райдер): журнала и записи нет (ревью pass 1)', async () => {
    const me = await rider(h, 'me@example.com');
    const actor = await staff(h, 'admin@example.com', 'admin');
    const second = await staff(h, 'admin2@example.com', 'admin');
    const season = await seedSeason(h);
    const race = await raceAt(h, season, [placedRow(me.userId, 1)], daysAgo(h, 5));
    const limiter = h.app.get(RateLimiter);
    for (let i = 0; i < ACHIEVEMENTS_PANEL_LIMIT.limit; i += 1)
      await limiter.consume(
        `achievements-panel:${actor.userId}`,
        ACHIEVEMENTS_PANEL_LIMIT,
        h.clock.now(),
      );

    const limited = await panelAchievement(h, actor.token, me.userId, 'grant', {
      code: 'race_win',
      objectId: race,
    });
    expect([limited.status, (limited.body as { code: string }).code]).toEqual([
      429,
      'RATE_LIMITED',
    ]);
    expect(await grants().countDocuments({ userId: me.userId })).toBe(0);
    expect(await auditOf(actor.token)).toEqual([]);

    // другой сотрудник тому же райдеру — не ограничен
    const ok = await panelAchievement(h, second.token, me.userId, 'grant', {
      code: 'race_win',
      objectId: race,
    });
    expect(ok.status).toBe(204);
  });
});

describe('ручная выдача несезонного (AC2, AC3)', () => {
  it('без документа: райдер видит с названием, seen: false, уровнем формы; ключи прежние; событие server; журнал; лог без userId', async () => {
    const me = await rider(h, 'me@example.com');
    const other = await rider(h, 'other@example.com');
    const token = await admin();
    const season = await seedSeason(h);
    await riderList(me); // маркер первой сверки
    const race = await raceAt(h, season, [placedRow(other.userId, 1)], daysAgo(h, 5), 'Весенняя');
    const logs = vi.spyOn(Logger.prototype, 'log');

    const res = await panelAchievement(h, token, me.userId, 'grant', {
      code: 'races_5',
      objectId: race,
      level: 'silver',
    });
    expect(res.status).toBe(204);

    const raceDoc = await racesDb(h).races.findOne({ _id: race });
    const listRes = await authed(h, me, 'GET', ACHIEVEMENTS);
    const list = AchievementList.parse(listRes.body);
    expect(list.items).toEqual([
      {
        code: 'races_5',
        object: { kind: 'race', id: race, title: 'Весенняя' },
        factDate: minskToday(raceDoc!.windowStartsAt),
        level: 'silver',
        seen: false,
      },
    ]);
    const raw = (listRes.body as { items: Record<string, unknown>[] }).items[0]!;
    expect(Object.keys(raw).sort()).toEqual(['code', 'factDate', 'level', 'object', 'seen']);
    expect(Object.keys(listRes.body as object)).toEqual(['items', 'progress']);

    const doc = await grants().findOne({ userId: me.userId, code: 'races_5' });
    expect(doc).toMatchObject({
      level: 2,
      notifiedLevel: 2,
      seenAt: null,
      revokedAt: null,
      override: { decision: 'granted', at: h.clock.now(), byUserId: expect.any(String) },
    });
    const events = await eventsOfType(h, ACHIEVEMENTS_GRANT_NOTICED);
    expect(events.map((event) => event.payload)).toEqual([
      { grant: 'fact', grantId: doc!._id, level: 2, origin: 'server' },
    ]);
    expect(JSON.stringify(events[0]!.payload)).not.toContain(me.userId);

    const [entry] = await auditOf(token);
    expect(entry).toMatchObject({
      action: 'achievement.granted_manually',
      reason: MANUAL_REASON,
      target: null,
      subject: { kind: 'rider', id: me.userId, label: `Участник ·${me.userId.slice(-6)}` },
      details: {
        achievementCode: 'races_5',
        objectKind: 'race',
        objectId: race,
        achievementLevel: 'silver',
      },
    });
    expect(JSON.stringify(entry)).not.toContain('Весенняя');
    const manualLogs = logs.mock.calls
      .map((args) => String(args[0]))
      .filter((line) => line.startsWith('achievements.manual'));
    expect(manualLogs).toEqual([
      expect.stringMatching(/^achievements\.manual action=granted by=\S+ outcome=granted$/),
    ]);
    expect(manualLogs.join()).not.toContain(me.userId);
    expect(manualLogs.join()).not.toContain(race);

    // уже видима — 409 already_granted, без журнала и события
    const again = await panelAchievement(h, token, me.userId, 'grant', {
      code: 'races_5',
      objectId: race,
    });
    expect(again.status).toBe(409);
    expect(again.body).toMatchObject({
      code: 'ACHIEVEMENT_INVALID_STATE',
      details: { reason: 'already_granted' },
    });
    expect(await auditOf(token)).toHaveLength(1);
    expect(await noticed()).toHaveLength(1);
  });

  it('сверка read и server не отзывает ручную без факта и не меняет объект и уровень при новых фактах; прогресс не противоречит ручному уровню (RC-9)', async () => {
    const me = await rider(h, 'me@example.com');
    const other = await rider(h, 'other@example.com');
    const token = await admin();
    const season = await seedSeason(h);
    await riderList(me);
    const manualRace = await raceAt(
      h,
      season,
      [placedRow(other.userId, 1)],
      daysAgo(h, 40),
      'Ручная',
    );
    expect(
      (
        await panelAchievement(h, token, me.userId, 'grant', {
          code: 'races_5',
          objectId: manualRace,
          level: 'gold',
        })
      ).status,
    ).toBe(204);
    expect(
      (
        await panelAchievement(h, token, me.userId, 'grant', {
          code: 'race_win',
          objectId: manualRace,
        })
      ).status,
    ).toBe(204);
    const before = await grants().find({ userId: me.userId }).sort({ code: 1 }).toArray();

    // новые факты: 6 гонок в зачёте, одна победа — сверка хотела бы бронзу races_5 и другой объект race_win
    await racesAt(h, season, me.userId, 6, 20);
    await raceAt(h, season, [placedRow(me.userId, 1)], daysAgo(h, 2), 'Факт');
    await reconciler().reconcile(me.userId, 'server');
    const list = await riderList(me);
    expect(
      await grants()
        .find({ userId: me.userId, code: { $in: ['races_5', 'race_win'] } })
        .sort({ code: 1 })
        .toArray(),
    ).toEqual(before);
    expect(list.items.find((item) => item.code === 'races_5')).toMatchObject({
      level: 'gold',
      object: { id: manualRace, title: 'Ручная' },
    });
    expect(list.items.find((item) => item.code === 'race_win')).toMatchObject({
      object: { id: manualRace, title: 'Ручная' },
    });
    // факты дали бы «Серебро 6/15» — при ручном золоте строки нет
    expect(list.progress.map((step) => step.code)).not.toContain('races_5');
  });

  it('выдача поверх отозванного сверкой документа — тот же _id, seen: false; ручной отзыв — пропадает, сверка не восстанавливает; снятие — немедленная сверка по фактам', async () => {
    const me = await rider(h, 'me@example.com');
    const token = await admin();
    const season = await seedSeason(h);
    const race = await raceAt(h, season, [placedRow(me.userId, 1)], daysAgo(h, 10), 'Весенняя');
    await riderList(me); // первая сверка: race_win выдан просмотренным
    const original = await grants().findOne({ userId: me.userId, code: 'race_win' });
    expect(original?.seenAt).not.toBeNull();

    // ручной отзыв видимой фактовой
    expect(
      (await panelAchievement(h, token, me.userId, 'revoke', { code: 'race_win' })).status,
    ).toBe(204);
    expect((await riderList(me)).items.map((item) => item.code)).not.toContain('race_win');
    await reconciler().reconcile(me.userId, 'server');
    expect(await grants().findOne({ userId: me.userId, code: 'race_win' })).toMatchObject({
      _id: original!._id,
      revokedAt: h.clock.now(),
      override: { decision: 'revoked' },
      seenAt: original!.seenAt,
    });
    const notGranted = await panelAchievement(h, token, me.userId, 'revoke', { code: 'race_win' });
    expect(notGranted.status).toBe(409);
    expect(notGranted.body).toMatchObject({ details: { reason: 'not_granted' } });

    // ручная выдача поверх отозванного вручную — тот же документ, вспышка
    expect(
      (await panelAchievement(h, token, me.userId, 'grant', { code: 'race_win', objectId: race }))
        .status,
    ).toBe(204);
    expect(await grants().countDocuments({ userId: me.userId, code: 'race_win' })).toBe(1);
    expect(await grants().findOne({ userId: me.userId, code: 'race_win' })).toMatchObject({
      _id: original!._id,
      revokedAt: null,
      seenAt: null,
      override: { decision: 'granted' },
    });
    expect((await riderList(me)).items.find((item) => item.code === 'race_win')?.seen).toBe(false);

    // снятие: факт есть — выдача остаётся фактовой; повторное снятие — cleared: false без журнала
    const cleared = await panelAchievement(h, token, me.userId, 'clear', { code: 'race_win' });
    expect(cleared.status).toBe(200);
    expect(cleared.body).toEqual({ cleared: true, reconciled: true });
    expect((await grants().findOne({ userId: me.userId, code: 'race_win' }))?.override).toBeNull();
    const auditCount = (await auditOf(token)).length;
    expect(
      (await panelAchievement(h, token, me.userId, 'clear', { code: 'race_win' })).body,
    ).toEqual({
      cleared: false,
      reconciled: false,
    });
    expect(await auditOf(token)).toHaveLength(auditCount);
    expect((await auditOf(token)).map((entry) => entry.action)).toEqual([
      'achievement.override_cleared',
      'achievement.granted_manually',
      'achievement.revoked_manually',
    ]);
  });

  it('снятие ручной выдачи без факта: с маркером — сверка сразу отзывает; без маркера — reconciled: false и без записи', async () => {
    const me = await rider(h, 'me@example.com');
    const fresh = await rider(h, 'fresh@example.com');
    const other = await rider(h, 'other@example.com');
    const token = await admin();
    const season = await seedSeason(h);
    const race = await raceAt(h, season, [placedRow(other.userId, 1)], daysAgo(h, 5));
    await riderList(me);
    for (const who of [me, fresh]) {
      expect(
        (
          await panelAchievement(h, token, who.userId, 'grant', {
            code: 'race_win',
            objectId: race,
          })
        ).status,
      ).toBe(204);
    }
    expect(
      (await panelAchievement(h, token, me.userId, 'clear', { code: 'race_win' })).body,
    ).toEqual({
      cleared: true,
      reconciled: true,
    });
    expect(await grants().findOne({ userId: me.userId, code: 'race_win' })).toMatchObject({
      override: null,
      revokedAt: h.clock.now(),
    });

    expect(
      (await panelAchievement(h, token, fresh.userId, 'clear', { code: 'race_win' })).body,
    ).toEqual({
      cleared: true,
      reconciled: false,
    });
    expect(await grants().findOne({ userId: fresh.userId, code: 'race_win' })).toMatchObject({
      override: null,
      revokedAt: null,
    });
    expect(await achievementsDb(h).syncs.countDocuments({ _id: fresh.userId })).toBe(0);
  });

  it('маршрут и райд: дата — момент решения / старт райда; стал невидим — нет в ответе (лог без id)', async () => {
    const me = await rider(h, 'me@example.com');
    const other = await rider(h, 'other@example.com');
    const token = await admin();
    await riderList(me);
    const route = await catalogCorridorRoute(h, other.userId);
    const ride = await pastRide(h, other, [], 3, 'Утренний');
    expect(
      (
        await panelAchievement(h, token, me.userId, 'grant', {
          code: 'route_first',
          objectId: route,
        })
      ).status,
    ).toBe(204);
    expect(
      (await panelAchievement(h, token, me.userId, 'grant', { code: 'ride_first', objectId: ride }))
        .status,
    ).toBe(204);
    expect((await riderList(me)).items).toEqual([
      {
        code: 'route_first',
        object: { kind: 'route', id: route, title: 'Эталонный коридор' },
        factDate: minskToday(h.clock.now()),
        level: null,
        seen: false,
      },
      {
        code: 'ride_first',
        object: { kind: 'ride', id: ride, title: 'Утренний' },
        factDate: minskToday(daysAgo(h, 3)),
        level: null,
        seen: false,
      },
    ]);
    await hideInDb(h, ride);
    const warn = vi.spyOn(Logger.prototype, 'warn');
    expect((await riderList(me)).items.map((item) => item.code)).toEqual(['route_first']);
    expect(warn.mock.calls.map((args) => String(args[0]))).toContain(
      `achievements.manual_object_missing uid=${me.userId}`,
    );
  });
});

describe('панель — список выдач (5.G, RC-6)', () => {
  it('статусы, «по фактам», сотрудник решения, сезоны; ключи ответа — явный список', async () => {
    const me = await rider(h, 'me@example.com');
    const other = await rider(h, 'other@example.com');
    const { token, userId: adminId } = await staff(h, 'admin@example.com', 'admin');
    const season = await seedSeason(h);
    const past = await seedSeason(h, 'Сезон 2025', { year: 2025 });
    await seedProtocolRace(h, past, [placedRow(me.userId, 2), placedRow(other.userId, 1)]);
    await syncStandings(h);
    const won = await raceAt(h, season, [placedRow(me.userId, 1)], daysAgo(h, 10), 'Победная');
    await riderList(me); // race_first_finish, race_win, race_podium, season_podium
    const foreign = await raceAt(h, season, [placedRow(other.userId, 1)], daysAgo(h, 4), 'Чужая');
    expect(
      (await panelAchievement(h, token, me.userId, 'revoke', { code: 'race_podium' })).status,
    ).toBe(204);
    expect(
      (await panelAchievement(h, token, me.userId, 'grant', { code: 'races_5', objectId: foreign }))
        .status,
    ).toBe(204);
    expect(
      (
        await panelAchievement(h, token, me.userId, 'grant', {
          code: 'season_champion',
          objectId: past,
        })
      ).status,
    ).toBe(204);

    const { body, parsed } = await panelList(token, me.userId);
    expect(parsed.seasonsAvailable).toBe(true);
    const byCode = Object.fromEntries(parsed.items.map((item) => [item.code, item]));
    expect(byCode.races_5).toMatchObject({
      object: { kind: 'race', id: foreign, title: 'Чужая' },
      level: 'bronze',
      status: 'granted_manually',
      override: { decision: 'granted', by: { userId: adminId, displayName: 'Сотрудник admin' } },
      byFacts: { state: 'not_earned', level: null },
    });
    expect(byCode.race_podium).toMatchObject({
      object: { id: won, title: 'Победная' },
      status: 'revoked_manually',
      revokedAt: h.clock.now().toISOString(),
      byFacts: { state: 'earned', level: null },
    });
    expect(byCode.race_win).toMatchObject({ status: 'granted', override: null });
    expect(byCode.season_champion).toMatchObject({
      object: { kind: 'season', id: past, title: 'Сезон 2025' },
      factDate: '2025-10-31',
      status: 'granted_manually',
      byFacts: { state: 'not_earned', level: null },
    });
    expect(byCode.season_podium).toMatchObject({ status: 'granted', byFacts: { state: 'earned' } });
    const raw = (body as { items: Record<string, unknown>[] }).items[0]!;
    expect(Object.keys(body as object).sort()).toEqual(['items', 'seasonsAvailable']);
    expect(Object.keys(raw).sort()).toEqual([
      'byFacts',
      'code',
      'factDate',
      'grantedAt',
      'level',
      'object',
      'override',
      'revokedAt',
      'status',
    ]);
    expect(JSON.stringify(body)).not.toContain('me@example.com');

    // сезоны недоступны — названия null, «по фактам» unknown
    const { RIDER_SEASON_STANDINGS } = await import('../standings');
    vi.spyOn(h.app.get(RIDER_SEASON_STANDINGS, { strict: false }), 'outcomesOf').mockRejectedValue(
      new Error('down'),
    );
    vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    const degraded = (await panelList(token, me.userId)).parsed;
    expect(degraded.seasonsAvailable).toBe(false);
    expect(degraded.items.find((item) => item.code === 'season_champion')).toMatchObject({
      object: { title: null },
      byFacts: { state: 'unknown' },
    });
  });
});

describe('публичный список и карточка (RC-1)', () => {
  it('ручной отзыв гоночного убирает, ручная выдача race_* и сезонного добавляет, маршрут и райд — нет; карточка — объект документа, отзыв — null', async () => {
    const me = await rider(h, 'me@example.com');
    const other = await rider(h, 'other@example.com');
    const token = await admin();
    const season = await seedSeason(h);
    const past = await seedSeason(h, 'Сезон 2025', { year: 2025 });
    await seedProtocolRace(h, past, [placedRow(other.userId, 1)]);
    await syncStandings(h);
    await raceAt(h, season, [placedRow(me.userId, 1)], daysAgo(h, 10), 'Своя');
    const foreign = await raceAt(h, season, [placedRow(other.userId, 1)], daysAgo(h, 4), 'Чужая');
    const route = await catalogCorridorRoute(h, other.userId);
    await riderList(me);
    const publicId = await publicIdOf(me);
    const publicCodes = async () => {
      const res = await call(h, 'GET', `/v1/riders/${publicId}/achievements`);
      return PublicRiderAchievementList.parse(res.body).items.map(
        (item) => `${item.code}:${item.object.title}`,
      );
    };
    expect(await publicCodes()).toEqual([
      'race_win:Своя',
      'race_podium:Своя',
      'race_first_finish:Своя',
    ]);

    await panelAchievement(h, token, me.userId, 'revoke', { code: 'race_win' });
    await panelAchievement(h, token, me.userId, 'grant', { code: 'races_5', objectId: foreign });
    await panelAchievement(h, token, me.userId, 'grant', {
      code: 'season_champion',
      objectId: past,
    });
    await panelAchievement(h, token, me.userId, 'grant', { code: 'route_first', objectId: route });
    // ручная — дата объекта (начало окна гонки), сезон — последний миг сезона
    expect(await publicCodes()).toEqual([
      'race_podium:Своя',
      'race_first_finish:Своя',
      'races_5:Чужая',
      'season_champion:Сезон 2025',
    ]);

    expect(await sharing().cardFacts(me.userId, { code: 'races_5', seasonId: null })).toEqual({
      code: 'races_5',
      object: { kind: 'race', id: foreign, title: 'Чужая' },
      factDate: expect.any(String),
      level: 'bronze',
    });
    expect(
      await sharing().cardFacts(me.userId, { code: 'route_first', seasonId: null }),
    ).toMatchObject({
      object: { kind: 'route', id: route, title: 'Эталонный коридор' },
    });
    expect(await sharing().cardFacts(me.userId, { code: 'race_win', seasonId: null })).toBeNull();
  });
});

describe('сезонные (5.A–5.D)', () => {
  it('выдача без заработка — в списке; отзыв заработанного — пропадает, сверка не восстанавливает; снятие — восстанавливает', async () => {
    const me = await rider(h, 'me@example.com');
    const other = await rider(h, 'other@example.com');
    const token = await admin();
    const a = await seedSeason(h, 'Сезон 2025', { year: 2025 });
    const b = await seedSeason(h, 'Сезон 2024', { year: 2024 });
    await seedProtocolRace(h, a, [placedRow(me.userId, 1)]);
    const raceB = await seedProtocolRace(h, b, [placedRow(other.userId, 1)]);
    await syncStandings(h);
    await riderList(me); // a: champion + podium

    // ручная выдача в сезоне b; сезон в `pending` (новая ревизия) — выдача тоже возможна
    await addRevision(h, raceB, 2, [placedRow(other.userId, 1)]);
    expect(
      (
        await panelAchievement(h, token, me.userId, 'grant', {
          code: 'season_regular',
          objectId: b,
        })
      ).status,
    ).toBe(204);
    const docB = await seasonGrants().findOne({
      userId: me.userId,
      code: 'season_regular',
      seasonId: b,
    });
    expect(docB).toMatchObject({
      factAt: new Date(new Date('2024-10-31T21:00:00Z').getTime() - 1),
      seenAt: null,
      override: { decision: 'granted' },
    });
    expect(await noticed()).toEqual([
      { grant: 'season', grantId: docB!._id, level: null, origin: 'server' },
    ]);
    await syncStandings(h);
    await reconciler().reconcile(me.userId, 'server');
    expect((await riderList(me)).items.filter((item) => item.object.id === b)).toEqual([
      {
        code: 'season_regular',
        object: { kind: 'season', id: b, title: 'Сезон 2024' },
        factDate: '2024-10-31',
        level: null,
        seen: false,
      },
    ]);
    expect(
      (
        await panelAchievement(h, token, me.userId, 'grant', {
          code: 'season_regular',
          objectId: b,
        })
      ).status,
    ).toBe(409);

    // отзыв заработанного — сверка не восстанавливает; сезонный адрес обязателен
    expect(
      (
        await panelAchievement(h, token, me.userId, 'revoke', {
          code: 'season_champion',
          seasonId: a,
        })
      ).status,
    ).toBe(204);
    await reconciler().reconcile(me.userId, 'server');
    expect(
      (await riderList(me)).items.filter((item) => item.object.id === a).map((item) => item.code),
    ).toEqual(['season_podium']);
    expect(
      (
        await panelAchievement(h, token, me.userId, 'revoke', {
          code: 'season_champion',
          seasonId: a,
        })
      ).body,
    ).toMatchObject({ details: { reason: 'not_granted' } });

    expect(
      (
        await panelAchievement(h, token, me.userId, 'clear', {
          code: 'season_champion',
          seasonId: a,
        })
      ).body,
    ).toEqual({ cleared: true, reconciled: true });
    expect(
      (await riderList(me)).items.filter((item) => item.object.id === a).map((item) => item.code),
    ).toEqual(['season_champion', 'season_podium']);
    const actions = (await auditOf(token)).map((entry) => [entry.action, entry.details]);
    expect(actions[0]).toEqual([
      'achievement.override_cleared',
      { achievementCode: 'season_champion', objectKind: 'season', objectId: a },
    ]);
  });
});

describe('стирание аккаунта', () => {
  it('удаляет ручные документы обеих коллекций', async () => {
    const me = await rider(h, 'me@example.com');
    const token = await admin();
    const season = await seedSeason(h);
    const past = await seedSeason(h, 'Сезон 2025', { year: 2025 });
    await seedProtocolRace(h, past, [placedRow(me.userId, 3)]);
    await syncStandings(h);
    const race = await raceAt(h, season, [placedRow(me.userId, 9)], daysAgo(h, 3));
    await panelAchievement(h, token, me.userId, 'grant', { code: 'race_win', objectId: race });
    await panelAchievement(h, token, me.userId, 'grant', {
      code: 'season_champion',
      objectId: past,
    });
    expect(await h.app.get(AchievementErasure, { strict: false }).erase(me.userId)).toEqual({
      grants: 1,
      seasonGrants: 1,
      syncs: 0,
    });
  });
});
