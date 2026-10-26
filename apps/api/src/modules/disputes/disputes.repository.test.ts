import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';

import type { Db } from 'mongodb';
import { describe, expect, it } from 'vitest';

import { DisputesRepository } from './disputes.repository';

/** Исходники API без тестов. */
function sources(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return sources(path);
    return entry.name.endsWith('.ts') && !entry.name.includes('.test.') ? [path] : [];
  });
}

const SRC = join(__dirname, '..', '..');
const REPOSITORY = join(__dirname, 'disputes.repository.ts');
const code = readFileSync(REPOSITORY, 'utf8');
const methodsOf = (field: string) =>
  new Set(
    [...code.matchAll(new RegExp(`this\\.${field}\\s*\\.\\s*(\\w+)`, 'g'))].map(
      (match) => match[1],
    ),
  );

/**
 * Тест-сторож споров (RC-8, AC11, `pokatim-db.md`): история `dispute_events` — только вставки; спор — проекция с
 * переходами только из `open`, без удалений и замен.
 */
describe('споры — append-only история и переходы только из open', () => {
  it('dispute_events: только insertOne / find / findOne', () => {
    const methods = methodsOf('events');
    expect(methods.size).toBeGreaterThan(0);
    for (const method of methods) expect(['insertOne', 'find', 'findOne']).toContain(method);
  });

  it('disputes: insertOne / updateOne / findOne / find / countDocuments / aggregate; без delete, replace, updateMany, findOneAndUpdate, bulkWrite', () => {
    const methods = methodsOf('disputes');
    expect(methods.size).toBeGreaterThan(0);
    for (const method of methods) {
      expect([
        'insertOne',
        'updateOne',
        'findOne',
        'find',
        'countDocuments',
        'aggregate',
      ]).toContain(method);
    }
    expect(code).not.toMatch(/delete|replace|updateMany|findOneAndUpdate|bulkWrite/i);
  });

  it('каждый переход — updateOne с status: open в фильтре; ответ — ещё и response: null; $set — только поля перехода', async () => {
    const calls: { filter: Record<string, unknown>; update: Record<string, unknown> }[] = [];
    const collection = {
      updateOne: (filter: Record<string, unknown>, update: Record<string, unknown>) => {
        calls.push({ filter, update });
        return Promise.resolve({ matchedCount: 0 });
      },
    };
    const db = { collection: () => collection } as unknown as Db;
    const repository = new DisputesRepository(db);
    const now = new Date('2026-10-27T10:00:00Z');
    const tx = undefined as never;
    await expect(repository.withdraw(tx, 'd', 'u', now)).resolves.toBeNull();
    await expect(repository.respond(tx, 'd', 't', 'Мой трек', now)).resolves.toBeNull();
    await expect(
      repository.decide(
        tx,
        'd',
        { outcome: 'upheld', template: 'rules_violation', note: null, actorUserId: 's', at: now },
        now,
      ),
    ).resolves.toBeNull();
    expect(calls).toHaveLength(3);
    for (const call of calls) {
      expect(call.filter).toMatchObject({ _id: 'd', status: 'open' });
      expect(call.update.$inc).toEqual({ version: 1 });
      for (const field of Object.keys(call.update.$set as object)) {
        expect(['status', 'response', 'decision', 'closedAt', 'updatedAt']).toContain(field);
      }
    }
    expect(calls[0]!.filter).toEqual({ _id: 'd', complainantUserId: 'u', status: 'open' });
    expect(calls[1]!.filter).toEqual({
      _id: 'd',
      targetUserId: 't',
      status: 'open',
      response: null,
    });
  });

  // строковые литералы имён (обратные кавычки — это комментарии к модулю `disputes`, не имена коллекций)
  it('коллекции споров по имени знают только описание коллекций, репозиторий и миграция', () => {
    const users = sources(SRC)
      .filter((file) =>
        /['"](disputes|dispute_events)['"]|DISPUTES_COLLECTIONS\.|disputesCollections\(/.test(
          readFileSync(file, 'utf8'),
        ),
      )
      .map((file) => relative(SRC, file))
      .sort();
    expect(users).toEqual([
      'db/migrations/0018_disputes.ts',
      'modules/disputes/disputes.collection.ts',
      'modules/disputes/disputes.repository.ts',
    ]);
  });
});
