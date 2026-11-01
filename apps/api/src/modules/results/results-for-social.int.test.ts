import { RaceResultsPage } from '@pokatim/contracts';
import { uuidv7 } from '@rkarakulov/api-kit/mongo';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { createHarness, type Harness } from '../../../test/harness';
import { call } from '../../../test/identity';
import { racesDb } from '../../../test/races';
import { protocolAction, protocolRace, resultsDb, seedBest } from '../../../test/results';
import { RESULTS_FOR_SOCIAL, type ResultsForSocial } from './index';

/**
 * Порт «Респекта» строке результата (P4, RC-P4-1): цель — только строка, видимая в публичной таблице гонки, до и
 * после публикации протокола; `entryId` — тот же, что у строки `GET races/:raceId/results`.
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

const port = () => h.app.get<ResultsForSocial>(RESULTS_FOR_SOCIAL);
const publicIds = async (raceId: string) =>
  RaceResultsPage.parse((await call(h, 'GET', `/v1/races/${raceId}/results`)).body).items.map(
    (row) => row.entryId,
  );

describe('до публикации протокола', () => {
  it('строка с местом — цель с владельцем; совпадает со строкой публичной таблицы', async () => {
    const race = await protocolRace(h, [3600, 3700]);
    const [a, b] = race.riders;
    expect(await port().respectTarget(a!.entryId)).toEqual({
      entryId: a!.entryId,
      raceId: race.raceId,
      ownerUserId: a!.userId,
    });
    expect(await port().respectTarget(b!.entryId)).toMatchObject({ ownerUserId: b!.userId });
    expect(await publicIds(race.raceId)).toEqual([a!.entryId, b!.entryId]);
  });

  it('без лучшего, финишёр без места, снятая, DQ по спору, неизвестная — null', async () => {
    const race = await protocolRace(h, [3600, null, 3700, 3800, 3900]);
    const [, none, finisher, withdrawn, dq] = race.riders.map((r) => r.entryId);
    await seedBest(h, finisher!, 3700, new Date('2026-10-25T02:00:00Z'), { ranked: false });
    await resultsDb(h).entries.updateOne({ _id: withdrawn }, { $set: { status: 'withdrawn' } });
    await resultsDb(h).entries.updateOne(
      { _id: dq },
      { $set: { disqualified: { at: h.clock.now(), disputeId: uuidv7() } } },
    );
    for (const id of [none, finisher, withdrawn, dq, uuidv7()]) {
      expect(await port().respectTarget(id!)).toBeNull();
    }
    expect(await publicIds(race.raceId)).toEqual([race.riders[0]!.entryId]);
  });

  it('черновик, отменённая гонка, гонка без коридора — null', async () => {
    const race = await protocolRace(h, [3600]);
    const entryId = race.riders[0]!.entryId;
    const patches = [
      { status: 'draft' as const },
      { status: 'cancelled' as const },
      { corridor: null },
    ];
    for (const patch of patches) {
      const before = await racesDb(h).races.findOne({ _id: race.raceId });
      await racesDb(h).races.updateOne({ _id: race.raceId }, { $set: patch });
      expect(await port().respectTarget(entryId)).toBeNull();
      await racesDb(h).races.replaceOne({ _id: race.raceId }, before!);
    }
    expect(await port().respectTarget(entryId)).not.toBeNull();
  });
});

describe('после публикации протокола', () => {
  it('строка ревизии — цель; DQ в новой ревизии — null; отмена DQ — снова цель', async () => {
    const race = await protocolRace(h, [3600, 3700]);
    const [a, b] = race.riders;
    expect((await protocolAction(h, race.token, race.raceId, '/protocol')).status).toBe(200);
    expect(await port().respectTarget(a!.entryId)).toEqual({
      entryId: a!.entryId,
      raceId: race.raceId,
      ownerUserId: a!.userId,
    });
    expect(await publicIds(race.raceId)).toEqual([a!.entryId, b!.entryId]);

    const dq = await protocolAction(h, race.token, race.raceId, '/protocol/disqualify', {
      entryId: a!.entryId,
      reason: 'Срезка маршрута',
    });
    expect(dq.status).toBe(200);
    expect(await port().respectTarget(a!.entryId)).toBeNull();
    expect(await port().respectTarget(b!.entryId)).toMatchObject({ ownerUserId: b!.userId });
    expect(await publicIds(race.raceId)).toEqual([b!.entryId]);

    const revoked = await protocolAction(
      h,
      race.token,
      race.raceId,
      '/protocol/revoke-disqualification',
      { entryId: a!.entryId, reason: 'Апелляция' },
    );
    expect(revoked.status).toBe(200);
    expect(await port().respectTarget(a!.entryId)).toMatchObject({ ownerUserId: a!.userId });
  });

  it('заявка без строки протокола (без результата) — null', async () => {
    const race = await protocolRace(h, [3600, null]);
    expect((await protocolAction(h, race.token, race.raceId, '/protocol')).status).toBe(200);
    expect(await port().respectTarget(race.riders[1]!.entryId)).toBeNull();
  });
});
