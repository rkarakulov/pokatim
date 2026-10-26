import { RaceResultsPage } from '@pokatim/contracts';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { createHarness, type Harness } from '../../../test/harness';
import { call } from '../../../test/identity';
import { protocolAction, protocolRace, resultsDb, signIn } from '../../../test/results';

/**
 * Имя райдера в публичной таблице (profile-rider-name: AC5–AC7). Имя — из профиля при каждом чтении (P3), только
 * с согласием (P1); в снимок протокола не пишется.
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

const table = async (raceId: string) => {
  const res = await call(h, 'GET', `/v1/races/${raceId}/results`);
  expect(res.status).toBe(200);
  return { raw: res.body as { items: object[] }, body: RaceResultsPage.parse(res.body) };
};
const updateProfile = async (email: string, body: Record<string, unknown>) => {
  const res = await call(h, 'PATCH', '/v1/profile', body, await signIn(h, email));
  expect(res.status).toBe(200);
};

/** Гонка из 4 райдеров (места по порядку): имя+согласие, имя без согласия, согласие без имени, без профиля. */
async function namedRace() {
  const race = await protocolRace(h, [3600, 3700, 3800, 3900]);
  const [named, hidden, consentOnly] = race.riders;
  await updateProfile(named!.email, { publicName: 'Анна К.', showNameInResults: true });
  await updateProfile(hidden!.email, { publicName: 'Скрытый', showNameInResults: false });
  await updateProfile(consentOnly!.email, { showNameInResults: true });
  return race;
}

const namesOf = (body: RaceResultsPage) => body.items.map((row) => [row.entryId, row.riderName]);

describe('имя в публичной таблице (AC5–AC7)', () => {
  it('предварительная: имя только с именем и согласием; строка — 5 ключей, без userId (AC5)', async () => {
    const { raceId, riders } = await namedRace();
    const { raw, body } = await table(raceId);
    expect(body.status).toBe('provisional');
    expect(namesOf(body)).toEqual([
      [riders[0]!.entryId, 'Анна К.'],
      [riders[1]!.entryId, null],
      [riders[2]!.entryId, null],
      [riders[3]!.entryId, null],
    ]);
    for (const row of raw.items) {
      expect(Object.keys(row).sort()).toEqual([
        'elapsedSec',
        'entryId',
        'place',
        'riderName',
        'tied',
      ]);
    }
  });

  it('протокол: имя из профиля при чтении, смена после публикации видна; снимок без имени (AC6)', async () => {
    const { raceId, riders, token } = await namedRace();
    expect((await protocolAction(h, token, raceId, '/protocol')).status).toBe(200);

    const published = (await table(raceId)).body;
    expect(published.status).toBe('final');
    expect(namesOf(published)).toEqual([
      [riders[0]!.entryId, 'Анна К.'],
      [riders[1]!.entryId, null],
      [riders[2]!.entryId, null],
      [riders[3]!.entryId, null],
    ]);

    await updateProfile(riders[0]!.email, { publicName: 'Анна Ковалёва' });
    await updateProfile(riders[1]!.email, { showNameInResults: true });
    expect(namesOf((await table(raceId)).body)).toEqual([
      [riders[0]!.entryId, 'Анна Ковалёва'],
      [riders[1]!.entryId, 'Скрытый'],
      [riders[2]!.entryId, null],
      [riders[3]!.entryId, null],
    ]);

    const rows = await resultsDb(h).protocolRows.find({ raceId }).toArray();
    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) {
      expect(Object.keys(row)).not.toContain('riderName');
      expect(Object.keys(row)).not.toContain('publicName');
    }
  });

  it('отзыв согласия → null в предварительной и в протокольной таблицах (AC7)', async () => {
    const { raceId, riders, token } = await namedRace();
    await updateProfile(riders[0]!.email, { showNameInResults: false });
    expect((await table(raceId)).body.items[0]!.riderName).toBeNull();

    await updateProfile(riders[0]!.email, { showNameInResults: true });
    expect((await protocolAction(h, token, raceId, '/protocol')).status).toBe(200);
    expect((await table(raceId)).body.items[0]!.riderName).toBe('Анна К.');
    await updateProfile(riders[0]!.email, { showNameInResults: false });
    const final = (await table(raceId)).body;
    expect(final.status).toBe('final');
    expect(final.items.map((row) => row.riderName)).toEqual([null, null, null, null]);
  });
});
