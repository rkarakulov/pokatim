import { Logger } from '@nestjs/common';
import { VerifiedProfileView } from '@pokatim/contracts';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { createHarness, type Harness } from '../../../test/harness';
import { call } from '../../../test/identity';
import { corridorRace, enterRace, rider, seedVerifiedProfile } from '../../../test/results';
import { PROFILE_COLLECTIONS } from './profile.collection';
import { ProfileErasure } from './profile-erasure';
import type { RiderVerifiedProfileDoc } from './verified-profile.collection';

/**
 * Анкета зачёта Verified (race-results-07, AC10, AC11, AC14): своя анкета под `AuthGuard`, `no-store`; подсказка года
 * из регистрации; пол и год после первой Verified-заявки — 409; лимит частоты; значения анкеты не в логах; удаление
 * аккаунта стирает анкету.
 */
let h: Harness;
beforeAll(async () => {
  h = await createHarness({ TRUST_PROXY: '1' });
});
beforeEach(async () => {
  await h.reset();
});
afterEach(() => {
  vi.restoreAllMocks();
});
afterAll(async () => {
  await h.close();
});

const URL = '/v1/profile/verified';
const body = (overrides: Record<string, unknown> = {}) => ({
  gender: 'm',
  birthYear: 1977,
  weightKg: 87,
  heightCm: 193,
  ftpW: 311,
  consent: true,
  ...overrides,
});
const profiles = () => h.db.collection<RiderVerifiedProfileDoc>(PROFILE_COLLECTIONS.verified);
const code = (res: { body: unknown }) => (res.body as { code?: string }).code;

describe('GET/PUT /v1/profile/verified', () => {
  it('анкеты нет — profile: null и год из регистрации; PUT создаёт; GET — анкета без подсказки', async () => {
    const r = await rider(h);
    const empty = await call(h, 'GET', URL, undefined, r.auth);
    expect(empty.status).toBe(200);
    expect(empty.headers['cache-control']).toBe('no-store');
    // регистрация стенда — 1990-05-01
    expect(empty.body).toEqual({
      profile: null,
      demographicsLocked: false,
      suggestedBirthYear: 1990,
    });

    const created = await call(h, 'PUT', URL, body(), r.auth);
    expect(created.status).toBe(200);
    expect(created.headers['cache-control']).toBe('no-store');
    const view = VerifiedProfileView.parse(created.body);
    expect(view).toEqual({
      profile: {
        gender: 'm',
        birthYear: 1977,
        weightKg: 87,
        heightCm: 193,
        ftpW: 311,
        consentAt: h.clock.now().toISOString(),
        updatedAt: h.clock.now().toISOString(),
      },
      demographicsLocked: false,
      suggestedBirthYear: null,
    });
    expect(await profiles().findOne({ _id: r.userId })).toMatchObject({
      consentVersion: '2026-10-27',
      demographicsLockedAt: null,
      version: 0,
    });
    expect((await call(h, 'GET', URL, undefined, r.auth)).body).toEqual(view);

    const updated = await call(h, 'PUT', URL, body({ weightKg: 80, ftpW: null }), r.auth);
    expect(VerifiedProfileView.parse(updated.body).profile).toMatchObject({
      weightKg: 80,
      ftpW: null,
    });
    expect((await profiles().findOne({ _id: r.userId }))?.version).toBe(1);
  });

  it('без входа — 401; вне пределов и лишние ключи — 400', async () => {
    expect((await call(h, 'GET', URL)).status).toBe(401);
    expect((await call(h, 'PUT', URL, body())).status).toBe(401);
    const r = await rider(h);
    for (const bad of [
      body({ weightKg: 201 }),
      body({ heightCm: 119 }),
      body({ ftpW: 601 }),
      body({ birthYear: 1919 }),
      body({ consent: false }),
      { ...body(), demographicsLockedAt: null },
    ]) {
      expect((await call(h, 'PUT', URL, bad, r.auth)).status).toBe(400);
    }
    expect(await profiles().countDocuments()).toBe(0);
  });

  it('после первой Verified-заявки: пол и год — 409 VERIFIED_DEMOGRAPHICS_LOCKED, вес и рост — 200', async () => {
    const { raceId } = await corridorRace(h, {}, { scheme: null });
    const r = await rider(h);
    await call(h, 'PUT', URL, body(), r.auth);
    expect((await enterRace(h, r.auth, raceId, { tier: 'verified' })).status).toBe(201);
    const view = VerifiedProfileView.parse((await call(h, 'GET', URL, undefined, r.auth)).body);
    expect(view.demographicsLocked).toBe(true);
    for (const change of [{ gender: 'w' }, { birthYear: 1978 }]) {
      const refused = await call(h, 'PUT', URL, body(change), r.auth);
      expect([refused.status, code(refused)]).toEqual([409, 'VERIFIED_DEMOGRAPHICS_LOCKED']);
    }
    expect(await profiles().findOne({ _id: r.userId })).toMatchObject({
      gender: 'm',
      birthYear: 1977,
    });
    const ok = await call(h, 'PUT', URL, body({ weightKg: 70, heightCm: 175 }), r.auth);
    expect(VerifiedProfileView.parse(ok.body).profile).toMatchObject({
      weightKg: 70,
      heightCm: 175,
    });
  });

  it('лимит profile-verified-update — 30 в час, дальше 429', async () => {
    const r = await rider(h);
    for (let i = 0; i < 30; i += 1) {
      expect((await call(h, 'PUT', URL, body({ weightKg: 60 + i }), r.auth)).status).toBe(200);
    }
    const limited = await call(h, 'PUT', URL, body(), r.auth);
    expect([limited.status, code(limited)]).toEqual([429, 'RATE_LIMITED']);
  });

  it('AC14: значения анкеты не попадают в логи', async () => {
    const r = await rider(h);
    const spies = (['log', 'warn', 'error', 'debug', 'verbose'] as const).map((level) =>
      vi.spyOn(Logger.prototype, level),
    );
    await call(h, 'PUT', URL, body(), r.auth);
    await call(h, 'PUT', URL, body({ weightKg: 88 }), r.auth);
    await call(h, 'GET', URL, undefined, r.auth);
    // сообщения логгера сервиса анкеты (контекст экземпляра `Logger`), id — без цифр значений
    const messages = spies
      .flatMap((spy) =>
        spy.mock.calls.filter(
          (_, index) =>
            (spy.mock.contexts[index] as { context?: string } | undefined)?.context ===
            'VerifiedProfileService',
        ),
      )
      .flat()
      .map((value) => String(value).replace(/[0-9a-f]{8}-[0-9a-f-]{27}/g, '<id>'));
    expect(messages.some((message) => message.includes('verified profile saved'))).toBe(true);
    for (const value of ['1977', '87', '88', '193', '311', 'weight', 'height', 'ftp']) {
      expect(messages.filter((message) => message.includes(value))).toEqual([]);
    }
  });
});

describe('удаление аккаунта (AC11)', () => {
  it('ProfileErasure стирает анкету; повтор — идемпотентно', async () => {
    const r = await rider(h);
    await seedVerifiedProfile(h, r.userId);
    const erasure = h.worker.get(ProfileErasure, { strict: false });
    await erasure.erase(r.userId);
    expect(await profiles().countDocuments({ _id: r.userId })).toBe(0);
    await expect(erasure.erase(r.userId)).resolves.toBe(false);
  });
});
