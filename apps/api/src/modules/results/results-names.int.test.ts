import {
  PanelProtocolRecalculations,
  PanelRaceAttempt,
  PanelRaceAttemptPage,
  PanelRaceStandings,
  RaceResultsPage,
} from '@pokatim/contracts';
import { uuidv7 } from '@rkarakulov/api-kit/mongo';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { createHarness, type Harness } from '../../../test/harness';
import { call } from '../../../test/identity';
import { panelCall } from '../../../test/panel';
import { profilesCollection } from '../../../test/standings';
import {
  protocolAction,
  protocolRace,
  raceAdminUrl,
  resultsDb,
  signIn,
} from '../../../test/results';

/**
 * Имя райдера в публичной таблице (profile-rider-name: AC5–AC7) и в панели (profile-02: AC4, AC6). Имя — из профиля
 * при каждом чтении (P3), только с согласием (P1); в снимок протокола не пишется.
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
  it('предварительная: имя только с именем и согласием; строка — явные ключи, без userId (AC5)', async () => {
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
        'riderAvatar',
        'riderName',
        'riderNo',
        'riderPublicId',
        'tied',
      ]);
    }
  });

  it('номер заявки «Райдер #N»: порядок записи в гонке, только без имени; протокол и отзыв согласия (N7)', async () => {
    const { raceId, riders, token } = await namedRace();
    const numbersOf = (body: RaceResultsPage) => body.items.map((row) => row.riderNo);
    const stored = await resultsDb(h)
      .entries.find({ raceId }, { projection: { _id: 1, entryNo: 1 } })
      .toArray();
    const entryNo = new Map(stored.map((doc) => [doc._id, doc.entryNo]));
    // заявки подавались по порядку райдеров — номера 1…4, уникальны в гонке
    expect(riders.map((rider) => entryNo.get(rider.entryId))).toEqual([1, 2, 3, 4]);
    expect(numbersOf((await table(raceId)).body)).toEqual([null, 2, 3, 4]);

    expect((await protocolAction(h, token, raceId, '/protocol')).status).toBe(200);
    expect(numbersOf((await table(raceId)).body)).toEqual([null, 2, 3, 4]);
    await updateProfile(riders[0]!.email, { showNameInResults: false });
    expect(numbersOf((await table(raceId)).body)).toEqual([1, 2, 3, 4]);
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

const profiles = () => profilesCollection(h);
const linksOf = (body: RaceResultsPage) =>
  body.items.map((row) => [row.riderName, row.riderPublicId, row.riderAvatar]);

describe('ссылка на профиль и фото в публичной таблице (rider-links-in-tables)', () => {
  it('только с именем и согласием: предварительная, протокол, отзыв согласия', async () => {
    const { raceId, riders, token } = await namedRace();
    const named = await profiles().findOne({ _id: riders[0]!.userId });
    const publicId = named!.publicId!;
    expect(publicId).toMatch(/^[A-Za-z0-9_-]{43}$/);
    const avatarId = 'a'.repeat(43);
    await profiles().updateOne({ _id: riders[0]!.userId }, { $set: { avatarId } });
    // фото у скрытого — наружу не выходит
    await profiles().updateOne({ _id: riders[1]!.userId }, { $set: { avatarId: 'b'.repeat(43) } });

    const expected = [
      ['Анна К.', publicId, { id: avatarId }],
      [null, null, null],
      [null, null, null],
      [null, null, null],
    ];
    expect(linksOf((await table(raceId)).body)).toEqual(expected);
    expect((await protocolAction(h, token, raceId, '/protocol')).status).toBe(200);
    const published = (await table(raceId)).body;
    expect(published.status).toBe('final');
    expect(linksOf(published)).toEqual(expected);
    expect(JSON.stringify(published)).not.toContain('userId');

    await updateProfile(riders[0]!.email, { showNameInResults: false });
    expect(linksOf((await table(raceId)).body)).toEqual([
      [null, null, null],
      [null, null, null],
      [null, null, null],
      [null, null, null],
    ]);
  });
});

const panelGet = async (token: string, url: string) => {
  const res = await panelCall(h, token, 'GET', url);
  expect(res.status).toBe(200);
  return res.body;
};
const standings = async (token: string, raceId: string) =>
  PanelRaceStandings.parse(await panelGet(token, raceAdminUrl(raceId, '/standings')));
const standingNames = (body: PanelRaceStandings) =>
  body.items.map((row) => [row.entryId, row.userId, row.riderName]);

/** Попытка, которую можно исключить (`failed`), — напрямую в БД (подготовка; проверки — в results-protocol). */
async function seedAttempt(raceId: string, entryId: string, userId: string) {
  const now = h.clock.now();
  const _id = uuidv7();
  await resultsDb(h).attempts.insertOne({
    _id,
    raceId,
    entryId,
    userId,
    activityId: uuidv7(),
    uploadId: uuidv7(),
    activity: { startedAt: now, source: 'upload', elapsedSec: 1, distanceM: 1 },
    origin: 'auto',
    status: 'failed',
    matched: null,
    reasons: [],
    failure: 'timeout',
    withdrawReason: null,
    segment: null,
    touchedCorridor: null,
    candidates: null,
    diagnostics: null,
    engineVersion: null,
    corridor: { routeId: uuidv7(), widthM: 50 },
    checkRevision: 1,
    checkAttempts: 1,
    requeues: 0,
    checkJobId: null,
    createdAt: now,
    updatedAt: now,
    checkedAt: now,
  });
  return _id;
}

describe('имя в панели «Протокол» (profile-02, AC4)', () => {
  it('«Участники» live и после публикации: riderName только при имени и согласии, userId на месте', async () => {
    const { raceId, riders, token } = await namedRace();
    const expected = [
      [riders[0]!.entryId, riders[0]!.userId, 'Анна К.'],
      [riders[1]!.entryId, riders[1]!.userId, null],
      [riders[2]!.entryId, riders[2]!.userId, null],
      [riders[3]!.entryId, riders[3]!.userId, null],
    ];
    const live = await standings(token, raceId);
    expect(live.source).toBe('live');
    expect(standingNames(live)).toEqual(expected);

    expect((await protocolAction(h, token, raceId, '/protocol')).status).toBe(200);
    const published = await standings(token, raceId);
    expect(published.source).toBe('protocol');
    expect(standingNames(published)).toEqual(expected);
  });

  it('попытки и ответ «Исключить»: riderName только при имени и согласии', async () => {
    const { raceId, riders, token } = await namedRace();
    const namedAttempt = await seedAttempt(raceId, riders[0]!.entryId, riders[0]!.userId);
    const hiddenAttempt = await seedAttempt(raceId, riders[1]!.entryId, riders[1]!.userId);

    const page = PanelRaceAttemptPage.parse(
      await panelGet(token, raceAdminUrl(raceId, '/attempts')),
    );
    expect(
      Object.fromEntries(page.items.map((attempt) => [attempt.id, attempt.riderName])),
    ).toEqual({ [namedAttempt]: 'Анна К.', [hiddenAttempt]: null });

    const excluded = await protocolAction(h, token, raceId, `/attempts/${namedAttempt}/exclude`);
    expect(excluded.status).toBe(200);
    expect(PanelRaceAttempt.parse(excluded.body)).toMatchObject({
      id: namedAttempt,
      status: 'excluded',
      userId: riders[0]!.userId,
      riderName: 'Анна К.',
    });

    const restored = await protocolAction(h, token, raceId, `/attempts/${namedAttempt}/restore`);
    expect(restored.status).toBe(200);
    expect(PanelRaceAttempt.parse(restored.body)).toMatchObject({
      id: namedAttempt,
      riderName: 'Анна К.',
    });
  });

  it('история пересчётов: riderName заявки только при имени и согласии; публикация — null; ключи записи', async () => {
    const { raceId, riders, token } = await namedRace();
    expect((await protocolAction(h, token, raceId, '/protocol')).status).toBe(200);
    h.clock.advance(1000);
    for (const r of [riders[0]!, riders[1]!, riders[3]!]) {
      const body = { entryId: r.entryId, reason: 'Срезка' };
      expect((await protocolAction(h, token, raceId, '/protocol/disqualify', body)).status).toBe(
        200,
      );
      h.clock.advance(1000);
    }
    const res = await panelCall(h, token, 'GET', raceAdminUrl(raceId, '/protocol/recalculations'));
    expect(res.status).toBe(200);
    const history = PanelProtocolRecalculations.parse(res.body);
    expect(history.items.map((item) => [item.kind, item.entryId, item.riderName])).toEqual([
      ['disqualified', riders[3]!.entryId, null],
      ['disqualified', riders[1]!.entryId, null],
      ['disqualified', riders[0]!.entryId, 'Анна К.'],
      ['published', null, null],
    ]);
    expect(Object.keys((res.body as { items: object[] }).items[0]!).sort()).toEqual(
      ['actor', 'at', 'entryId', 'id', 'kind', 'reason', 'revision', 'riderName'].sort(),
    );
    // имя не пишется в журнал пересчётов
    const docs = await resultsDb(h).recalculations.find({ raceId }).toArray();
    expect(docs.every((doc) => !('riderName' in doc))).toBe(true);
  });
});

describe('сброс имени модератором (profile-02, AC6)', () => {
  it('после name-reset — null и в публичной таблице, и в панели', async () => {
    const { raceId, riders, token } = await namedRace();
    const reset = await panelCall(
      h,
      token,
      'POST',
      `/v1/admin/profiles/${riders[0]!.userId}/name-reset`,
      { reason: 'name' },
    );
    expect(reset.status).toBe(200);
    expect((await table(raceId)).body.items.map((row) => row.riderName)).toEqual([
      null,
      null,
      null,
      null,
    ]);
    expect((await standings(token, raceId)).items.map((row) => row.riderName)).toEqual([
      null,
      null,
      null,
      null,
    ]);
  });
});
