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
const REPOSITORY = join(__dirname, 'devices.repository.ts');

/**
 * Тест-сторож append-only журнала подключений (§8.3 п. 6): `device_audit` пишется только `insertOne` в
 * `DevicesRepository`; коллекцию по имени знают только описание коллекций, репозиторий и миграция.
 */
describe('device_audit — append-only', () => {
  it('в DevicesRepository над журналом — только insertOne', () => {
    const code = readFileSync(REPOSITORY, 'utf8');
    const methods = [...code.matchAll(/this\.c\.audit\s*\.\s*(\w+)/g)].map((match) => match[1]);
    expect(methods.length).toBeGreaterThan(0);
    expect(new Set(methods)).toEqual(new Set(['insertOne']));
  });

  it('коллекцию журнала по имени знают только описание коллекций, репозиторий и миграция', () => {
    const users = sources(SRC)
      .filter((file) => {
        const code = readFileSync(file, 'utf8');
        return /['"`]device_audit['"`]|DEVICES_COLLECTIONS\.audit|devicesCollections\(/.test(code);
      })
      .map((file) => relative(SRC, file))
      .sort();
    expect(users).toEqual([
      'db/migrations/0011_devices.ts',
      'modules/devices/devices.collection.ts',
      'modules/devices/devices.repository.ts',
    ]);
  });
});
