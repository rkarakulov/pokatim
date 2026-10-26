import { uuidv7 } from '@rkarakulov/api-kit/mongo';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { createHarness, type Harness } from '../../../test/harness';
import { bearer, call } from '../../../test/identity';
import { panel, panelCall } from '../../../test/panel';
import { staff } from '../../../test/races';
import { rider, type Rider } from '../../../test/rides';
import { PanelAudit } from '../panel';
import {
  PROFILE_COLLECTIONS,
  type ProfileConsentEventDoc,
  type ProfileDoc,
} from './profile.collection';
import { RIDER_NAMES, type RiderNameDirectory } from './rider-names.port';

/**
 * Сброс публичного имени модератором (profile-02, AC6): `profiles.moderate` — admin и moderator; условная запись
 * профиля и журнал панели в одной транзакции; имени нет ни в журнале, ни в ответе; согласие не меняется.
 */
let h: Harness;
let moderator: { userId: string; token: string };
let named: Rider;
beforeAll(async () => {
  h = await createHarness({ TRUST_PROXY: '1' });
});
beforeEach(async () => {
  await h.reset();
  moderator = await staff(h, 'moderator@example.by', 'moderator');
  named = await rider(h, 'named@example.by');
  await setName(named, { publicName: 'Анна К.', showNameInResults: true });
});
afterAll(async () => {
  await h.close();
});

const NAME = 'Анна К.';
const REASON = 'Оскорбительное имя';
const resetUrl = (userId: string) => `/v1/admin/profiles/${userId}/name-reset`;
const resetBy = (token: string | undefined, userId: string, body: unknown = { reason: REASON }) =>
  panelCall(h, token, 'POST', resetUrl(userId), body);
async function setName(who: Rider, body: Record<string, unknown>) {
  const res = await call(h, 'PATCH', '/v1/profile', body, bearer(who.token));
  if (res.status !== 200) throw new Error(`PATCH /v1/profile: ${res.status}`);
}
const profiles = () => h.db.collection<ProfileDoc>(PROFILE_COLLECTIONS.profiles);
const consentEvents = () =>
  h.db.collection<ProfileConsentEventDoc>(PROFILE_COLLECTIONS.consentEvents);
const resetAudit = () => panel(h).audit.find({ action: 'profile.name_reset' }).toArray();
const directory = () => h.app.get<RiderNameDirectory>(RIDER_NAMES, { strict: false });

describe('POST /v1/admin/profiles/:userId/name-reset (AC6)', () => {
  it.each(['moderator', 'admin'] as const)(
    '%s: имя сброшено, согласие прежнее, журнал без имени, публичного имени нет',
    async (role) => {
      const actor = role === 'moderator' ? moderator : await staff(h, 'admin@example.by', 'admin');
      const consentsBefore = await consentEvents().countDocuments();

      const res = await resetBy(actor.token, named.userId);

      expect(res.status).toBe(200);
      expect(res.body).toEqual({ reset: true });
      expect(res.headers['cache-control']).toBe('no-store');
      expect(JSON.stringify(res.body)).not.toContain(NAME);
      expect(await profiles().findOne({ _id: named.userId })).toMatchObject({
        publicName: null,
        showNameInResults: true,
        updatedAt: h.clock.now(),
      });
      expect(await consentEvents().countDocuments()).toBe(consentsBefore);
      const audit = await resetAudit();
      expect(audit).toHaveLength(1);
      expect(audit[0]).toMatchObject({
        action: 'profile.name_reset',
        actor: { kind: 'user', userId: actor.userId },
        subject: { kind: 'rider', id: named.userId, label: `Участник ·${named.userId.slice(-6)}` },
        targetUserId: null,
        reason: REASON,
        details: null,
      });
      expect(JSON.stringify(audit)).not.toContain(NAME);
      expect(await directory().publicNames([named.userId])).toEqual(new Map());
    },
  );

  it('повтор — { reset: false } без новой записи журнала (D2)', async () => {
    expect((await resetBy(moderator.token, named.userId)).body).toEqual({ reset: true });
    const again = await resetBy(moderator.token, named.userId);
    expect(again.status).toBe(200);
    expect(again.body).toEqual({ reset: false });
    expect(await resetAudit()).toHaveLength(1);
  });

  it('имя есть, согласия нет — сброс выполняется и журналируется (D2)', async () => {
    const hidden = await rider(h, 'hidden@example.by');
    await setName(hidden, { publicName: 'Скрытый' });
    expect((await resetBy(moderator.token, hidden.userId)).body).toEqual({ reset: true });
    expect(await profiles().findOne({ _id: hidden.userId })).toMatchObject({ publicName: null });
    expect(await resetAudit()).toHaveLength(1);
  });

  it('профиля нет → 404 NOT_FOUND, журнала нет', async () => {
    const noProfile = await rider(h, 'none@example.by');
    for (const userId of [noProfile.userId, uuidv7()]) {
      const res = await resetBy(moderator.token, userId);
      expect(res.status).toBe(404);
      expect(res.body).toMatchObject({ code: 'NOT_FOUND' });
    }
    expect(await resetAudit()).toHaveLength(0);
  });

  it('без сессии панели (в т. ч. Bearer приложения) → 401, organizer → 403; имя на месте', async () => {
    expect((await resetBy(undefined, named.userId)).status).toBe(401);
    const app = await call(
      h,
      'POST',
      resetUrl(named.userId),
      { reason: REASON },
      bearer(named.token),
    );
    expect(app.status).toBe(401);
    const organizer = await staff(h, 'org@example.by', 'organizer');
    expect((await resetBy(organizer.token, named.userId)).status).toBe(403);
    expect(await profiles().findOne({ _id: named.userId })).toMatchObject({ publicName: NAME });
    expect(await resetAudit()).toHaveLength(0);
  });

  it.each([
    ['userId не Uuid', 'not-a-uuid', { reason: REASON }],
    ['без причины', null, {}],
    ['короткая причина', null, { reason: 'ab' }],
    ['лишний ключ', null, { reason: REASON, publicName: null }],
  ])('%s → 400 VALIDATION_FAILED, имя на месте', async (_name, userId, body) => {
    const res = await resetBy(moderator.token, userId ?? named.userId, body);
    expect(res.status).toBe(400);
    expect(res.body).toMatchObject({ code: 'VALIDATION_FAILED' });
    expect(await profiles().findOne({ _id: named.userId })).toMatchObject({ publicName: NAME });
  });

  it('сбой журнала — откат: имя на месте (одна транзакция)', async () => {
    const audit = h.app.get(PanelAudit, { strict: false });
    const spy = vi.spyOn(audit, 'append').mockRejectedValue(new Error('журнал недоступен'));
    try {
      expect((await resetBy(moderator.token, named.userId)).status).toBe(500);
    } finally {
      spy.mockRestore();
    }
    expect(await profiles().findOne({ _id: named.userId })).toMatchObject({ publicName: NAME });
    expect(await resetAudit()).toHaveLength(0);
  });

  it('после сброса райдер задаёт новое имя — оно снова видно (согласие не сброшено)', async () => {
    await resetBy(moderator.token, named.userId);
    await setName(named, { publicName: 'Анна' });
    expect(await directory().publicNames([named.userId])).toEqual(
      new Map([[named.userId, 'Анна']]),
    );
  });
});
