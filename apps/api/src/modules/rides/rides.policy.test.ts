import { describe, expect, it } from 'vitest';

import { isReschedule, rideFull, ridePhase, rideViewer, validateStartsAt } from './rides.policy';

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
  const none = { canJoin: false, canLeave: false, canManage: false };

  it('будущий: организатор управляет, участник снимает отметку, чужой записывается, гость — тоже', () => {
    expect(rideViewer(ride(), organizer, NOW)).toEqual({
      role: 'organizer',
      ...none,
      canManage: true,
    });
    expect(rideViewer(ride(), participant, NOW)).toEqual({
      role: 'participant',
      ...none,
      canLeave: true,
    });
    expect(rideViewer(ride(), stranger, NOW)).toEqual({ role: 'none', ...none, canJoin: true });
    expect(rideViewer(ride(), null, NOW)).toEqual({ role: 'none', ...none, canJoin: true });
  });

  it('полный: записаться нельзя, участник по-прежнему снимает отметку', () => {
    const full = ride({ goingCount: 10 });
    expect(rideViewer(full, stranger, NOW)).toEqual({ role: 'none', ...none });
    expect(rideViewer(full, participant, NOW).canLeave).toBe(true);
  });

  it('прошедший и отменённый: прав нет ни у кого, роль сохраняется', () => {
    for (const closed of [ride({ startsAt: at(0) }), ride({ status: 'cancelled' })]) {
      expect(rideViewer(closed, organizer, NOW)).toEqual({ role: 'organizer', ...none });
      expect(rideViewer(closed, participant, NOW)).toEqual({ role: 'participant', ...none });
      expect(rideViewer(closed, stranger, NOW)).toEqual({ role: 'none', ...none });
    }
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

describe('isReschedule', () => {
  it('время, город или место изменены при других участниках', () => {
    const base = ride({ goingCount: 2 });
    expect(isReschedule(base, { startsAt: at(2 * DAY) })).toBe(true);
    expect(isReschedule(base, { cityCode: 'brest' })).toBe(true);
    expect(isReschedule(base, { place: 'Другое место' })).toBe(true);
  });

  it('то же значение, другие поля или только организатор — не перенос', () => {
    const base = ride({ goingCount: 2 });
    expect(isReschedule(base, { startsAt: at(DAY), place: 'Парк Победы' })).toBe(false);
    expect(isReschedule(base, {})).toBe(false);
    expect(isReschedule(ride({ goingCount: 1 }), { startsAt: at(2 * DAY) })).toBe(false);
  });
});
