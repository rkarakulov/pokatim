/// <reference types="jest" />
import type { CalendarStartDetail } from '@pokatim/contracts';

import { isRegistrationUrl, registrationLink } from './registration';

const start = (overrides: Partial<CalendarStartDetail> = {}): CalendarStartDetail => ({
  id: '0190a6f4-0000-7000-8000-000000000002',
  title: 'Минская сотка',
  startsOn: '2027-06-14',
  endsOn: null,
  startTime: null,
  discipline: 'road',
  city: 'Минск',
  distancesKm: [100],
  registrationUrl: 'https://example.by/registration',
  phase: 'upcoming',
  place: null,
  description: null,
  ...overrides,
});

describe('registrationLink', () => {
  it('https и фаза не finished — ссылка', () => {
    expect(registrationLink(start())).toBe('https://example.by/registration');
    expect(registrationLink(start({ phase: 'ongoing' }))).toBe('https://example.by/registration');
    // 'unknown' фаза (новое значение у старой сборки) — кнопка остаётся
    expect(registrationLink(start({ phase: 'unknown' }))).toBe('https://example.by/registration');
  });

  it.each([
    'http://example.by/registration',
    'javascript:alert(1)',
    'data:text/html,<b>x</b>',
    'https://user:pass@example.by/',
    '',
    'example.by',
  ])('небезопасная или битая ссылка %p — нет', (registrationUrl) => {
    expect(registrationLink(start({ registrationUrl }))).toBeNull();
  });

  it('нет ссылки или старт прошёл — нет', () => {
    expect(registrationLink(start({ registrationUrl: null }))).toBeNull();
    expect(registrationLink(start({ phase: 'finished' }))).toBeNull();
  });
});

describe('isRegistrationUrl (герои и карточка — одно условие)', () => {
  it('только безопасная https-ссылка', () => {
    expect(isRegistrationUrl('https://example.by/registration')).toBe(true);
    for (const url of [
      null,
      '',
      'http://example.by/',
      'javascript:alert(1)',
      'https://u:p@h.by/',
    ]) {
      expect(isRegistrationUrl(url)).toBe(false);
    }
  });
});
