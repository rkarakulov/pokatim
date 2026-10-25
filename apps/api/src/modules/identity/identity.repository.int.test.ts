import { isDuplicateKey, uuidv7 } from '@rkarakulov/api-kit/mongo';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { createHarness, type Harness } from '../../../test/harness';
import { collections, register } from '../../../test/identity';
import { MongoTransactions } from '../../db';
import { IdentityRepository } from './identity.repository';
import { sha256 } from './tokens';

let h: Harness;
let repository: IdentityRepository;
let transactions: MongoTransactions;
const now = new Date('2026-10-22T09:00:00Z');
const later = new Date(now.getTime() + 3600_000);

async function userWithRegistrationToken() {
  return transactions.run(async (session) => {
    const userId = await repository.insertUser(session, {
      email: 'rider@example.com',
      passwordHash: 'x',
      birthDate: '1990-05-01',
      createdAt: now,
    });
    await repository.insertRegistrationToken(session, {
      userId,
      tokenHash: sha256('reg'),
      createdAt: now,
      expiresAt: later,
    });
    return userId;
  });
}

beforeAll(async () => {
  h = await createHarness();
  repository = h.app.get(IdentityRepository);
  transactions = h.app.get(MongoTransactions);
});
beforeEach(async () => {
  await h.reset();
});
afterAll(async () => {
  await h.close();
});

describe('IdentityRepository.consumeRegistrationToken', () => {
  const consume = (at: Date) =>
    transactions.run((session) => repository.consumeRegistrationToken(session, sha256('reg'), at));

  it('обменивает ровно один раз', async () => {
    const userId = await userWithRegistrationToken();
    expect(await consume(now)).toBe(userId);
    expect(await consume(now)).toBeUndefined();
  });

  it('не обменивает после истечения', async () => {
    await userWithRegistrationToken();
    expect(await consume(later)).toBeUndefined();
    expect(await consume(now)).toBeDefined();
  });

  it('lockUser увеличивает version аккаунта (R1) и возвращает состояние без хеша пароля', async () => {
    const userId = await userWithRegistrationToken();
    const locked = await transactions.run((session) => repository.lockUser(session, userId));
    expect(locked).toEqual({
      id: userId,
      email: 'rider@example.com',
      emailVerifiedAt: null,
      deletedAt: null,
    });
    expect(await collections(h).users.findOne({ _id: userId })).toMatchObject({ version: 1 });
  });
});

describe('инварианты без ограничений БД (R5)', () => {
  it('e-mail сохраняется нормализованным (нижний регистр) — единственный писатель через контракт', async () => {
    expect((await register(h, { email: 'Rider@EXAMPLE.com' })).status).toBe(201);
    const docs = await collections(h).users.find().toArray();
    expect(docs.map((doc) => doc.email)).toEqual(['rider@example.com']);
  });

  it('у пользователя одна активная ссылка (частичный уникальный индекс)', async () => {
    const userId = await userWithRegistrationToken();
    const link = (hash: string) =>
      transactions.run((session) =>
        repository.insertVerificationToken(session, {
          id: uuidv7(),
          userId,
          tokenHash: sha256(hash),
          createdAt: now,
          expiresAt: later,
        }),
      );
    await link('a');
    const second = await link('b').catch((error: unknown) => error);
    expect(isDuplicateKey(second, 'email_verification_tokens_active_unique')).toBe(true);
    await transactions.run((session) =>
      repository.supersedeActiveVerificationTokens(session, userId, now),
    );
    await expect(link('b')).resolves.toBeUndefined();
  });
});

describe('IdentityRepository.rotateSession (R3)', () => {
  it('значения в pipeline — через $literal: строка на «$» сохраняется как есть, а не как путь поля', async () => {
    const userId = await userWithRegistrationToken();
    const id = uuidv7();
    await transactions.run((session) =>
      repository.insertSession(session, {
        id,
        userId,
        refreshTokenHash: sha256('refresh'),
        createdAt: now,
        expiresAt: later,
      }),
    );

    const rotated = await repository.rotateSession({
      tokenHash: sha256('refresh'),
      nextTokenHash: '$createdAt',
      now,
      graceMs: 60_000,
      ttlMs: 3600_000,
      absoluteTtlMs: 7200_000,
    });

    expect(rotated).toEqual({ id, userId, expiresAt: later });
    expect(await collections(h).sessions.findOne({ _id: id })).toMatchObject({
      refreshTokenHash: '$createdAt',
      previousRefreshTokenHash: sha256('refresh'),
      rotatedAt: now,
    });
  });
});
