import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { uuidv7 } from '@rkarakulov/api-kit/mongo';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { createHarness, type Harness } from '../../../test/harness';
import { MongoTransactions } from '../../db';
import { productEventsCollections } from './product-events.collection';
import { PRODUCT_EVENTS, type ProductEventInput, type ProductEvents } from './product-events.port';
import { ProductEventErasure } from './product-event-erasure';

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

const events = () => productEventsCollections(h.db).events;
const port = () => h.worker.get<ProductEvents>(PRODUCT_EVENTS, { strict: false });

describe('журнал продуктовых событий (K12, ADR-0027 п. 7)', () => {
  it('record пишет событие справочника с временем CLOCK', async () => {
    const userId = uuidv7();
    await port().record({ type: 'attendance-marked', userId, props: { via: 'manual' } });
    expect(
      await events()
        .find({ userId }, { projection: { _id: 0 } })
        .toArray(),
    ).toEqual([{ type: 'attendance-marked', userId, props: { via: 'manual' }, at: h.clock.now() }]);
  });

  it('неизвестный тип и лишнее поле — throw, документа нет', async () => {
    const userId = uuidv7();
    await expect(
      port().record({ type: 'opened', userId, props: {} } as unknown as ProductEventInput),
    ).rejects.toThrow();
    await expect(
      port().record({
        type: 'thanks-sent',
        userId,
        props: { recipientId: uuidv7() },
      } as unknown as ProductEventInput),
    ).rejects.toThrow();
    expect(await events().countDocuments()).toBe(0);
  });

  it('откат транзакции вызывающего — документа нет', async () => {
    const userId = uuidv7();
    await expect(
      h.worker.get(MongoTransactions).run(async (tx) => {
        await port().record({ type: 'name-published', userId, props: {} }, tx);
        throw new Error('rollback');
      }),
    ).rejects.toThrow('rollback');
    expect(await events().countDocuments({ userId })).toBe(0);
  });

  it('стирание удаляет только события райдера; повтор — 0', async () => {
    const a = uuidv7();
    const b = uuidv7();
    for (const userId of [a, a, b]) {
      await port().record({ type: 'thanks-sent', userId, props: {} });
    }
    const erasure = h.worker.get(ProductEventErasure);
    expect(await erasure.erase(a)).toBe(2);
    expect(await events().countDocuments({ userId: a })).toBe(0);
    expect(await events().countDocuments({ userId: b })).toBe(1);
    expect(await erasure.erase(a)).toBe(0);
  });

  it('append-only: репозиторий не обновляет события и удаляет только по userId (сторож)', () => {
    const source = readFileSync(join(__dirname, 'product-events.repository.ts'), 'utf8');
    expect(source).not.toMatch(/\.(updateOne|updateMany|replaceOne|findOneAndUpdate|deleteOne)\(/);
    expect(source.match(/\.deleteMany\(/g)).toHaveLength(1);
  });
});
