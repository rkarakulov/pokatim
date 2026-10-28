import { CITY_CENTERS } from '@pokatim/contracts';
import { describe, expect, it } from 'vitest';

import type { RideRouteRef } from '../routes';
import {
  changesStart,
  citiesNear,
  distanceKm,
  moderationTransition,
  rideFull,
  ridePhase,
  RIDES_POLICY,
  rideStartOf,
  ridePointNow,
  rideViewer,
  validateStartsAt,
  visibleTo,
} from './rides.policy';

const NOW = new Date('2026-10-22T09:00:00.000Z');
const MINUTE = 60_000;
const DAY = 86_400_000;
const at = (offsetMs: number) => new Date(NOW.getTime() + offsetMs);

const ride = (overrides: Record<string, unknown> = {}) => ({
  status: 'published' as const,
  startsAt: at(DAY),
  organizerUserId: 'org',
  goingCount: 3,
  limit: 10 as number | null,
  cityCode: 'minsk' as const,
  place: 'Парк Победы',
  ...overrides,
});

describe('ridePhase', () => {
  it('граница старта: за 1 мс — upcoming, в момент старта и после — past', () => {
    expect(ridePhase(ride({ startsAt: at(1) }), NOW)).toBe('upcoming');
    expect(ridePhase(ride({ startsAt: at(0) }), NOW)).toBe('past');
    expect(ridePhase(ride({ startsAt: at(-1) }), NOW)).toBe('past');
  });

  it('отменённый — cancelled и в будущем, и в прошлом', () => {
    expect(ridePhase(ride({ status: 'cancelled' }), NOW)).toBe('cancelled');
    expect(ridePhase(ride({ status: 'cancelled', startsAt: at(-DAY) }), NOW)).toBe('cancelled');
  });

  it('скрытый — hidden приоритетнее cancelled и past', () => {
    expect(ridePhase(ride({ status: 'hidden' }), NOW)).toBe('hidden');
    expect(ridePhase(ride({ status: 'hidden', startsAt: at(-DAY) }), NOW)).toBe('hidden');
  });
});

describe('rideFull', () => {
  it('по лимиту и по потолку 100 без лимита', () => {
    expect(rideFull({ goingCount: 9, limit: 10 })).toBe(false);
    expect(rideFull({ goingCount: 10, limit: 10 })).toBe(true);
    expect(rideFull({ goingCount: 99, limit: null })).toBe(false);
    expect(rideFull({ goingCount: 100, limit: null })).toBe(true);
  });
});

describe('rideViewer: роли × фазы × полный', () => {
  const organizer = { userId: 'org', participant: true };
  const participant = { userId: 'p', participant: true };
  const stranger = { userId: 's', participant: false };
  const none = { canJoin: false, canLeave: false, canManage: false, reported: false };

  it('будущий: организатор управляет, участник снимает отметку, чужой записывается, гость — тоже', () => {
    expect(rideViewer(ride(), organizer, NOW)).toEqual({
      role: 'organizer',
      ...none,
      canManage: true,
      canReport: false,
    });
    expect(rideViewer(ride(), participant, NOW)).toEqual({
      role: 'participant',
      ...none,
      canLeave: true,
      canReport: true,
    });
    expect(rideViewer(ride(), stranger, NOW)).toEqual({
      role: 'none',
      ...none,
      canJoin: true,
      canReport: true,
    });
    // гость не жалуется (кнопка — только вошедшим)
    expect(rideViewer(ride(), null, NOW)).toEqual({
      role: 'none',
      ...none,
      canJoin: true,
      canReport: false,
    });
  });

  it('полный: записаться нельзя, участник по-прежнему снимает отметку', () => {
    const full = ride({ goingCount: 10 });
    expect(rideViewer(full, stranger, NOW)).toEqual({ role: 'none', ...none, canReport: true });
    expect(rideViewer(full, participant, NOW).canLeave).toBe(true);
  });

  it('прошедший и отменённый: прав нет, роль сохраняется; пожаловаться можно (не организатору)', () => {
    for (const closed of [ride({ startsAt: at(0) }), ride({ status: 'cancelled' })]) {
      expect(rideViewer(closed, organizer, NOW)).toEqual({
        role: 'organizer',
        ...none,
        canReport: false,
      });
      expect(rideViewer(closed, participant, NOW)).toEqual({
        role: 'participant',
        ...none,
        canReport: true,
      });
      expect(rideViewer(closed, stranger, NOW)).toEqual({ role: 'none', ...none, canReport: true });
    }
  });

  it('уже пожаловался: reported, кнопки нет', () => {
    expect(rideViewer(ride(), stranger, NOW, true)).toEqual({
      role: 'none',
      ...none,
      canJoin: true,
      reported: true,
      canReport: false,
    });
  });

  it('скрытый: всё false (организатор видит роль), жалоба невозможна', () => {
    const hidden = ride({ status: 'hidden' });
    expect(rideViewer(hidden, organizer, NOW)).toEqual({
      role: 'organizer',
      ...none,
      canReport: false,
    });
    expect(rideViewer(hidden, stranger, NOW)).toEqual({ role: 'none', ...none, canReport: false });
  });
});

describe('visibleTo', () => {
  it('скрытый видит только организатор; остальные статусы — все', () => {
    expect(visibleTo(ride({ status: 'hidden' }), 'org')).toBe(true);
    expect(visibleTo(ride({ status: 'hidden' }), 's')).toBe(false);
    expect(visibleTo(ride({ status: 'hidden' }), null)).toBe(false);
    expect(visibleTo(ride({ status: 'cancelled' }), 's')).toBe(true);
    expect(visibleTo(ride(), null)).toBe(true);
  });
});

describe('moderationTransition', () => {
  const state = (status: 'published' | 'cancelled' | 'hidden', openReportCount = 0) => ({
    status,
    openReportCount,
  });

  it('скрыть — из published и cancelled (с жалобами и без), не из hidden', () => {
    expect(moderationTransition(state('published'), 'hide')).toBe('ok');
    expect(moderationTransition(state('cancelled', 2), 'hide')).toBe('ok');
    expect(moderationTransition(state('hidden'), 'hide')).toBe('RIDE_INVALID_STATE');
  });

  it('вернуть — только скрытый', () => {
    expect(moderationTransition(state('hidden'), 'restore')).toBe('ok');
    expect(moderationTransition(state('published', 1), 'restore')).toBe('RIDE_INVALID_STATE');
    expect(moderationTransition(state('cancelled'), 'restore')).toBe('RIDE_INVALID_STATE');
  });

  it('отклонить — только при открытых жалобах и не скрытый', () => {
    expect(moderationTransition(state('published', 1), 'dismiss')).toBe('ok');
    expect(moderationTransition(state('cancelled', 3), 'dismiss')).toBe('ok');
    expect(moderationTransition(state('published'), 'dismiss')).toBe('RIDE_INVALID_STATE');
    expect(moderationTransition(state('hidden', 1), 'dismiss')).toBe('RIDE_INVALID_STATE');
  });

  it('лимит жалоб — 20 в сутки', () => {
    expect(RIDES_POLICY.reportLimit).toEqual({ limit: 20, windowSec: 86_400 });
  });
});

describe('validateStartsAt', () => {
  it('не раньше +30 мин и не дальше +60 дней (границы включительно)', () => {
    expect(validateStartsAt(at(30 * MINUTE - 1), NOW)).toBe('RIDE_START_IN_PAST');
    expect(validateStartsAt(at(-DAY), NOW)).toBe('RIDE_START_IN_PAST');
    expect(validateStartsAt(at(30 * MINUTE), NOW)).toBeNull();
    expect(validateStartsAt(at(60 * DAY), NOW)).toBeNull();
    expect(validateStartsAt(at(60 * DAY + 1), NOW)).toBe('RIDE_START_TOO_FAR');
  });
});

describe('changesStart', () => {
  it('время, город или место изменены', () => {
    const base = ride();
    expect(changesStart(base, { startsAt: at(2 * DAY) })).toBe(true);
    expect(changesStart(base, { cityCode: 'brest' })).toBe(true);
    expect(changesStart(base, { place: 'Другое место' })).toBe(true);
  });

  it('то же значение или другие поля — не перенос (счётчик участников проверяет запись)', () => {
    const base = ride();
    expect(changesStart(base, { startsAt: at(DAY), place: 'Парк Победы' })).toBe(false);
    expect(changesStart(base, {})).toBe(false);
  });
});

const point = (lon: number, lat: number) => ({
  type: 'Point' as const,
  coordinates: [lon, lat] as [number, number],
});

describe('changesStart: точка старта (05c, RC-4)', () => {
  const precise = ride({ geo: point(27.6, 53.95), startPrecise: true });

  it('точная → другая точная — перенос; та же точка — нет', () => {
    expect(changesStart(precise, { geo: point(27.7, 53.95), startPrecise: true })).toBe(true);
    expect(changesStart(precise, { geo: point(27.6, 53.95), startPrecise: true })).toBe(false);
    // правка пишет только изменённое: флаг тот же — только geo
    expect(changesStart(precise, { geo: point(27.7, 53.95) })).toBe(true);
  });

  it('без точки → точная (маршрут прикреплён) и точная → центр города (маршрут снят) — не перенос', () => {
    const center = ride({ geo: point(...CITY_CENTERS.minsk), startPrecise: false });
    expect(changesStart(center, { geo: point(27.7, 53.95), startPrecise: true })).toBe(false);
    expect(changesStart(precise, { geo: point(...CITY_CENTERS.minsk), startPrecise: false })).toBe(
      false,
    );
  });

  it('документ до 0030 (без geo/startPrecise) — прежние правила', () => {
    expect(changesStart(ride(), { geo: point(27.7, 53.95), startPrecise: true })).toBe(false);
    expect(changesStart(ride(), { place: 'Другое место' })).toBe(true);
  });
});

describe('rideStartOf (05c)', () => {
  const route = (access: RideRouteRef['access']): RideRouteRef => ({
    id: 'r1',
    title: 'Кольцо',
    distanceM: 42_000,
    elevationGainM: 300,
    start: [27.61, 53.95],
    access,
  });

  it('публичный маршрут — его старт, точная; свой непубличный и без маршрута — центр города', () => {
    expect(rideStartOf(route('public'), 'brest')).toEqual({
      geo: point(27.61, 53.95),
      startPrecise: true,
    });
    expect(rideStartOf(route('private'), 'brest')).toEqual({
      geo: point(...CITY_CENTERS.brest),
      startPrecise: false,
    });
    expect(rideStartOf(null, 'minsk')).toEqual({
      geo: point(...CITY_CENTERS.minsk),
      startPrecise: false,
    });
  });

  it('точка — копия: правка результата не меняет справочник центров', () => {
    const start = rideStartOf(null, 'gomel');
    start.geo.coordinates[0] = 0;
    expect(CITY_CENTERS.gomel[0]).not.toBe(0);
  });
});

describe('точка «Рядом» на чтении (05c, фиксы ревью RC-1)', () => {
  const ref = (access: RideRouteRef['access']): RideRouteRef => ({
    id: 'r1',
    title: 'Кольцо',
    distanceM: 42_000,
    elevationGainM: 300,
    start: [27.61, 53.95],
    access,
  });
  const doc = (startPrecise: boolean, routeId: string | null = 'r1') => ({
    cityCode: 'borisov' as const,
    routeId,
    geo: point(27.62, 53.96),
    startPrecise,
  });

  it('distanceKm: Минск — Борисов ≈ 72 км, точка до себя — 0', () => {
    const km = distanceKm(CITY_CENTERS.minsk, CITY_CENTERS.borisov);
    expect(km).toBeGreaterThan(65);
    expect(km).toBeLessThan(80);
    expect(distanceKm(CITY_CENTERS.minsk, CITY_CENTERS.minsk)).toBe(0);
  });

  it('citiesNear: города, чей центр в радиусе', () => {
    expect(citiesNear(CITY_CENTERS.minsk, 25)).toEqual(['minsk']);
    expect(citiesNear(CITY_CENTERS.minsk, 100)).toEqual(
      expect.arrayContaining(['minsk', 'borisov']),
    );
    expect(citiesNear([0, 0], 25)).toEqual([]);
  });

  it('точная — только пока маршрут в каталоге; иначе центр города', () => {
    expect(ridePointNow(doc(true), ref('public'))).toEqual({
      coordinates: [27.62, 53.96],
      precise: true,
    });
    const center = { coordinates: CITY_CENTERS.borisov, precise: false };
    expect(ridePointNow(doc(true), ref('private'))).toEqual(center);
    expect(ridePointNow(doc(true), undefined)).toEqual(center);
    expect(ridePointNow(doc(false), ref('public'))).toEqual(center);
    expect(ridePointNow(doc(true, null), ref('public'))).toEqual(center);
    expect(ridePointNow({ cityCode: 'borisov', routeId: 'r1' }, ref('public'))).toEqual(center);
  });
});

describe('RIDES_POLICY.nearLimit (05c)', () => {
  it('60 запросов «Рядом» в минуту', () => {
    expect(RIDES_POLICY.nearLimit).toEqual({ limit: 60, windowSec: 60 });
  });
});
