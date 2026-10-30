import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { twoToneImage } from '../../../test/avatars';
import { createHarness, type Harness } from '../../../test/harness';
import { bearer, gate } from '../../../test/identity';
import {
  avatarsDb,
  profileModerationCall,
  profilesDb,
  type PublicRider,
  publicRider,
  seedAvatar,
} from '../../../test/profiles';
import { staff } from '../../../test/races';
import { heldUpload } from '../../../test/uploads';
import { ProfileRepository } from './profile.repository';

/**
 * Гонка «загрузка фото ↔ сброс с запретом» (profile-moderation-followups, AC7, RC-F14): загрузка, начавшаяся до
 * третьего сброса фото, не обходит запрет — транзакция замены проверяет `avatarBlockedUntil` по документу профиля,
 * прочитанному в ней же; снимок до коммита сброса — write conflict по документу профиля → повтор → 409.
 * Отрицательное доказательство (task.md §12): без проверки `before` в `write()` оба теста дают 200 и фото записано.
 */
let h: Harness;
let moderator: { userId: string; token: string };
let target: PublicRider;
beforeAll(async () => {
  h = await createHarness({ TRUST_PROXY: '1' });
});
beforeEach(async () => {
  await h.reset();
  moderator = await staff(h, 'moderator@example.by', 'moderator');
  target = await publicRider(h, 'target@example.by');
  // два сброса фото — третий включит запрет
  for (let i = 0; i < 2; i += 1) {
    await seedAvatar(h, target.userId);
    await resetAvatar();
  }
  await seedAvatar(h, target.userId);
});
afterAll(async () => {
  await h.close();
});

const AVATAR = '/v1/profile/avatar';
const resetAvatar = async () => {
  const res = await profileModerationCall(
    h,
    moderator.token,
    'POST',
    `/${target.userId}/avatar-reset`,
    { reason: 'Недопустимое фото' },
  );
  if (res.status !== 200) throw new Error(`avatar-reset: ${res.status}`);
  return res;
};

async function expectBlockedAndNothingStored(result: { status: number; body: unknown }) {
  expect(result.status).toBe(409);
  expect(result.body).toMatchObject({
    code: 'PROFILE_INVALID_STATE',
    details: { reason: 'avatar_blocked' },
  });
  expect(await avatarsDb(h).countDocuments({ userId: target.userId })).toBe(0);
  expect((await profilesDb(h).findOne({ _id: target.userId }))?.avatarId ?? null).toBeNull();
}

describe('гонка загрузки фото и сброса с запретом (AC7)', () => {
  it('тело удержано после приёма → третий сброс (запрет) → дописанное тело — 409, фото не записано', async () => {
    const upload = heldUpload(h, AVATAR, bearer(target.token), 'PUT');
    await upload.held();
    expect((await resetAvatar()).body).toEqual({ reset: true });
    await expectBlockedAndNothingStored(await upload.finish(await twoToneImage('png')));
  });

  it('транзакция замены прочитала профиль без запрета и стоит → сброс коммитится → конфликт, повтор — 409', async () => {
    const repository = h.app.get(ProfileRepository, { strict: false });
    const original = repository.findProfile.bind(repository);
    const g = gate();
    let gated = false;
    const spy = vi.spyOn(repository, 'findProfile').mockImplementation(async (userId, session) => {
      const doc = await original(userId, session);
      if (session && !gated) {
        gated = true;
        await g.wait();
      }
      return doc;
    });
    try {
      const pending = h.app.inject({
        method: 'PUT',
        url: AVATAR,
        headers: { 'content-type': 'application/octet-stream', ...bearer(target.token) },
        payload: await twoToneImage('png'),
      });
      await g.reached;
      expect((await resetAvatar()).body).toEqual({ reset: true });
      g.open();
      const response = await pending;
      expect(spy.mock.calls.filter(([, session]) => session).length).toBeGreaterThan(1);
      await expectBlockedAndNothingStored({
        status: response.statusCode,
        body: JSON.parse(response.body) as unknown,
      });
    } finally {
      spy.mockRestore();
    }
  });
});
