import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';

import type { Db } from 'mongodb';
import { describe, expect, it } from 'vitest';

import { ProfileReportsRepository } from './profile-reports.repository';

/** Исходники API без тестов. */
function sources(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return sources(path);
    return entry.name.endsWith('.ts') && !entry.name.includes('.test.') ? [path] : [];
  });
}

const SRC = join(__dirname, '..', '..');
const REPOSITORY = join(__dirname, 'profile-reports.repository.ts');

/** Коллекция-заглушка: запоминает вызовы записи. */
function fakeDb() {
  const calls: { method: string; filter: unknown; update?: unknown; options?: unknown }[] = [];
  const collection = {
    updateMany: (filter: unknown, update: unknown) => {
      calls.push({ method: 'updateMany', filter, update });
      return Promise.resolve({ modifiedCount: 2 });
    },
    deleteMany: (filter: unknown) => {
      calls.push({ method: 'deleteMany', filter });
      return Promise.resolve({ deletedCount: 3 });
    },
  };
  return { db: { collection: () => collection } as unknown as Db, calls };
}

/**
 * Тест-сторож жалоб на профили (profile-moderation, `pokatim-db.md`): содержание жалобы неизменно; переход — только
 * закрытие открытой; единственное удаление — жалобы на удалённый аккаунт (`deleteForTarget`).
 */
describe('profile_reports — вставка, закрытие и удаление жалоб на удалённого', () => {
  it('в ProfileReportsRepository запись — только insertOne, updateMany и deleteMany', () => {
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
    expect([...code.matchAll(/this\.reports\s*\.\s*updateMany/g)]).toHaveLength(1);
  });

  it('закрытие: фильтр только открытых жалоб цели, $set — resolvedAt, resolution, resolvedBy', async () => {
    const { db, calls } = fakeDb();
    const now = new Date('2026-10-28T10:00:00Z');
    await expect(
      new ProfileReportsRepository(db).closeOpen(
        undefined as never,
        'u1',
        'actioned',
        'mod-1',
        now,
      ),
    ).resolves.toBe(2);
    expect(calls).toEqual([
      {
        method: 'updateMany',
        filter: { targetUserId: 'u1', resolvedAt: null },
        update: { $set: { resolvedAt: now, resolution: 'actioned', resolvedBy: 'mod-1' } },
      },
    ]);
  });

  it('удаление — только все жалобы на одного пользователя', async () => {
    const { db, calls } = fakeDb();
    await expect(new ProfileReportsRepository(db).deleteForTarget('u1')).resolves.toBe(3);
    expect(calls).toEqual([{ method: 'deleteMany', filter: { targetUserId: 'u1' } }]);
  });

  it('коллекцию жалоб по имени знают только описание коллекции, репозиторий и миграция', () => {
    const users = sources(SRC)
      .filter((file) =>
        /['"`]profile_reports['"`]|PROFILE_REPORTS_COLLECTIONS\.reports|profileReportsCollections\(/.test(
          readFileSync(file, 'utf8'),
        ),
      )
      .map((file) => relative(SRC, file))
      .sort();
    expect(users).toEqual([
      'db/migrations/0034_profile_reports.ts',
      // бэкфилл `profiles.openReasons` — только чтение открытых жалоб (profile-moderation-followups)
      'db/migrations/0041_profile_report_reasons.ts',
      'modules/profile/profile-reports.collection.ts',
      'modules/profile/profile-reports.repository.ts',
    ]);
  });
});
