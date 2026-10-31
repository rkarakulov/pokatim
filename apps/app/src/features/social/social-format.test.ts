import { connectionRowText, togetherText } from './social-format';

const NOW = new Date('2026-10-31T10:00:00Z');

describe('«Свои»: тексты строк (K6, RC-P3-5)', () => {
  it('плюралы «1 раз / 2 раза / 5 раз», дата по Минску без года в текущем году', () => {
    // 21:30 UTC 9 октября — уже 10 октября в Минске
    const lastRideAt = '2026-10-09T21:30:00Z';
    expect(togetherText({ rideCount: 1, lastRideAt }, NOW)).toBe(
      'Вместе ехали 1 раз · последний — 10 октября',
    );
    expect(togetherText({ rideCount: 2, lastRideAt }, NOW)).toBe(
      'Вместе ехали 2 раза · последний — 10 октября',
    );
    expect(togetherText({ rideCount: 5, lastRideAt }, NOW)).toBe(
      'Вместе ехали 5 раз · последний — 10 октября',
    );
  });

  it('прошлый год — с годом; не ехали — строки нет', () => {
    expect(togetherText({ rideCount: 3, lastRideAt: '2025-06-01T08:00:00Z' }, NOW)).toBe(
      'Вместе ехали 3 раза · последний — 1 июня 2025',
    );
    expect(togetherText({ rideCount: 0, lastRideAt: null }, NOW)).toBeNull();
  });

  it('строка «Свои»: райды → manual → invite → без подписи', () => {
    const lastRideAt = '2026-10-10T07:00:00Z';
    expect(connectionRowText({ rideCount: 2, lastRideAt, sources: ['ride', 'manual'] }, NOW)).toBe(
      'Вместе 2 раза · последний — 10 октября',
    );
    expect(
      connectionRowText({ rideCount: 0, lastRideAt: null, sources: ['invite', 'manual'] }, NOW),
    ).toBe('Добавлены вами');
    expect(connectionRowText({ rideCount: 0, lastRideAt: null, sources: ['invite'] }, NOW)).toBe(
      'По приглашению',
    );
    expect(
      connectionRowText({ rideCount: 0, lastRideAt: null, sources: ['unknown'] }, NOW),
    ).toBeNull();
  });
});
