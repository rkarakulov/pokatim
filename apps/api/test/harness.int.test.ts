import { ENV, MAILER } from '@rkarakulov/api-kit/core';
import {
  MIGRATIONS_COLLECTION,
  MongoOutboxPublisher,
  MongoOutboxWriter,
  OUTBOX_COLLECTION,
} from '@rkarakulov/api-kit/mongo';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { MongoTransactions, type MongoOutboxDoc } from '../src/db';
import { migrations } from '../src/db/migrations';
import { identityCollections } from '../src/modules/identity/identity.collection';
import { createHarness, type Harness } from './harness';
import { register } from './identity';

const WEB = 'http://127.0.0.1:8081';

let h: Harness;
beforeAll(async () => {
  h = await createHarness({ TRUST_PROXY: '1', CORS_ORIGINS: WEB });
});
beforeEach(async () => {
  await h.reset();
});
afterAll(async () => {
  await h.close();
});

const outbox = () => h.db.collection<MongoOutboxDoc>(OUTBOX_COLLECTION);

describe('стенд pokatim (обёртка createMongoApiHarness)', () => {
  it('HTTP API pokatim под префиксом версии контракта: /v1/health — 200, БД доступна', async () => {
    const res = await h.app.inject({ method: 'GET', url: '/v1/health' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ status: 'ok', checks: { database: 'up' } });
  });

  it('HTTP-настройка проекта (configureHttp, как в main.ts): CORS только для CORS_ORIGINS', async () => {
    const fromWeb = await h.app.inject({
      method: 'GET',
      url: '/v1/health',
      headers: { origin: WEB },
    });
    expect(fromWeb.headers['access-control-allow-origin']).toBe(WEB);
    const foreign = await h.app.inject({
      method: 'GET',
      url: '/v1/health',
      headers: { origin: 'https://evil.example' },
    });
    expect(foreign.headers['access-control-allow-origin']).toBeUndefined();
  });

  it('окружение тестов с переопределениями — в ENV API и worker; MAILER worker — FakeMailer стенда', () => {
    expect(h.env.TRUST_PROXY).toBe(1);
    expect(h.app.get(ENV)).toBe(h.env);
    expect(h.worker.get(ENV)).toBe(h.env);
    expect(h.worker.get(MAILER)).toBe(h.mailer);
  });

  it('worker-граф с маршрутами outbox проекта собирается: публикатор есть', () => {
    expect(h.worker.get(MongoOutboxPublisher)).toBeInstanceOf(MongoOutboxPublisher);
  });

  it('outbox в транзакции: откат — события нет, коммит — есть', async () => {
    const transactions = h.app.get(MongoTransactions);
    const writer = h.app.get(MongoOutboxWriter);
    await expect(
      transactions.run(async (session) => {
        await writer.append(session, { type: 'test.event', payload: { id: 1 } });
        throw new Error('откат');
      }),
    ).rejects.toThrow('откат');
    expect(await outbox().countDocuments()).toBe(0);

    const id = await transactions.run((session) =>
      writer.append(session, { type: 'test.event', payload: { id: 2 } }),
    );
    expect(await outbox().findOne({ _id: id })).toMatchObject({ publishedAt: null });
  });

  it('reset() чистит коллекции pokatim и outbox; учёт миграций и индексы остаются', async () => {
    const { users } = identityCollections(h.db);
    expect((await register(h)).status).toBe(201);
    expect(await users.countDocuments()).toBe(1);
    expect(await outbox().countDocuments()).toBe(1);

    await h.reset();

    expect(await users.countDocuments()).toBe(0);
    expect(await outbox().countDocuments()).toBe(0);
    expect((await users.indexes()).map((index) => index.name)).toContain('users_email_unique');
    expect(await h.db.collection(MIGRATIONS_COLLECTION).countDocuments()).toBe(migrations.length);
  });

  it('миграции применены на чистой *_test: индекс outbox_unpublished_idx на месте', async () => {
    const indexes = await outbox().indexes();
    expect(indexes.map((index) => index.name)).toContain('outbox_unpublished_idx');
  });
});
