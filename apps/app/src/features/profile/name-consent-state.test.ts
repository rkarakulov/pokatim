import type { ProfileView } from '@pokatim/contracts';

import {
  NAME_CONSENT_SNOOZE_MS,
  nameConsentVisible,
  parseNameConsentSnooze,
} from './name-consent-state';

const NOW = Date.parse('2026-10-31T10:00:00Z');
const profile = (overrides: Partial<ProfileView> = {}): ProfileView => ({
  rideReasons: [],
  publicName: null,
  showNameInResults: false,
  showRouteRides: false,
  club: null,
  avatar: null,
  publicId: null,
  themeId: 'classic',
  avatarUploadBlockedUntil: null,
  ...overrides,
});

describe('показ шита согласия (name-consent-prompt N2, N3)', () => {
  it('нет имени или согласия — показать; имя и согласие — нет', () => {
    expect(nameConsentVisible({ profile: profile(), snoozedAt: null, now: NOW })).toBe(true);
    const nameOnly = profile({ publicName: 'Анна К.' });
    expect(nameConsentVisible({ profile: nameOnly, snoozedAt: null, now: NOW })).toBe(true);
    const consentOnly = profile({ showNameInResults: true });
    expect(nameConsentVisible({ profile: consentOnly, snoozedAt: null, now: NOW })).toBe(true);
    const shown = profile({ publicName: 'Анна К.', showNameInResults: true });
    expect(nameConsentVisible({ profile: shown, snoozedAt: null, now: NOW })).toBe(false);
  });

  it('пауза 90 дней: внутри — нет, по истечении — снова', () => {
    const inside = NOW - NAME_CONSENT_SNOOZE_MS + 1;
    expect(nameConsentVisible({ profile: profile(), snoozedAt: inside, now: NOW })).toBe(false);
    const expired = NOW - NAME_CONSENT_SNOOZE_MS;
    expect(nameConsentVisible({ profile: profile(), snoozedAt: expired, now: NOW })).toBe(true);
    expect(NAME_CONSENT_SNOOZE_MS).toBe(90 * 24 * 60 * 60 * 1000);
  });

  it('профиль или пауза неизвестны — нет (без мигания и без шита при ошибке профиля)', () => {
    expect(nameConsentVisible({ profile: undefined, snoozedAt: null, now: NOW })).toBe(false);
    expect(nameConsentVisible({ profile: profile(), snoozedAt: undefined, now: NOW })).toBe(false);
  });

  it('значение хранилища: время или ничего', () => {
    expect(parseNameConsentSnooze({ snoozedAt: 5 })).toBe(5);
    expect(parseNameConsentSnooze({ snoozedAt: 'x' })).toBeUndefined();
    expect(parseNameConsentSnooze(null)).toBeUndefined();
  });
});
