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
const REPOSITORY = join(__dirname, 'profile.repository.ts');

/**
 * Тест-сторож журнала согласий (profile-02, `pokatim-db.md`): `profile_consent_events` — append-only, только
 * `insertOne` в `ProfileRepository`; имя коллекции знают только описание коллекции, репозиторий и миграция.
 */
describe('profile_consent_events — только вставка', () => {
  it('в ProfileRepository к журналу согласий — только insertOne', () => {
    const code = readFileSync(REPOSITORY, 'utf8');
    const methods = new Set(
      [...code.matchAll(/this\.consentEvents\s*\.\s*(\w+)/g)].map((match) => match[1]),
    );
    expect([...methods]).toEqual(['insertOne']);
  });

  it('коллекцию журнала по имени знают только описание коллекции, репозиторий и миграция', () => {
    const users = sources(SRC)
      .filter((file) =>
        /['"`]profile_consent_events['"`]|PROFILE_COLLECTIONS\.consentEvents/.test(
          readFileSync(file, 'utf8'),
        ),
      )
      .map((file) => relative(SRC, file))
      .sort();
    expect(users).toEqual([
      'db/migrations/0019_profile_consents.ts',
      'modules/profile/profile.collection.ts',
      'modules/profile/profile.repository.ts',
    ]);
  });
});

/**
 * Сторож анкеты Verified (race-results-07): `rider_verified_profiles` пишет только `VerifiedProfileRepository`;
 * имя коллекции знают только описание коллекций профиля, репозиторий анкеты и миграция.
 */
describe('rider_verified_profiles — единственный писатель', () => {
  it('коллекцию анкет по имени знают только описание коллекций, репозиторий анкеты и миграция', () => {
    const users = sources(SRC)
      .filter((file) =>
        /['"`]rider_verified_profiles['"`]|PROFILE_COLLECTIONS\.verified/.test(
          readFileSync(file, 'utf8'),
        ),
      )
      .map((file) => relative(SRC, file))
      .sort();
    expect(users).toEqual([
      'db/migrations/0028_entry_tier.ts',
      'modules/profile/profile.collection.ts',
      'modules/profile/verified-profile.collection.ts',
      'modules/profile/verified-profile.repository.ts',
    ]);
  });
});
