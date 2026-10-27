import { MyRaceEntry } from '@pokatim/contracts';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { createHarness, type Harness } from '../../../test/harness';
import { call, gate, untilBlocked, writeWaiting } from '../../../test/identity';
import {
  corridorRace,
  enterRace,
  resultsDb,
  rider,
  seedVerifiedProfile,
} from '../../../test/results';
import { PROFILE_COLLECTIONS } from './profile.collection';
import type { RiderVerifiedProfileDoc } from './verified-profile.collection';
import { VerifiedProfileRepository } from './verified-profile.repository';

/**
 * Гонка «первая Verified-заявка ↔ правка пола анкеты райдером» (race-results-07, AC10, отрицательные доказательства).
 * Заявка в своей транзакции пишет документ анкеты (`lockForEntry`), `PUT` — одна операция с условием «не
 * зафиксировано или те же пол и год» в фильтре. Побеждает одна; пары «группа заявки ↔ пол анкеты» вразнобой нет.
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

const URL = '/v1/profile/verified';
const woman = {
  gender: 'w',
  birthYear: 1980,
  weightKg: 60,
  heightCm: 170,
  ftpW: null,
  consent: true,
};
const profiles = () => h.db.collection<RiderVerifiedProfileDoc>(PROFILE_COLLECTIONS.verified);
const repository = () => h.app.get(VerifiedProfileRepository, { strict: false });
const code = (res: { body: unknown }) => (res.body as { code?: string }).code;

async function setup() {
  const { raceId } = await corridorRace(h, {}, { scheme: null });
  const r = await rider(h);
  await seedVerifiedProfile(h, r.userId, { gender: 'm', birthYear: 1980 });
  return { raceId, ...r };
}

/**
 * Заявка Verified останавливается в транзакции после `lockForEntry` (до коммита), `PUT` с новым полом идёт в это
 * время; затем заявка коммитится.
 */
async function race(raceId: string, auth: Record<string, string>) {
  const g = gate();
  const original = repository().lockForEntry.bind(repository());
  const spy = vi.spyOn(repository(), 'lockForEntry').mockImplementation(async (...args) => {
    const result = await original(...args);
    if (spy.mock.calls.length === 1) await g.wait();
    return result;
  });
  const entering = enterRace(h, auth, raceId, { tier: 'verified' });
  await g.reached;
  const put = call(h, 'PUT', URL, woman, auth);
  await untilBlocked(put, writeWaiting(h, PROFILE_COLLECTIONS.verified));
  g.open();
  return { entry: await entering, put: await put, spy };
}

describe('первая Verified-заявка ↔ PUT нового пола (AC10)', () => {
  it('с записью анкеты в транзакции заявки: PUT ждёт коммита и получает 409; группа заявки = полу анкеты', async () => {
    const { raceId, auth, userId } = await setup();
    const { entry, put } = await race(raceId, auth);
    expect(entry.status).toBe(201);
    expect(MyRaceEntry.parse(entry.body).entry?.groupKey).toBe('m_40_49');
    expect([put.status, code(put)]).toEqual([409, 'VERIFIED_DEMOGRAPHICS_LOCKED']);
    const profile = await profiles().findOne({ _id: userId });
    expect(profile).toMatchObject({ gender: 'm' });
    expect(profile?.demographicsLockedAt).not.toBeNull();
  });

  it('отрицательное доказательство (а): lockForEntry подменён чтением — обе операции коммитятся, группа заявки ≠ полу анкеты', async () => {
    const { raceId, auth, userId } = await setup();
    const g = gate();
    vi.spyOn(repository(), 'lockForEntry').mockImplementation(async (tx, id) => {
      const doc = await repository().find(id, tx);
      await g.wait();
      return doc ? { gender: doc.gender, birthYear: doc.birthYear } : null;
    });
    const entering = enterRace(h, auth, raceId, { tier: 'verified' });
    await g.reached;
    const put = await call(h, 'PUT', URL, woman, auth);
    g.open();
    const entry = await entering;
    expect(put.status).toBe(200);
    expect(entry.status).toBe(201);
    const groupKey = (await resultsDb(h).entries.findOne({ userId }))?.groupKey;
    expect(groupKey).toBe('m_40_49');
    expect((await profiles().findOne({ _id: userId }))?.gender).toBe('w');
  });

  it('отрицательное доказательство (б): без условия фиксации в фильтре PUT — после заявки пол меняется (200 вместо 409)', async () => {
    const { raceId, auth, userId } = await setup();
    expect((await enterRace(h, auth, raceId, { tier: 'verified' })).status).toBe(201);
    const refused = await call(h, 'PUT', URL, woman, auth);
    expect([refused.status, code(refused)]).toEqual([409, 'VERIFIED_DEMOGRAPHICS_LOCKED']);
    vi.spyOn(repository(), 'updateOwn').mockImplementation(async (id, values, consent, now) => {
      const result = await profiles().updateOne(
        { _id: id },
        {
          $set: {
            ...values,
            consentAt: consent.at,
            consentVersion: consent.version,
            updatedAt: now,
          },
          $inc: { version: 1 },
        },
      );
      return result.matchedCount === 1;
    });
    const changed = await call(h, 'PUT', URL, woman, auth);
    expect(changed.status).toBe(200);
    expect((await profiles().findOne({ _id: userId }))?.gender).toBe('w');
    expect((await resultsDb(h).entries.findOne({ userId }))?.groupKey).toBe('m_40_49');
  });
});
