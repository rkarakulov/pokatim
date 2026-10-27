import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';

import { describe, expect, it } from 'vitest';

/** Исходники API без тестов. */
function sources(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return sources(path);
    return entry.name.endsWith('.ts') && !entry.name.includes('.test.') ? [path] : [];
  });
}

const SRC = join(__dirname, '..', '..');
const REPOSITORY = join(__dirname, 'results.repository.ts');
const APPEND_ONLY = ['reviews', 'protocolRows', 'recalculations'] as const;
const READS_AND_INSERTS = [
  'insertOne',
  'insertMany',
  'find',
  'findOne',
  'countDocuments',
  'aggregate',
];

/**
 * Тест-сторож append-only протокола (race-results-05, AC10, `AGENTS.md` §4.10): исключения треков, снимок протокола и
 * журнал пересчётов пишутся только вставками в `ResultsRepository`. Роль MongoDB без update/remove — follow-up.
 */
describe('протокол гонки — append-only', () => {
  it.each(APPEND_ONLY)('в ResultsRepository над %s — только вставки и чтения', (collection) => {
    const code = readFileSync(REPOSITORY, 'utf8');
    const methods = [
      ...code.matchAll(new RegExp(`this\\.c\\.${collection}\\s*\\.\\s*(\\w+)`, 'g')),
    ].map((match) => match[1]);
    expect(methods.length).toBeGreaterThan(0);
    expect(methods.filter((method) => !READS_AND_INSERTS.includes(method!))).toEqual([]);
    expect(methods.some((method) => method === 'insertOne' || method === 'insertMany')).toBe(true);
  });

  it('коллекции протокола по имени знают только описание коллекций, репозиторий и миграция', () => {
    const users = sources(SRC)
      .filter((file) =>
        /['"`]race_(attempt_reviews|protocol_rows|recalculations)['"`]|RESULTS_COLLECTIONS\.(reviews|protocolRows|recalculations)|resultsCollections\(/.test(
          readFileSync(file, 'utf8'),
        ),
      )
      .map((file) => relative(SRC, file))
      .sort();
    expect(users).toEqual([
      'db/migrations/0016_protocol.ts',
      // race-results-07: индекс строк протокола по группе
      'db/migrations/0025_entry_tier.ts',
      'modules/results/results.collection.ts',
      'modules/results/results.repository.ts',
    ]);
  });
});
