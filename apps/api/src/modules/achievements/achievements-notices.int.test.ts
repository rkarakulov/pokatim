import { Logger } from '@nestjs/common';
import { MongoOutboxWriter } from '@rkarakulov/api-kit/mongo';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { ACHIEVEMENTS, achievementsDb, daysAgo, raceAt, racesAt } from '../../../test/achievements';
import { createHarness, type Harness } from '../../../test/harness';
import { eventsOfType, notificationsIntake, notificationsOf } from '../../../test/notifications';
import { authed, rider, type Rider } from '../../../test/rides';
import {
  addRevision,
  dqRow,
  placedRow,
  seedProtocolRace,
  seedSeason,
  syncStandings,
} from '../../../test/standings';
import type { DbSession } from '../../db';
import { ACHIEVEMENT_NOTICES, type AchievementNotices } from './achievement-notices.port';
import { AchievementsReconciler } from './achievements-reconciler';
import { ACHIEVEMENTS_GRANT_NOTICED, AchievementsGrantNoticed } from './achievements.events';
import { ACHIEVEMENT_GRANTS_UNIQUE_INDEX, AchievementsRepository } from './achievements.repository';

/**
 * Уведомление о выдаче (achievements-push N1): гарантии транзакции «выдача + событие» — отрицательными
 * доказательствами (`.claude/rules/pokatim-tests.md`): механизм убран подменой репозитория — тест показывает нарушение
 * по результату (выдача без события, лишнее событие), не по таймауту. И порт `ACHIEVEMENT_NOTICES`: `gone`/`state`.
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
const notices = () => h.app.get<AchievementNotices>(ACHIEVEMENT_NOTICES, { strict: false });
const noticed = async () =>
  (await eventsOfType(h, ACHIEVEMENTS_GRANT_NOTICED)).map((event) =>
    AchievementsGrantNoticed.parse(event.payload),
  );
const get = (who: Rider) => authed(h, who, 'GET', ACHIEVEMENTS);

function barrier(n: number) {
  let arrived = 0;
  let open: () => void = () => undefined;
  const opened = new Promise<void>((resolve) => {
    open = resolve;
  });
  return async () => {
    arrived += 1;
    if (arrived === n) open();
    if (arrived <= n) await opened;
  };
}

/** Все параллельные сверки читают состояние до записей (детерминированная гонка). */
function readTogether(n: number) {
  const wait = barrier(n);
  const original = AchievementsRepository.prototype.syncedAt;
  vi.spyOn(repository(), 'syncedAt').mockImplementation(async function (
    this: AchievementsRepository,
    userId: string,
  ) {
    const result = await original.call(this, userId);
    await wait();
    return result;
  });
}

/** Райдер после первой сверки и новый факт «Подиума» (вставка с событием при следующей сверке). */
async function riderWithNewPodium(): Promise<Rider> {
  const me = await rider(h, 'me@example.com');
  const season = await seedSeason(h);
  await raceAt(h, season, [placedRow(me.userId, 5)], daysAgo(h, 10));
  expect((await get(me)).status).toBe(200);
  await raceAt(h, season, [placedRow(me.userId, 2)], daysAgo(h, 1));
  return me;
}

const podiums = (userId: string) =>
  achievementsDb(h).grants.countDocuments({ userId, code: 'race_podium' });

describe('транзакция «выдача + событие» (отрицательные доказательства)', () => {
  it('(а) сбой записи события откатывает выдачу — следующая сверка выдаёт с событием; запись вне транзакции — выдача без события навсегда', async () => {
    vi.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    const run = async (inTransaction: boolean) => {
      await h.reset();
      const me = await riderWithNewPodium();
      const repo = repository();
      if (!inTransaction) {
        // механизм убран: вставка выдачи вне транзакции события (коммитится сама)
        const original = AchievementsRepository.prototype.insertGrantInTx;
        vi.spyOn(repo, 'insertGrantInTx').mockImplementation((_tx, ...rest) =>
          original.call(repo, undefined as unknown as DbSession, ...rest),
        );
      }
      const append = vi
        .spyOn(h.app.get(MongoOutboxWriter, { strict: false }), 'append')
        .mockRejectedValueOnce(new Error('outbox unavailable'));
      expect((await get(me)).status).toBe(500);
      append.mockRestore();
      expect((await get(me)).status).toBe(200);
      const result = { grants: await podiums(me.userId), events: (await noticed()).length };
      vi.restoreAllMocks();
      vi.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
      return result;
    };
    expect(await run(true)).toEqual({ grants: 1, events: 1 });
    expect(await run(false)).toEqual({ grants: 1, events: 0 });
  });

  it('(б) дубль уникального индекса ловится снаружи транзакции — проигравшая сверка без события; перехват внутри колбэка — транзакция оборвана сервером (NoSuchTransaction, 500)', async () => {
    vi.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    const run = async (catchInside: boolean) => {
      await h.reset();
      const me = await riderWithNewPodium();
      const repo = repository();
      const appendErrors: string[] = [];
      if (catchInside) {
        // механизм нарушен: дубль глотается внутри колбэка, а транзакцию сервер уже оборвал — следующая операция
        // (событие) падает, драйвер повторяет колбэк; ворота останавливают повтор после первого отказа
        const writer = h.app.get(MongoOutboxWriter, { strict: false });
        const originalAppend = MongoOutboxWriter.prototype.append;
        vi.spyOn(writer, 'append').mockImplementation(async (...args) => {
          try {
            return await originalAppend.apply(writer, args);
          } catch (error) {
            appendErrors.push((error as { codeName?: string }).codeName ?? 'unknown');
            throw error;
          }
        });
        const original = AchievementsRepository.prototype.insertGrantInTx;
        vi.spyOn(repo, 'insertGrantInTx').mockImplementation(async (...args) => {
          if (appendErrors.length > 0) throw new Error('stop: callback retried');
          try {
            await original.apply(repo, args);
          } catch (error) {
            if (
              !(error instanceof Error) ||
              !error.message.includes(ACHIEVEMENT_GRANTS_UNIQUE_INDEX)
            )
              throw error;
          }
        });
      }
      // проигравшая сверка: план по снимку до вставки победившей (её выдачи «Подиума» ещё нет) — вставка даёт дубль
      expect((await get(me)).status).toBe(200);
      const originalList = AchievementsRepository.prototype.listOf;
      vi.spyOn(repo, 'listOf').mockImplementationOnce(async (userId) =>
        (await originalList.call(repo, userId)).filter((grant) => grant.code !== 'race_podium'),
      );
      const statuses = [200, (await get(me)).status];
      const result = {
        statuses: statuses.sort(),
        grants: await podiums(me.userId),
        events: (await noticed()).length,
        appendErrors,
      };
      vi.restoreAllMocks();
      vi.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
      return result;
    };
    expect(await run(false)).toEqual({
      statuses: [200, 200],
      grants: 1,
      events: 1,
      appendErrors: [],
    });
    const broken = await run(true);
    expect(broken.statuses).toContain(500);
    expect(broken.appendErrors).toEqual(['NoSuchTransaction']);
    expect(broken).toMatchObject({ grants: 1, events: 1 });
  });

  it('(в) решение о событии — по документу в транзакции: без условия notifiedLevel параллельные сверки дают два события (центр схлопывает в одно)', async () => {
    const run = async (inDocument: boolean) => {
      await h.reset();
      const me = await rider(h, 'me@example.com');
      const season = await seedSeason(h);
      await racesAt(h, season, me.userId, 5, 100);
      expect((await get(me)).status).toBe(200);
      await racesAt(h, season, me.userId, 10, 50);
      const repo = repository();
      if (!inDocument) {
        // механизм убран: решение по снимку плана (бронза, ничего не объявлено), а не по документу до записи
        const original = AchievementsRepository.prototype.restoreOrRefresh;
        vi.spyOn(repo, 'restoreOrRefresh').mockImplementation(async (...args) => {
          const before = await original.apply(repo, args);
          return before && { ...before, level: 1, notifiedLevel: 1, seenLevel: 1 };
        });
      }
      readTogether(3);
      await Promise.all([
        reconciler().reconcile(me.userId, 'read'),
        reconciler().reconcile(me.userId, 'read'),
        reconciler().reconcile(me.userId, 'server'),
      ]);
      const events = (await noticed()).filter((event) => event.level === 2).length;
      await notificationsIntake(h).drain();
      const silver = (await notificationsOf(h, me.userId)).filter((doc) =>
        doc.title.startsWith('Новый уровень'),
      ).length;
      vi.restoreAllMocks();
      return { events, silver };
    };
    expect(await run(true)).toEqual({ events: 1, silver: 1 });
    const broken = await run(false);
    expect(broken.events).toBeGreaterThan(1);
    // вторая линия (N7): схлопывание `achievement:<grantId>` по рангу — уведомление одно
    expect(broken.silver).toBe(1);
  });
});

describe('порт ACHIEVEMENT_NOTICES', () => {
  it('выдача: владелец, код, уровень, объект из фактов; отозвана — state; ранг ниже объявленного — state; стёрта — gone', async () => {
    const me = await rider(h, 'me@example.com');
    const season = await seedSeason(h);
    expect((await get(me)).status).toBe(200);
    const race = await raceAt(h, season, [placedRow(me.userId, 2)], daysAgo(h, 1), 'Осенняя');
    expect((await get(me)).status).toBe(200);
    const grant = await achievementsDb(h).grants.findOne({
      userId: me.userId,
      code: 'race_podium',
    });
    const event = {
      grant: 'fact' as const,
      grantId: grant!._id,
      level: null,
      origin: 'read' as const,
    };
    expect((await noticed()).map((one) => one.grantId)).toContain(grant!._id);

    expect(await notices().notice(event, h.clock.now())).toEqual({
      userId: me.userId,
      code: 'race_podium',
      level: null,
      object: { kind: 'race', title: 'Осенняя' },
      seasonId: null,
    });
    expect(await notices().notice({ ...event, level: 2 }, h.clock.now())).toBe('state');

    await addRevision(h, race, 2, [dqRow(me.userId)]);
    expect((await get(me)).status).toBe(200);
    expect(await notices().notice(event, h.clock.now())).toBe('state');

    await repository().deleteAllOf(me.userId);
    expect(await notices().notice(event, h.clock.now())).toBe('gone');
  });

  it('факт пропал, а сверки ещё не было — state (о прежнем состоянии не сообщаем)', async () => {
    const me = await rider(h, 'me@example.com');
    const season = await seedSeason(h);
    expect((await get(me)).status).toBe(200);
    const race = await raceAt(h, season, [placedRow(me.userId, 2)], daysAgo(h, 1));
    expect((await get(me)).status).toBe(200);
    const grant = await achievementsDb(h).grants.findOne({
      userId: me.userId,
      code: 'race_podium',
    });
    await addRevision(h, race, 2, [dqRow(me.userId)]);
    expect(
      await notices().notice(
        { grant: 'fact', grantId: grant!._id, level: null, origin: 'server' },
        h.clock.now(),
      ),
    ).toBe('state');
  });

  it('сезонная: название сезона, seasonId; отозвана — state', async () => {
    const me = await rider(h, 'me@example.com');
    expect((await get(me)).status).toBe(200);
    const season = await seedSeason(h, 'Сезон 2025', { year: 2025 });
    await seedProtocolRace(h, season, [placedRow(me.userId, 1)]);
    await syncStandings(h);
    expect((await get(me)).status).toBe(200);
    const grant = await achievementsDb(h).seasonGrants.findOne({
      userId: me.userId,
      code: 'season_champion',
    });
    const event = {
      grant: 'season' as const,
      grantId: grant!._id,
      level: null,
      origin: 'read' as const,
    };
    expect(await notices().notice(event, h.clock.now())).toEqual({
      userId: me.userId,
      code: 'season_champion',
      level: null,
      object: { kind: 'season', title: 'Сезон 2025' },
      seasonId: season,
    });
    await achievementsDb(h).seasonGrants.updateOne(
      { _id: grant!._id },
      { $set: { revokedAt: h.clock.now() } },
    );
    expect(await notices().notice(event, h.clock.now())).toBe('state');
  });

  it('сезонная: пересчёт снимка отнял место до приёма события (без промежуточного GET) — state, уведомления нет; ревизия без пересчёта (`pending`) — state', async () => {
    const me = await rider(h, 'me@example.com');
    const other = await rider(h, 'other@example.com');
    expect((await get(me)).status).toBe(200);
    const season = await seedSeason(h, 'Сезон 2025', { year: 2025 });
    const race = await seedProtocolRace(h, season, [
      placedRow(me.userId, 1),
      placedRow(other.userId, 2),
    ]);
    await syncStandings(h);
    expect((await get(me)).status).toBe(200);
    const grant = await achievementsDb(h).seasonGrants.findOne({
      userId: me.userId,
      code: 'season_champion',
    });
    expect((await noticed()).map((one) => one.grantId)).toContain(grant!._id);
    const event = {
      grant: 'season' as const,
      grantId: grant!._id,
      level: null,
      origin: 'read' as const,
    };

    await addRevision(h, race, 2, [placedRow(other.userId, 1), placedRow(me.userId, 2)]);
    // снимок устарел (`pending`): чемпионство не подтверждено — не объявляем
    expect(await notices().notice(event, h.clock.now())).toBe('state');

    await syncStandings(h);
    expect(await notices().notice(event, h.clock.now())).toBe('state');
    await notificationsIntake(h).drain();
    // «Призёр сезона» остался заработан — его уведомление есть (приём событий отработал); «Чемпиона» — нет
    const titles = (await notificationsOf(h, me.userId)).map((doc) => doc.title);
    expect(titles.some((title) => title.includes('Призёр сезона'))).toBe(true);
    expect(titles.filter((title) => title.includes('Чемпион сезона'))).toEqual([]);
  });
});
