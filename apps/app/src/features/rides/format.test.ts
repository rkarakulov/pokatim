/// <reference types="jest" />
import type { RideCard } from '@pokatim/contracts';

import {
  cityPlace,
  goingCaption,
  organizerLine,
  paceText,
  rideHeroDate,
  rideHeroMeta,
  rideRowMeta,
  rideRowTime,
  rideShareDescription,
  rideShareText,
} from './format';

/** «Сейчас»: 1 октября 2026, 15:00 по Минску. */
const NOW = new Date('2026-10-01T12:00:00Z');

const ride: RideCard = {
  id: '0190a6f4-0000-7000-8000-000000000001',
  title: 'Кофе-райд',
  organizerName: null,
  startsAt: '2026-10-04T07:00:00Z',
  city: 'minsk',
  place: 'Парк Победы',
  distanceKm: 42,
  paceMinKmh: 22,
  paceMaxKmh: 24,
  limit: 12,
  goingCount: 5,
  full: false,
  phase: 'upcoming',
  cancelReason: null,
  rescheduledAt: null,
  route: null,
  start: null,
  viewer: {
    role: 'none',
    canJoin: true,
    canLeave: false,
    canManage: false,
    reported: false,
    canReport: false,
  },
};

describe('подписи кофе-райда', () => {
  it('темп: диапазон через тире без пробелов, равные — одно число', () => {
    expect(paceText(22, 24)).toBe('22–24 км/ч');
    expect(paceText(25, 25)).toBe('25 км/ч');
  });

  it('мета героя и строки; время строки с городом', () => {
    expect(rideHeroMeta(ride)).toBe('42 км · темп 22–24 км/ч · Минск, Парк Победы');
    expect(rideRowMeta(ride)).toBe('42 км · темп 22–24 км/ч · старт: Парк Победы');
    expect(rideRowTime(ride, NOW)).toBe('10:00 · Минск');
  });

  it("незнакомый город ('unknown') — без подписи города", () => {
    expect(cityPlace({ city: 'unknown', place: 'Парк' })).toBe('Парк');
    expect(rideRowTime({ ...ride, city: 'unknown' }, NOW)).toBe('10:00');
  });

  it('дата героя: краткий день недели, год — только не текущий', () => {
    expect(rideHeroDate('2026-10-03T06:00:00Z', NOW)).toBe('Сб 3 октября, 9:00');
    expect(rideHeroDate('2027-01-02T06:00:00Z', NOW)).toBe('Сб 2 января 2027, 9:00');
  });

  it('стопка: плюралы, без лимита, прошедший, «вы» и «вы в списке»', () => {
    expect(goingCaption({ goingCount: 1, limit: 12, phase: 'upcoming' })).toBe('идёт 1 из 12');
    expect(goingCaption({ goingCount: 5, limit: 12, phase: 'upcoming' })).toBe('идут 5 из 12');
    expect(goingCaption({ goingCount: 21, limit: 30, phase: 'upcoming' })).toBe('идёт 21 из 30');
    expect(goingCaption({ goingCount: 7, limit: null, phase: 'upcoming' })).toBe('идут 7');
    expect(goingCaption({ goingCount: 9, limit: 12, phase: 'past' })).toBe('ехали 9');
    expect(
      goingCaption({ goingCount: 1, limit: 12, phase: 'upcoming' }, { role: 'organizer' }),
    ).toBe('идёт 1 из 12 · вы');
    expect(
      goingCaption({ goingCount: 5, limit: 12, phase: 'upcoming' }, { role: 'participant' }),
    ).toBe('идут 5 из 12 · вы в списке');
    expect(goingCaption({ goingCount: 9, limit: 12, phase: 'past' }, { role: 'participant' })).toBe(
      'ехали 9 · вы в списке',
    );
    expect(goingCaption({ goingCount: 5, limit: 12, phase: 'upcoming' }, { role: 'unknown' })).toBe(
      'идут 5 из 12',
    );
  });

  it('подпись организатора: введённая; без имени — строки нет (B9 смоука dev)', () => {
    expect(organizerLine('Катя Л.')).toBe('Организатор: Катя Л.');
    expect(organizerLine(null)).toBeNull();
  });

  it('шаринг и OG — с годом, без описания и организатора', () => {
    expect(rideShareText({ ...ride, title: 'Райд' })).toBe(
      'Райд — Воскресенье, 4 октября 2026, 10:00, Минск',
    );
    expect(rideShareDescription({ ...ride, organizerName: 'Катя' } as RideCard)).toBe(
      'Воскресенье, 4 октября 2026, 10:00 · Минск · 42 км · темп 22–24 км/ч',
    );
  });
});
