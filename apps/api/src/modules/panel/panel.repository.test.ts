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
const REPOSITORY = join(__dirname, 'panel.repository.ts');

/**
 * Тест-сторож append-only журнала (`AGENTS.md` §4.10, §8.3 п. 6): `panel_audit` пишется только `insertOne` в
 * `PanelRepository`, а репозиторий читает его только `find`. Роль MongoDB без update/remove — follow-up.
 */
describe('panel_audit — append-only', () => {
  it('в PanelRepository над журналом — только insertOne и find', () => {
    const code = readFileSync(REPOSITORY, 'utf8');
    const methods = [...code.matchAll(/this\.c\.audit\s*\.\s*(\w+)/g)].map((match) => match[1]);
    expect(methods.length).toBeGreaterThan(0);
    expect(new Set(methods)).toEqual(new Set(['insertOne', 'find']));
  });

  it('коллекцию журнала по имени знают только описание коллекций и миграция', () => {
    const users = sources(SRC)
      .filter((file) => {
        const code = readFileSync(file, 'utf8');
        return /panel_audit|PANEL_COLLECTIONS\.audit|panelCollections\(/.test(code);
      })
      .map((file) => relative(SRC, file))
      .sort();
    expect(users).toEqual([
      'db/migrations/0005_panel.ts',
      'modules/panel/panel.collection.ts',
      'modules/panel/panel.repository.ts',
    ]);
  });
});
