import { describe, expect, it } from 'vitest';

import { MIN_AGE_YEARS, minskToday } from '../auth/registration.schema.ts';
import {
  PanelVerifiedDemographics,
  UpdateVerifiedDemographicsRequest,
  VerifiedDemographicsResult,
} from './profile-admin.schema.ts';
import {
  UpdateVerifiedProfileRequest,
  VERIFIED_LIMITS,
  VERIFIED_PROFILE_CONSENT_VERSION,
  VerifiedProfileView,
} from './verified-profile.schema.ts';

const AT = '2026-10-27T10:00:00.000Z';
const body = {
  gender: 'm',
  birthYear: 1985,
  weightKg: 72,
  heightCm: 180,
  ftpW: 250,
  consent: true,
};
const codesOf = (value: unknown) => {
  const result = UpdateVerifiedProfileRequest.safeParse(value);
  return result.success ? [] : result.error.issues.map((issue) => issue.message);
};
const ok = (patch: object) => UpdateVerifiedProfileRequest.safeParse({ ...body, ...patch }).success;

describe('анкета Verified (race-results-07)', () => {
  it('версия согласия и пределы', () => {
    expect(VERIFIED_PROFILE_CONSENT_VERSION).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(VERIFIED_LIMITS).toEqual({
      weightKg: [30, 200],
      heightCm: [120, 220],
      ftpW: [50, 600],
      birthYearMin: 1920,
    });
  });

  it('валидная анкета; FTP — необязательный (null)', () => {
    expect(UpdateVerifiedProfileRequest.parse(body)).toEqual(body);
    expect(ok({ ftpW: null })).toBe(true);
  });

  it('пределы веса, роста, FTP — целые, границы включительно', () => {
    expect([
      ok({ weightKg: 29 }),
      ok({ weightKg: 30 }),
      ok({ weightKg: 200 }),
      ok({ weightKg: 201 }),
    ]).toEqual([false, true, true, false]);
    expect([
      ok({ heightCm: 119 }),
      ok({ heightCm: 120 }),
      ok({ heightCm: 220 }),
      ok({ heightCm: 221 }),
    ]).toEqual([false, true, true, false]);
    expect([ok({ ftpW: 49 }), ok({ ftpW: 50 }), ok({ ftpW: 600 }), ok({ ftpW: 601 })]).toEqual([
      false,
      true,
      true,
      false,
    ]);
    expect(ok({ weightKg: 72.5 })).toBe(false);
  });

  it('год рождения: от 1920 до «текущий − 18»', () => {
    const year = Number(minskToday().slice(0, 4));
    expect(ok({ birthYear: 1919 })).toBe(false);
    expect(ok({ birthYear: 1920 })).toBe(true);
    expect(ok({ birthYear: year - MIN_AGE_YEARS })).toBe(true);
    expect(codesOf({ ...body, birthYear: year - 17 })).toEqual(['AGE_BELOW_18']);
  });

  it('пол из справочника, согласие обязательно, лишние ключи — ошибка', () => {
    expect(ok({ gender: 'x' })).toBe(false);
    expect(codesOf({ ...body, consent: false })).toEqual(['CONSENT_REQUIRED']);
    expect(ok({ consentVersion: '1' })).toBe(false);
    expect(ok({ demographicsLockedAt: AT })).toBe(false);
  });

  it('ответ: анкеты нет — подсказка года; незнакомый пол — unknown', () => {
    expect(
      VerifiedProfileView.parse({
        profile: null,
        demographicsLocked: false,
        suggestedBirthYear: 1990,
      }),
    ).toEqual({ profile: null, demographicsLocked: false, suggestedBirthYear: 1990 });
    const view = VerifiedProfileView.parse({
      profile: {
        gender: 'x',
        birthYear: 1985,
        weightKg: 72,
        heightCm: 180,
        ftpW: null,
        consentAt: AT,
        updatedAt: AT,
      },
      demographicsLocked: true,
      suggestedBirthYear: null,
    });
    expect(view.profile?.gender).toBe('unknown');
  });
});

describe('панель: пол и год анкеты (race-results-07)', () => {
  it('правка: хотя бы одно поле и причина; лишние ключи — ошибка', () => {
    expect(
      UpdateVerifiedDemographicsRequest.parse({ gender: 'w', reason: 'Ошибка ввода' }),
    ).toEqual({
      gender: 'w',
      reason: 'Ошибка ввода',
    });
    const empty = UpdateVerifiedDemographicsRequest.safeParse({ reason: 'Ошибка ввода' });
    expect(empty.success).toBe(false);
    expect(empty.error?.issues.map((issue) => issue.message)).toEqual(['REQUIRED']);
    expect(UpdateVerifiedDemographicsRequest.safeParse({ gender: 'w' }).success).toBe(false);
    expect(
      UpdateVerifiedDemographicsRequest.safeParse({ gender: 'w', reason: 'Ошибка', weightKg: 70 })
        .success,
    ).toBe(false);
    expect(
      UpdateVerifiedDemographicsRequest.safeParse({ birthYear: 1919, reason: 'Ошибка' }).success,
    ).toBe(false);
  });

  it('ответы — строгие, без веса/роста/FTP', () => {
    const view = { gender: 'm', birthYear: 1985, demographicsLocked: true };
    expect(PanelVerifiedDemographics.parse(view)).toEqual(view);
    expect(PanelVerifiedDemographics.safeParse({ ...view, gender: 'x' }).success).toBe(false);
    expect(VerifiedDemographicsResult.parse({ ...view, changed: false }).changed).toBe(false);
  });
});
