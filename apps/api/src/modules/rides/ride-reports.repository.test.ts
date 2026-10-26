import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';

import type { Db } from 'mongodb';
import { describe, expect, it } from 'vitest';

import { RideReportsRepository } from './ride-reports.repository';

/** Исходники API без тестов. */
function sources(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return sources(path);
    return entry.name.endsWith('.ts') && !entry.name.includes('.test.') ? [path] : [];
  });
}

const SRC = join(__dirname, '..', '..');
const REPOSITORY = join(__dirname, 'ride-reports.repository.ts');

/**
 * Тест-сторож жалоб (8.1 A7, `pokatim-db.md`): содержание жалобы неизменно, удалений нет; единственный переход —
 * закрытие открытой (`resolvedAt: null` в фильтре, `$set` только трёх полей закрытия).
 */
describe('ride_reports — только вставка и закрытие', () => {
  it('в RideReportsRepository — без delete/replace; запись — только insertOne и updateMany', () => {
    const code = readFileSync(REPOSITORY, 'utf8');
    const methods = new Set(
      [...code.matchAll(/this\.reports\s*\.\s*(\w+)/g)].map((match) => match[1]),
    );
    expect(methods.size).toBeGreaterThan(0);
    for (const method of methods) {
      expect(['insertOne', 'updateMany', 'findOne', 'find', 'aggregate']).toContain(method);
    }
    expect(code).not.toMatch(/delete|replace|findOneAndUpdate|updateOne|bulkWrite/i);
  });

  it('закрытие: фильтр только открытых, $set — resolvedAt, resolution, resolvedBy', async () => {
    const calls: { filter: unknown; update: unknown }[] = [];
    const collection = {
      updateMany: (filter: unknown, update: unknown) => {
        calls.push({ filter, update });
        return Promise.resolve({ modifiedCount: 2 });
      },
    };
    const db = { collection: () => collection } as unknown as Db;
    const repository = new RideReportsRepository(db);
    const now = new Date('2026-10-27T10:00:00Z');
    await expect(
      repository.closeOpen(undefined as never, 'ride-1', 'hidden', 'mod-1', now),
    ).resolves.toBe(2);
    expect(calls).toEqual([
      {
        filter: { rideId: 'ride-1', resolvedAt: null },
        update: { $set: { resolvedAt: now, resolution: 'hidden', resolvedBy: 'mod-1' } },
      },
    ]);
  });

  it('коллекцию жалоб по имени знают только описание коллекции, репозиторий и миграция', () => {
    const users = sources(SRC)
      .filter((file) =>
        /['"`]ride_reports['"`]|RIDE_REPORTS_COLLECTIONS\.reports|rideReportsCollections\(/.test(
          readFileSync(file, 'utf8'),
        ),
      )
      .map((file) => relative(SRC, file))
      .sort();
    expect(users).toEqual([
      'db/migrations/0017_ride_reports.ts',
      'modules/rides/ride-reports.collection.ts',
      'modules/rides/ride-reports.repository.ts',
    ]);
  });
});
