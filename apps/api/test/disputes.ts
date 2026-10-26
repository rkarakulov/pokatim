import { uuidv7 } from '@rkarakulov/api-kit/mongo';

import { type DisputeDoc, disputesCollections } from '../src/modules/disputes/disputes.collection';
import type { Harness } from './harness';

/** Коллекции модуля `disputes` тестовой БД. */
export const disputesDb = (h: Harness) => disputesCollections(h.db);

/**
 * Спор напрямую в БД (подготовка тестов гейтов `results`/`races`; подачу проверяет `disputes`). По умолчанию —
 * открытый, `filedAt` — «сейчас» стенда.
 */
export async function seedDispute(
  h: Harness,
  input: Pick<DisputeDoc, 'raceId' | 'targetEntryId'> & Partial<DisputeDoc>,
): Promise<DisputeDoc> {
  const now = h.clock.now();
  const doc: DisputeDoc = {
    _id: uuidv7(),
    groupKey: 'overall',
    complainantUserId: uuidv7(),
    complainantEntryId: uuidv7(),
    targetUserId: uuidv7(),
    category: 'other',
    description: null,
    status: 'open',
    response: null,
    decision: null,
    filedAt: now,
    closedAt: null,
    version: 0,
    createdAt: now,
    updatedAt: now,
    ...input,
  };
  await disputesDb(h).disputes.insertOne(doc);
  return doc;
}

/** Закрыть спор напрямую в БД (подготовка: «после решения или отзыва»). */
export async function closeSeededDispute(h: Harness, id: string): Promise<void> {
  await disputesDb(h).disputes.updateOne(
    { _id: id },
    { $set: { status: 'withdrawn', closedAt: h.clock.now() } },
  );
}
