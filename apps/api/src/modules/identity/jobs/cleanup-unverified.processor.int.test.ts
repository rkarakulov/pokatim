import { uuidv7 } from '@rkarakulov/api-kit/mongo';
import type { Job } from 'bullmq';
import { Collection } from 'mongodb';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { createHarness, DAY, type Harness } from '../../../../test/harness';
import {
  collections,
  holdTransaction,
  register,
  requestPasswordReset,
  retried,
  untilBlocked,
  userIdByEmail,
} from '../../../../test/identity';
import { CleanupUnverifiedProcessor } from './cleanup-unverified.processor';

let h: Harness;
let processor: CleanupUnverifiedProcessor;
beforeAll(async () => {
  h = await createHarness();
  processor = h.worker.get(CleanupUnverifiedProcessor);
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

async function insertUser(
  email: string,
  ageMs: number,
  extra: { verified?: boolean; deleted?: boolean } = {},
) {
  const createdAt = new Date(h.clock.now().getTime() - ageMs);
  await collections(h).users.insertOne({
    _id: uuidv7(),
    email,
    passwordHash: 'x',
    birthDate: '1990-05-01',
    createdAt,
    emailVerifiedAt: extra.verified ? createdAt : null,
    deletedAt: extra.deleted ? createdAt : null,
    version: 0,
  });
}

const emails = async () => (await collections(h).users.find().toArray()).map((u) => u.email).sort();

describe('CleanupUnverifiedProcessor', () => {
  it('удаляет неподтверждённые старше 7 дней пачками; подтверждённые, свежие и удалённые остаются', async () => {
    for (let i = 0; i < 5; i += 1) await insertUser(`old${i}@example.com`, 7 * DAY + 1);
    await insertUser('verified@example.com', 30 * DAY, { verified: true });
    await insertUser('fresh@example.com', 7 * DAY);
    await insertUser('deleted@example.com', 30 * DAY, { deleted: true });

    expect(await processor.run(2)).toBe(5);

    expect(await emails()).toEqual([
      'deleted@example.com',
      'fresh@example.com',
      'verified@example.com',
    ]);
    expect(await processor.run(2)).toBe(0);
  });

  it('задача по расписанию удаляет и связанные документы всех коллекций аккаунта (явный каскад, R4)', async () => {
    await register(h);
    await requestPasswordReset(h, 'rider@example.com');
    const userId = await userIdByEmail(h);
    const db = collections(h);
    // сессии у неподтверждённого нет — документ ставит тест, чтобы проверить каскад по всем коллекциям
    await db.sessions.insertOne({
      _id: uuidv7(),
      userId,
      refreshTokenHash: 'h',
      previousRefreshTokenHash: null,
      rotatedAt: null,
      createdAt: h.clock.now(),
      expiresAt: h.clock.now(),
      revokedAt: null,
      revokedReason: null,
    });
    // чужой аккаунт (подтверждённый) не затрагивается
    await insertUser('keep@example.com', 30 * DAY, { verified: true });
    const keepId = await userIdByEmail(h, 'keep@example.com');
    await db.userConsents.insertOne({
      _id: uuidv7(),
      userId: keepId,
      kind: 'agreement',
      version: 'v',
      acceptedAt: h.clock.now(),
    });
    h.clock.advance(7 * DAY + 1);

    expect(await processor.process({ name: 'cleanup-unverified' } as Job)).toBe(1);

    expect(await emails()).toEqual(['keep@example.com']);
    for (const collection of [
      db.userConsents,
      db.emailVerificationTokens,
      db.passwordResetTokens,
      db.registrationTokens,
      db.sessions,
    ]) {
      expect(await collection.countDocuments({ userId })).toBe(0);
    }
    expect(await db.userConsents.countDocuments({ userId: keepId })).toBe(1);
  });

  it('подтверждение «в процессе» во время очистки — аккаунт остаётся (удаление перепроверяет условия после повтора)', async () => {
    await insertUser('racing@example.com', 7 * DAY + 1);
    const userId = await userIdByEmail(h, 'racing@example.com');
    // confirm под lockUser уже подтвердил, но ещё не закоммитил
    const confirmTx = await holdTransaction(h, async (session) => {
      await collections(h).users.updateOne(
        { _id: userId },
        { $inc: { version: 1 }, $set: { emailVerifiedAt: h.clock.now() } },
        { session },
      );
    });
    const deletes = vi.spyOn(Collection.prototype, 'findOneAndDelete');
    const cleanup = processor.run();
    // удаление в транзакции очистки упёрлось в конфликт записи и повторяется
    await untilBlocked(cleanup, retried(deletes));
    await confirmTx.commit();

    expect(await cleanup).toBe(0);
    expect(await emails()).toEqual(['racing@example.com']);
  });
});
