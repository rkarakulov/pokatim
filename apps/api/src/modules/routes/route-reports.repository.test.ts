import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';

import type { Db } from 'mongodb';
import { describe, expect, it } from 'vitest';

import { RouteReportsRepository } from './route-reports.repository';

/** Исходники API без тестов. */
function sources(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return sources(path);
    return entry.name.endsWith('.ts') && !entry.name.includes('.test.') ? [path] : [];
  });
}

const SRC = join(__dirname, '..', '..');
const REPOSITORY = join(__dirname, 'route-reports.repository.ts');

/** Коллекция-заглушка: запоминает вызовы записи. */
function fakeDb() {
  const calls: { method: string; filter: unknown; update?: unknown; options?: unknown }[] = [];
  const collection = {
    updateMany: (filter: unknown, update: unknown) => {
      calls.push({ method: 'updateMany', filter, update });
      return Promise.resolve({ modifiedCount: 2 });
    },
    deleteMany: (filter: unknown, options: unknown) => {
      calls.push({ method: 'deleteMany', filter, options });
      return Promise.resolve({ deletedCount: 3 });
    },
  };
  return { db: { collection: () => collection } as unknown as Db, calls };
}

/**
 * Тест-сторож жалоб на маршруты (routes-06, 8.1 RC-5, `pokatim-db.md`): содержание жалобы неизменно; переход — только
 * закрытие открытой; единственное удаление — все жалобы маршрута вместе с ним (`deleteForRoute`).
 */
describe('route_reports — вставка, закрытие и удаление вместе с маршрутом', () => {
  it('в RouteReportsRepository запись — только insertOne, updateMany и deleteMany', () => {
    const code = readFileSync(REPOSITORY, 'utf8');
    const methods = new Set(
      [...code.matchAll(/this\.reports\s*\.\s*(\w+)/g)].map((match) => match[1]),
    );
    expect(methods.size).toBeGreaterThan(0);
    for (const method of methods) {
      expect(['insertOne', 'updateMany', 'deleteMany', 'findOne', 'find', 'aggregate']).toContain(
        method,
      );
    }
    expect(code).not.toMatch(/deleteOne|replace|findOneAndUpdate|updateOne|bulkWrite/i);
    expect([...code.matchAll(/this\.reports\s*\.\s*deleteMany/g)]).toHaveLength(1);
  });

  it('закрытие: фильтр только открытых, $set — resolvedAt, resolution, resolvedBy', async () => {
    const { db, calls } = fakeDb();
    const now = new Date('2026-10-27T10:00:00Z');
    await expect(
      new RouteReportsRepository(db).closeOpen(undefined as never, 'r1', 'hidden', 'mod-1', now),
    ).resolves.toBe(2);
    expect(calls).toEqual([
      {
        method: 'updateMany',
        filter: { routeId: 'r1', resolvedAt: null },
        update: { $set: { resolvedAt: now, resolution: 'hidden', resolvedBy: 'mod-1' } },
      },
    ]);
  });

  it('удаление — только все жалобы одного маршрута, в транзакции', async () => {
    const { db, calls } = fakeDb();
    const tx = { id: 'tx' } as never;
    await expect(new RouteReportsRepository(db).deleteForRoute(tx, 'r1')).resolves.toBe(3);
    expect(calls).toEqual([
      { method: 'deleteMany', filter: { routeId: 'r1' }, options: { session: tx } },
    ]);
  });

  it('коллекцию жалоб по имени знают только описание коллекции, репозиторий и миграция', () => {
    const users = sources(SRC)
      .filter((file) =>
        /['"`]route_reports['"`]|ROUTE_REPORTS_COLLECTIONS\.reports|routeReportsCollections\(/.test(
          readFileSync(file, 'utf8'),
        ),
      )
      .map((file) => relative(SRC, file))
      .sort();
    expect(users).toEqual([
      'db/migrations/0028_routes_publication.ts',
      'modules/routes/route-reports.collection.ts',
      'modules/routes/route-reports.repository.ts',
    ]);
  });
});
