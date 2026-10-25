import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { IDENTITY_POLICY } from '../src/modules/identity/identity.policy';
import { IdentityRepository } from '../src/modules/identity/identity.repository';
import { PROFILE_COLLECTIONS } from '../src/modules/profile/profile.collection';
import { createHarness, DAY, type Harness } from './harness';
import { collections, register } from './identity';

let h: Harness;
beforeAll(async () => {
  h = await createHarness();
});
beforeEach(async () => {
  await h.reset();
});
afterAll(async () => {
  await h.close();
});

/**
 * Межмодульный инвариант (слайс 4, §7): очистка неподтверждённых (identity) не трогает `profiles` — у такого
 * аккаунта профиля нет, потому что сессии (а значит и доступа к `AuthGuard`-эндпоинтам) он не получал (AD-28).
 */
describe('очистка неподтверждённых и профиль', () => {
  it('у удаляемого очисткой аккаунта нет сессий и документа profiles', async () => {
    await register(h, { email: 'late@example.com' });
    const user = await collections(h).users.findOne({ email: 'late@example.com' });
    expect(await collections(h).sessions.countDocuments({ userId: user?._id })).toBe(0);
    expect(await h.db.collection(PROFILE_COLLECTIONS.profiles).countDocuments()).toBe(0);

    h.clock.advance(IDENTITY_POLICY.unverifiedRetentionMs + DAY);
    const removed = await h.app
      .get(IdentityRepository)
      .deleteUnverifiedBatch(
        new Date(h.clock.now().getTime() - IDENTITY_POLICY.unverifiedRetentionMs),
        10,
      );

    expect(removed).toBe(1);
    expect(await collections(h).users.countDocuments()).toBe(0);
    expect(await h.db.collection(PROFILE_COLLECTIONS.profiles).countDocuments()).toBe(0);
  });
});
