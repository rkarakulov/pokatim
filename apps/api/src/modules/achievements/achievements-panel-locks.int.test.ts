import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  ACHIEVEMENTS,
  achievementsDb,
  daysAgo,
  panelAchievement,
  raceAt,
} from '../../../test/achievements';
import { createHarness, type Harness } from '../../../test/harness';
import { eventsOfType } from '../../../test/notifications';
import { staff } from '../../../test/races';
import { authed, rider, type Rider } from '../../../test/rides';
import {
  addRevision,
  placedRow,
  seedProtocolRace,
  seedSeason,
  syncStandings,
} from '../../../test/standings';
import { AchievementFactsReader } from './achievement-facts.reader';
import { AchievementsReconciler } from './achievements-reconciler';
import { ACHIEVEMENTS_GRANT_NOTICED, AchievementsGrantNoticed } from './achievements.events';
import type { FactAchievementCode, SeasonalKey } from './achievements.policy';
import { AchievementsRepository } from './achievements.repository';

/**
 * Гонки ручного решения панели и сверки одного райдера (achievements-panel, M8, AC4): **ворота** — сверка (`read` или
 * `server`) прочитала выдачи и факты и ждёт (обёртка над `facts.evaluate`), ручное действие коммитится, ворота
 * открываются — устаревший план не перезаписывает ручное решение (фильтр `override: null` каждой записи сверки, вставка —
 * уникальный индекс). **Отрицательное доказательство** — те же ворота, запись сверки прежним фильтром без `override`
 * (прямой вызов коллекции из теста): ручное решение перезаписано — сценарий действительно воспроизводит гонку
 * (`.claude/rules/pokatim-tests.md`).
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

const repository = () => h.app.get(AchievementsRepository, { strict: false });
const reconciler = () => h.app.get(AchievementsReconciler, { strict: false });
const factsReader = () => h.app.get(AchievementFactsReader, { strict: false });
const grants = () => achievementsDb(h).grants;
const seasonGrants = () => achievementsDb(h).seasonGrants;
const noticed = async () =>
  (await eventsOfType(h, ACHIEVEMENTS_GRANT_NOTICED)).map((event) =>
    AchievementsGrantNoticed.parse(event.payload),
  );

function deferred() {
  let resolve: () => void = () => undefined;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

/**
 * Ворота следующей сверки: выдачи обеих коллекций и факты прочитаны (план будет по этому снимку) → `reached`; запись
 * — после `open()`.
 */
function holdNextReconcile() {
  const repo = repository();
  const facts = factsReader();
  const gate = deferred();
  const reached = deferred();
  const listed = [deferred(), deferred()];
  const listOf = AchievementsRepository.prototype.listOf;
  const listSeasonalOf = AchievementsRepository.prototype.listSeasonalOf;
  const evaluate = AchievementFactsReader.prototype.evaluate;
  vi.spyOn(repo, 'listOf').mockImplementationOnce(async (userId) => {
    const result = await listOf.call(repo, userId);
    listed[0]!.resolve();
    return result;
  });
  vi.spyOn(repo, 'listSeasonalOf').mockImplementationOnce(async (userId) => {
    const result = await listSeasonalOf.call(repo, userId);
    listed[1]!.resolve();
    return result;
  });
  vi.spyOn(facts, 'evaluate').mockImplementationOnce(async (userId) => {
    const result = await evaluate.call(facts, userId);
    await Promise.all(listed.map((item) => item.promise));
    reached.resolve();
    await gate.promise;
    return result;
  });
  return { reached: reached.promise, open: gate.resolve };
}

/** Механизм убран: отзыв сверки прежним фильтром без `override` — прямой вызов коллекции. */
function revokeWithoutOverrideFilter() {
  vi.spyOn(repository(), 'revoke').mockImplementation(
    async (userId: string, code: FactAchievementCode, now: Date) => {
      const result = await grants().updateOne(
        { userId, code, revokedAt: null },
        { $set: { revokedAt: now, updatedAt: now } },
      );
      return result.modifiedCount === 1;
    },
  );
}

/** Механизм убран: сезонное восстановление прежним фильтром без `override`. */
function restoreSeasonalWithoutOverrideFilter() {
  vi.spyOn(repository(), 'restoreSeasonal').mockImplementation(
    async (userId: string, key: SeasonalKey, now: Date) => {
      const result = await seasonGrants().updateOne(
        { userId, code: key.code, seasonId: key.seasonId, revokedAt: { $ne: null } },
        { $set: { revokedAt: null, updatedAt: now } },
      );
      return result.modifiedCount === 1;
    },
  );
}

interface Stand {
  me: Rider;
  token: string;
  race: string;
  season: string;
}

/** Райдер после первой сверки с фактовой видимой `race_win` (гонка `race`, место 1). */
async function standWithWin(): Promise<Stand> {
  const me = await rider(h, 'me@example.com');
  const { token } = await staff(h, 'admin@example.com', 'admin');
  const season = await seedSeason(h);
  const race = await raceAt(h, season, [placedRow(me.userId, 1)], daysAgo(h, 10), 'Весенняя');
  expect((await authed(h, me, 'GET', ACHIEVEMENTS)).status).toBe(200);
  return { me, token, race, season };
}

const grantOf = (userId: string, code: FactAchievementCode) => grants().findOne({ userId, code });

/** Сверка с устаревшим планом против ручного действия, закоммиченного между чтением и записью. */
async function raceAgainst(
  userId: string,
  origin: 'read' | 'server',
  manual: () => Promise<void>,
): Promise<void> {
  const hold = holdNextReconcile();
  const sync = reconciler().reconcile(userId, origin);
  await hold.reached;
  await manual();
  hold.open();
  await sync;
}

describe('ворота: устаревший план сверки против ручного решения (M8)', () => {
  it.each(['read', 'server'] as const)(
    '(1) план revoke (%s) против ручной выдачи — документ видим, решение прежнее',
    async (origin) => {
      const { me, token, race } = await standWithWin();
      await addRevision(h, race, 2, [placedRow(me.userId, 5)]); // факт победы пропал → план revoke
      await raceAgainst(me.userId, origin, async () => {
        expect(
          (await panelAchievement(h, token, me.userId, 'revoke', { code: 'race_win' })).status,
        ).toBe(204);
        expect(
          (
            await panelAchievement(h, token, me.userId, 'grant', {
              code: 'race_win',
              objectId: race,
            })
          ).status,
        ).toBe(204);
      });
      expect(await grantOf(me.userId, 'race_win')).toMatchObject({
        revokedAt: null,
        override: { decision: 'granted' },
      });
    },
  );

  it('(2) план refresh против ручного отзыва — revokedAt и решение прежние, события нет; против ручной выдачи — объект ручной', async () => {
    const { me, token, race, season } = await standWithWin();
    // «Подиум» переедет на более раннюю гонку → план refresh
    const earlier = await raceAt(h, season, [placedRow(me.userId, 3)], daysAgo(h, 20), 'Ранняя');
    await raceAgainst(me.userId, 'read', async () => {
      expect(
        (await panelAchievement(h, token, me.userId, 'revoke', { code: 'race_podium' })).status,
      ).toBe(204);
    });
    const revoked = await grantOf(me.userId, 'race_podium');
    expect(revoked).toMatchObject({
      object: { kind: 'race', id: race },
      revokedAt: expect.any(Date),
      override: { decision: 'revoked' },
    });
    expect(await noticed()).toEqual([]);

    // ручная выдача на прежнем объекте, сверка хочет перенести на раннюю гонку: подготовка — видимая фактовая на
    // прежнем объекте (план refresh)
    await panelAchievement(h, token, me.userId, 'clear', { code: 'race_podium' });
    await grants().updateOne(
      { userId: me.userId, code: 'race_podium' },
      { $set: { revokedAt: null, object: { kind: 'race', id: race } } },
    );
    await raceAgainst(me.userId, 'server', async () => {
      await panelAchievement(h, token, me.userId, 'revoke', { code: 'race_podium' });
      expect(
        (
          await panelAchievement(h, token, me.userId, 'grant', {
            code: 'race_podium',
            objectId: race,
          })
        ).status,
      ).toBe(204);
    });
    expect(await grantOf(me.userId, 'race_podium')).toMatchObject({
      object: { kind: 'race', id: race },
      revokedAt: null,
      override: { decision: 'granted' },
    });
    expect(earlier).not.toBe(race);
  });

  it('(3) план restore в транзакции с событием против ручной выдачи — одно событие (ручное), notifiedLevel ручной; против ручного отзыва — не восстанавливает', async () => {
    const { me, token, race } = await standWithWin();
    await addRevision(h, race, 2, [placedRow(me.userId, 5)]);
    await reconciler().reconcile(me.userId, 'server'); // отзыв сверкой
    await addRevision(h, race, 3, [placedRow(me.userId, 1)]); // факт вернулся → план restore
    await raceAgainst(me.userId, 'server', async () => {
      expect(
        (await panelAchievement(h, token, me.userId, 'grant', { code: 'race_win', objectId: race }))
          .status,
      ).toBe(204);
    });
    const doc = await grantOf(me.userId, 'race_win');
    expect(doc).toMatchObject({
      revokedAt: null,
      override: { decision: 'granted' },
      notifiedLevel: 1,
    });
    expect(await noticed()).toEqual([
      { grant: 'fact', grantId: doc!._id, level: null, origin: 'server' },
    ]);

    // ручной отзыв, пока сверка держит план restore по отозванному сверкой документу
    await panelAchievement(h, token, me.userId, 'clear', { code: 'race_win' });
    await addRevision(h, race, 4, [placedRow(me.userId, 5)]);
    await reconciler().reconcile(me.userId, 'server');
    expect((await grantOf(me.userId, 'race_win'))?.revokedAt).not.toBeNull();
    await addRevision(h, race, 5, [placedRow(me.userId, 1)]);
    await raceAgainst(me.userId, 'read', async () => {
      await panelAchievement(h, token, me.userId, 'grant', { code: 'race_win', objectId: race });
      await panelAchievement(h, token, me.userId, 'revoke', { code: 'race_win' });
    });
    expect(await grantOf(me.userId, 'race_win')).toMatchObject({
      revokedAt: expect.any(Date),
      override: { decision: 'revoked' },
    });
    expect(await noticed()).toHaveLength(2); // две ручные выдачи, у сверки — ни одного
  });

  it('(4) вставка: ручная первой — вставка сверки false без события; сверка первой — ручная 409', async () => {
    const { me, token, season } = await standWithWin();
    const podium = await raceAt(h, season, [placedRow(me.userId, 2)], daysAgo(h, 5), 'Вторая');
    await grants().deleteOne({ userId: me.userId, code: 'race_podium' });
    await raceAgainst(me.userId, 'read', async () => {
      expect(
        (
          await panelAchievement(h, token, me.userId, 'grant', {
            code: 'race_podium',
            objectId: podium,
          })
        ).status,
      ).toBe(204);
    });
    expect(await grants().countDocuments({ userId: me.userId, code: 'race_podium' })).toBe(1);
    expect(await grantOf(me.userId, 'race_podium')).toMatchObject({
      object: { id: podium },
      override: { decision: 'granted' },
    });
    expect(await noticed()).toHaveLength(1);

    // сверка первой: выдала с событием → ручная выдача видимой — 409
    await grants().deleteOne({ userId: me.userId, code: 'race_first_finish' });
    await reconciler().reconcile(me.userId, 'read');
    const conflict = await panelAchievement(h, token, me.userId, 'grant', {
      code: 'race_first_finish',
      objectId: podium,
    });
    expect(conflict.status).toBe(409);
    expect(conflict.body).toMatchObject({ details: { reason: 'already_granted' } });
    expect((await grantOf(me.userId, 'race_first_finish'))?.override).toBeNull();
  });

  it('(5) сезонные: план revoke против ручной выдачи, план restore против ручного отзыва, вставка против ручной выдачи', async () => {
    const me = await rider(h, 'me@example.com');
    const other = await rider(h, 'other@example.com');
    const { token } = await staff(h, 'admin@example.com', 'admin');
    const season = await seedSeason(h, 'Сезон 2025', { year: 2025 });
    const race = await seedProtocolRace(h, season, [
      placedRow(me.userId, 1),
      placedRow(other.userId, 2),
    ]);
    await syncStandings(h);
    expect((await authed(h, me, 'GET', ACHIEVEMENTS)).status).toBe(200);
    const champion = () =>
      seasonGrants().findOne({ userId: me.userId, code: 'season_champion', seasonId: season });
    const key = { code: 'season_champion', seasonId: season };

    // revoke vs ручная выдача
    await addRevision(h, race, 2, [placedRow(other.userId, 1), placedRow(me.userId, 2)]);
    await syncStandings(h);
    await raceAgainst(me.userId, 'server', async () => {
      await panelAchievement(h, token, me.userId, 'revoke', key);
      expect(
        (
          await panelAchievement(h, token, me.userId, 'grant', {
            code: 'season_champion',
            objectId: season,
          })
        ).status,
      ).toBe(204);
    });
    expect(await champion()).toMatchObject({ revokedAt: null, override: { decision: 'granted' } });

    // restore vs ручной отзыв: снято → сверка отозвала → факт вернулся
    await panelAchievement(h, token, me.userId, 'clear', key);
    expect((await champion())?.revokedAt).not.toBeNull();
    await addRevision(h, race, 3, [placedRow(me.userId, 1), placedRow(other.userId, 2)]);
    await syncStandings(h);
    await raceAgainst(me.userId, 'read', async () => {
      await panelAchievement(h, token, me.userId, 'grant', {
        code: 'season_champion',
        objectId: season,
      });
      await panelAchievement(h, token, me.userId, 'revoke', key);
    });
    expect(await champion()).toMatchObject({
      revokedAt: expect.any(Date),
      override: { decision: 'revoked' },
    });

    // вставка vs ручная выдача (нового сезона)
    const next = await seedSeason(h, 'Сезон 2024', { year: 2024 });
    await seedProtocolRace(h, next, [placedRow(me.userId, 1)]);
    await syncStandings(h);
    const before = (await noticed()).length;
    await raceAgainst(me.userId, 'read', async () => {
      expect(
        (
          await panelAchievement(h, token, me.userId, 'grant', {
            code: 'season_champion',
            objectId: next,
          })
        ).status,
      ).toBe(204);
    });
    expect(
      await seasonGrants().countDocuments({
        userId: me.userId,
        code: 'season_champion',
        seasonId: next,
      }),
    ).toBe(1);
    expect(
      await seasonGrants().findOne({ userId: me.userId, code: 'season_champion', seasonId: next }),
    ).toMatchObject({ override: { decision: 'granted' } });
    // ручная — одно событие; вставка сверки этого ключа — без события (podium — своё событие сверки)
    const fresh = (await noticed()).slice(before);
    expect(fresh.filter((event) => event.grant === 'season')).toHaveLength(2);
  });

  it('(6) параллельно ручная выдача и сверка ×6 — одна выдача, одно событие, решение согласовано с ответом', async () => {
    const { me, token, season } = await standWithWin();
    for (let k = 0; k < 6; k += 1) {
      const podium = await raceAt(h, season, [placedRow(me.userId, 2)], daysAgo(h, 5 - k * 0.1));
      await grants().deleteOne({ userId: me.userId, code: 'race_podium' });
      const [res] = await Promise.all([
        panelAchievement(h, token, me.userId, 'grant', { code: 'race_podium', objectId: podium }),
        reconciler().reconcile(me.userId, k % 2 === 0 ? 'read' : 'server'),
      ]);
      const docs = await grants().find({ userId: me.userId, code: 'race_podium' }).toArray();
      expect(docs).toHaveLength(1);
      expect([204, 409]).toContain(res.status);
      expect(docs[0]!.override?.decision ?? null).toBe(res.status === 204 ? 'granted' : null);
      expect(docs[0]!.revokedAt).toBeNull();
      // одно событие на выдачу «Подиума»: ручное или сверки, не оба
      expect((await noticed()).filter((event) => event.grantId === docs[0]!._id)).toHaveLength(1);
    }
  });
});

describe('отрицательное доказательство: запись сверки без условия override', () => {
  it('прежний фильтр отзыва — ручная выдача перезаписана устаревшим планом', async () => {
    const { me, token, race } = await standWithWin();
    await addRevision(h, race, 2, [placedRow(me.userId, 5)]);
    revokeWithoutOverrideFilter();
    await raceAgainst(me.userId, 'server', async () => {
      await panelAchievement(h, token, me.userId, 'revoke', { code: 'race_win' });
      await panelAchievement(h, token, me.userId, 'grant', { code: 'race_win', objectId: race });
    });
    // механизм убран — ручная выдача стала отозванной (райдер её потерял), хотя решение `granted`
    expect(await grantOf(me.userId, 'race_win')).toMatchObject({
      revokedAt: expect.any(Date),
      override: { decision: 'granted' },
    });
  });

  it('прежний фильтр сезонного восстановления — ручной отзыв перезаписан устаревшим планом', async () => {
    const me = await rider(h, 'me@example.com');
    const other = await rider(h, 'other@example.com');
    const { token } = await staff(h, 'admin@example.com', 'admin');
    const season = await seedSeason(h, 'Сезон 2025', { year: 2025 });
    const race = await seedProtocolRace(h, season, [
      placedRow(me.userId, 1),
      placedRow(other.userId, 2),
    ]);
    await syncStandings(h);
    expect((await authed(h, me, 'GET', ACHIEVEMENTS)).status).toBe(200);
    await addRevision(h, race, 2, [placedRow(other.userId, 1), placedRow(me.userId, 2)]);
    await syncStandings(h);
    await reconciler().reconcile(me.userId, 'server'); // отзыв сверкой
    await addRevision(h, race, 3, [placedRow(me.userId, 1), placedRow(other.userId, 2)]);
    await syncStandings(h);
    restoreSeasonalWithoutOverrideFilter();
    const key = { code: 'season_champion', seasonId: season };
    await raceAgainst(me.userId, 'read', async () => {
      await panelAchievement(h, token, me.userId, 'grant', {
        code: 'season_champion',
        objectId: season,
      });
      await panelAchievement(h, token, me.userId, 'revoke', key);
    });
    expect(
      await seasonGrants().findOne({
        userId: me.userId,
        code: 'season_champion',
        seasonId: season,
      }),
    ).toMatchObject({ revokedAt: null, override: { decision: 'revoked' } });
  });
});
