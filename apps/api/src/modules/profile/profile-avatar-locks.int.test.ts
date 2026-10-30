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
import { eventsOfType, notificationsIntake, notificationsOf } from '../../../test/notifications';
import { MINUTE } from '../../../test/harness';
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

describe('порядок уведомлений о сбросе фото — ревизия сбросов, не время начала запроса (ревью pass 2)', () => {
  it('A взял время и стоит до записи → сброс B → новое фото → A (3-й сброс, запрет) — в центре уведомление A', async () => {
    // beforeEach: два сброса фото в истории и новое фото; B — третий сброс без задержки был бы запретом, поэтому
    // начинаем с одного сброса: снимаем второй из истории
    await profilesDb(h).updateOne({ _id: target.userId }, { $pop: { avatarResetsAt: 1 } });
    await notificationsIntake(h).drain();
    h.clock.advance(MINUTE);

    const repository = h.app.get(ProfileRepository, { strict: false });
    const original = repository.resetAvatar.bind(repository);
    const g = gate();
    let gated = false;
    const spy = vi.spyOn(repository, 'resetAvatar').mockImplementation(async (...args) => {
      if (!gated) {
        gated = true;
        await g.wait();
      }
      return original(...args);
    });
    try {
      const pendingA = profileModerationCall(
        h,
        moderator.token,
        'POST',
        `/${target.userId}/avatar-reset`,
        { reason: 'Недопустимое фото' },
      );
      await g.reached;
      // B — позже по часам, коммитится первым (второй сброс в окне, без запрета)
      h.clock.advance(MINUTE);
      expect((await resetAvatar()).body).toEqual({ reset: true });
      // райдер загрузил новое фото — A сбрасывает уже его: третий сброс в окне, запрет
      await seedAvatar(h, target.userId);
      g.open();
      const resA = await pendingA;
      expect(resA.status).toBe(200);
      expect(resA.body).toEqual({ reset: true });
    } finally {
      spy.mockRestore();
    }

    const [b, a] = (await eventsOfType(h, 'profile.field-reset'))
      .slice(-2)
      .map(
        (event) =>
          event.payload as { seq: number; resetAt: string; avatarBlockedUntil: string | null },
      );
    // время A раньше, чем у B, но ревизия сбросов — позже
    expect(Date.parse(a!.resetAt)).toBeLessThan(Date.parse(b!.resetAt));
    expect(a!.avatarBlockedUntil).not.toBeNull();
    expect(a!.seq).toBeGreaterThan(b!.seq);

    await notificationsIntake(h).drain();
    const docs = await notificationsOf(h, target.userId);
    expect(docs).toHaveLength(1);
    expect(docs[0]?.body).toMatch(
      /^Модератор удалил фото после жалоб\. Загрузка фото недоступна до /,
    );
  });
});
