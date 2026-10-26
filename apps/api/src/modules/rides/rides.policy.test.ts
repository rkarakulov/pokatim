import { describe, expect, it } from 'vitest';

import {
  changesStart,
  moderationTransition,
  rideFull,
  ridePhase,
  RIDES_POLICY,
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
