import { uuidv7 } from '@rkarakulov/api-kit/mongo';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { createHarness, type Harness } from '../../../test/harness';
import { panel, panelCall } from '../../../test/panel';
import { staff } from '../../../test/races';
import {
  corridorRace,
  enterRace,
  resultsDb,
  rider,
  seedVerifiedProfile,
} from '../../../test/results';
import { PROFILE_COLLECTIONS } from './profile.collection';
import type { RiderVerifiedProfileDoc } from './verified-profile.collection';

/**
 * Пол и год анкеты Verified в панели (race-results-07, AC10): `profiles.verified_edit` — только admin; правка и журнал
 * `profile.verified_demographics_changed` (имена полей, без значений) в одной транзакции; те же значения — без
 * журнала; существующие заявки не меняются; вес, рост и FTP в панель не уходят.
 */
let h: Harness;
let admin: { userId: string; token: string };
beforeAll(async () => {
  h = await createHarness({ TRUST_PROXY: '1' });
});
beforeEach(async () => {
  await h.reset();
  admin = await staff(h, 'boss@example.by', 'admin');
});
afterAll(async () => {
  await h.close();
});

const url = (userId: string) => `/v1/admin/profiles/${userId}/verified-demographics`;
const REASON = 'Ошибка ввода года';
const audit = () =>
  panel(h).audit.find({ action: 'profile.verified_demographics_changed' }).toArray();
const profiles = () => h.db.collection<RiderVerifiedProfileDoc>(PROFILE_COLLECTIONS.verified);

describe('/v1/admin/profiles/:userId/verified-demographics', () => {
  it('admin: GET — пол, год, фиксация (без веса, роста, FTP); PATCH — меняет, журнал без значений, заявка прежняя', async () => {
    const { raceId } = await corridorRace(h, {}, { scheme: null });
    const r = await rider(h);
    await seedVerifiedProfile(h, r.userId, { gender: 'm', birthYear: 1977, weightKg: 87 });
    expect((await enterRace(h, r.auth, raceId, { tier: 'verified' })).status).toBe(201);

    const view = await panelCall(h, admin.token, 'GET', url(r.userId));
    expect(view.status).toBe(200);
    expect(view.headers['cache-control']).toBe('no-store');
    expect(view.body).toEqual({ gender: 'm', birthYear: 1977, demographicsLocked: true });

    const res = await panelCall(h, admin.token, 'PATCH', url(r.userId), {
      birthYear: 1981,
      gender: 'm',
      reason: REASON,
    });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      gender: 'm',
      birthYear: 1981,
      demographicsLocked: true,
      changed: true,
    });
    expect(await profiles().findOne({ _id: r.userId })).toMatchObject({
      birthYear: 1981,
      weightKg: 87,
    });
    const records = await audit();
    expect(records).toHaveLength(1);
    expect(records[0]).toMatchObject({
      actor: { kind: 'user', userId: admin.userId },
      subject: { kind: 'rider', id: r.userId, label: `Участник ·${r.userId.slice(-6)}` },
      targetUserId: null,
      reason: REASON,
      details: { changedFields: ['birthYear'] },
    });
    expect(JSON.stringify(records[0]?.details)).not.toMatch(/1977|1981/);
    // существующая заявка не меняется
    expect((await resultsDb(h).entries.findOne({ userId: r.userId }))?.groupKey).toBe('m_40_49');
  });

  it('те же значения — changed: false без записи журнала', async () => {
    const r = await rider(h);
    await seedVerifiedProfile(h, r.userId, { gender: 'w', birthYear: 1990 });
    const res = await panelCall(h, admin.token, 'PATCH', url(r.userId), {
      gender: 'w',
      reason: REASON,
    });
    expect(res.body).toEqual({
      gender: 'w',
      birthYear: 1990,
      demographicsLocked: false,
      changed: false,
    });
    expect(await audit()).toEqual([]);
  });

  it('moderator и organizer — 403; анкеты нет — 404; без полей — 400', async () => {
    const r = await rider(h);
    await seedVerifiedProfile(h, r.userId);
    for (const [email, role] of [
      ['moderator@example.by', 'moderator'],
      ['organizer@example.by', 'organizer'],
    ] as const) {
      const actor = await staff(h, email, role);
      expect((await panelCall(h, actor.token, 'GET', url(r.userId))).status).toBe(403);
      expect(
        (await panelCall(h, actor.token, 'PATCH', url(r.userId), { gender: 'w', reason: REASON }))
          .status,
      ).toBe(403);
    }
    const unknown = uuidv7();
    expect((await panelCall(h, admin.token, 'GET', url(unknown))).status).toBe(404);
    expect(
      (await panelCall(h, admin.token, 'PATCH', url(unknown), { gender: 'w', reason: REASON }))
        .status,
    ).toBe(404);
    expect(
      (await panelCall(h, admin.token, 'PATCH', url(r.userId), { reason: REASON })).status,
    ).toBe(400);
    expect(await audit()).toEqual([]);
  });
});
