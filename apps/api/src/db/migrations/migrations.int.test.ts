import { MIGRATIONS_COLLECTION, runMongoMigrations } from '@rkarakulov/api-kit/mongo';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createHarness, type Harness } from '../../../test/harness';
import { IDENTITY_COLLECTIONS } from '../../modules/identity/identity.collection';
import { PANEL_COLLECTIONS } from '../../modules/panel/panel.collection';
import { PROFILE_COLLECTIONS } from '../../modules/profile/profile.collection';
import { IDENTITY_INDEXES } from './0002_identity';
import { IDENTITY_TTL_SECONDS } from './0003_identity_ttl';
import { profile } from './0004_profile';
import { panel, PANEL_SESSION_TTL_SECONDS } from './0005_panel';
import { migrations } from './index';

let h: Harness;
beforeAll(async () => {
  h = await createHarness();
});
afterAll(async () => {
  await h.close();
});

/** Индексы коллекции без служебного `_id_`: имя → ключ и опции, которые проверяет AC5. */
async function indexesOf(collection: string) {
  const all = await h.db.collection(collection).indexes();
  return Object.fromEntries(
    all
      .filter((index) => index.name !== '_id_')
      .map((index) => [
        index.name,
        {
          key: index.key,
          unique: index.unique ?? false,
          partialFilterExpression: index.partialFilterExpression,
          expireAfterSeconds: index.expireAfterSeconds,
        },
      ]),
  );
}

describe('миграции MongoDB на чистой *_test (AC5)', () => {
  it('применены по порядку: 0001_outbox … 0005_panel', async () => {
    const applied = await h.db
      .collection<{ _id: string }>(MIGRATIONS_COLLECTION)
      .find()
      .sort({ _id: 1 })
      .toArray();
    expect(applied.map((doc) => doc._id)).toEqual([
      '0001_outbox',
      '0002_identity',
      '0003_identity_ttl',
      '0004_profile',
      '0005_panel',
    ]);
  });

  it('0005_panel: коллекции, индексы, TTL сессий и документ panel_meta.admins; повторный up не сбрасывает версию (AC13)', async () => {
    const plain = (key: Record<string, number>, unique = false, ttl?: number) => ({
      key,
      unique,
      partialFilterExpression: undefined,
      expireAfterSeconds: ttl,
    });
    expect(await indexesOf(PANEL_COLLECTIONS.members)).toEqual({
      panel_members_role_status_idx: plain({ role: 1, status: 1 }),
    });
    expect(await indexesOf(PANEL_COLLECTIONS.sessions)).toEqual({
      panel_sessions_token_hash_unique: plain({ tokenHash: 1 }, true),
      panel_sessions_user_id_idx: plain({ userId: 1 }),
      panel_sessions_expires_at_ttl: plain({ expiresAt: 1 }, false, PANEL_SESSION_TTL_SECONDS),
    });
    expect(await indexesOf(PANEL_COLLECTIONS.audit)).toEqual({
      panel_audit_action_idx: plain({ action: 1, _id: -1 }),
      panel_audit_actor_idx: plain({ 'actor.userId': 1, _id: -1 }),
      panel_audit_target_idx: plain({ targetUserId: 1, _id: -1 }),
    });
    const meta = h.db.collection<{ _id: string; version: number }>(PANEL_COLLECTIONS.meta);
    expect(await meta.find().toArray()).toEqual([{ _id: 'admins', version: 0 }]);

    await meta.updateOne({ _id: 'admins' }, { $inc: { version: 1 } });
    await panel.up(h.db);
    await panel.up(h.db);
    expect(await meta.find().toArray()).toEqual([{ _id: 'admins', version: 1 }]);
    await meta.updateOne({ _id: 'admins' }, { $set: { version: 0 } });
  });

  it('0004_profile: коллекция profiles без индексов сверх _id; повторный up — без ошибки', async () => {
    const exists = () =>
      h.db.listCollections({ name: PROFILE_COLLECTIONS.profiles }, { nameOnly: true }).toArray();
    expect(await exists()).toHaveLength(1);
    expect(await indexesOf(PROFILE_COLLECTIONS.profiles)).toEqual({});

    await h.db.collection(PROFILE_COLLECTIONS.profiles).drop();
    await profile.up(h.db);
    await profile.up(h.db);
    expect(await exists()).toHaveLength(1);
  });

  it('индексы identity: имена, ключи, unique, partialFilterExpression; TTL 30 дней (Q2)', async () => {
    const ttl = (collection: string) => ({
      [`${collection}_expires_at_ttl`]: {
        key: { expiresAt: 1 },
        unique: false,
        partialFilterExpression: undefined,
        expireAfterSeconds: IDENTITY_TTL_SECONDS,
      },
    });
    const plain = (key: Record<string, number>, unique = false, partial?: object) => ({
      key,
      unique,
      partialFilterExpression: partial,
      expireAfterSeconds: undefined,
    });
    const active = { usedAt: { $eq: null }, supersededAt: { $eq: null } };
    const links = (collection: string) => ({
      [`${collection}_token_hash_unique`]: plain({ tokenHash: 1 }, true),
      [`${collection}_user_id_idx`]: plain({ userId: 1, createdAt: -1 }),
      [`${collection}_active_unique`]: plain({ userId: 1 }, true, active),
      ...ttl(collection),
    });

    expect(await indexesOf(IDENTITY_COLLECTIONS.users)).toEqual({
      users_email_unique: plain({ email: 1 }, true),
      users_unverified_created_at_idx: plain({ createdAt: 1 }, false, {
        emailVerifiedAt: { $eq: null },
        deletedAt: { $eq: null },
      }),
    });
    expect(await indexesOf(IDENTITY_COLLECTIONS.userConsents)).toEqual({
      user_consents_user_id_idx: plain({ userId: 1 }),
    });
    expect(await indexesOf(IDENTITY_COLLECTIONS.emailVerificationTokens)).toEqual(
      links(IDENTITY_COLLECTIONS.emailVerificationTokens),
    );
    expect(await indexesOf(IDENTITY_COLLECTIONS.passwordResetTokens)).toEqual(
      links(IDENTITY_COLLECTIONS.passwordResetTokens),
    );
    expect(await indexesOf(IDENTITY_COLLECTIONS.registrationTokens)).toEqual({
      registration_tokens_user_id_unique: plain({ userId: 1 }, true),
      registration_tokens_token_hash_unique: plain({ tokenHash: 1 }, true),
      ...ttl(IDENTITY_COLLECTIONS.registrationTokens),
    });
    expect(await indexesOf(IDENTITY_COLLECTIONS.sessions)).toEqual({
      sessions_refresh_token_hash_unique: plain({ refreshTokenHash: 1 }, true),
      sessions_previous_refresh_token_hash_unique: plain({ previousRefreshTokenHash: 1 }, true, {
        previousRefreshTokenHash: { $type: 'string' },
      }),
      sessions_user_id_idx: plain({ userId: 1 }),
      ...ttl(IDENTITY_COLLECTIONS.sessions),
    });
    // каждая коллекция identity покрыта миграцией
    expect(Object.keys(IDENTITY_INDEXES).sort()).toEqual(
      Object.values(IDENTITY_COLLECTIONS).sort(),
    );
  });

  it('повторный прогон — новых миграций нет; повторный up — те же индексы без ошибки', async () => {
    const before = await Promise.all(Object.values(IDENTITY_COLLECTIONS).map(indexesOf));

    expect(await runMongoMigrations({ db: h.db, migrations })).toEqual({ applied: [] });
    for (const migration of migrations) await migration.up(h.db);

    expect(await Promise.all(Object.values(IDENTITY_COLLECTIONS).map(indexesOf))).toEqual(before);
  });
});
