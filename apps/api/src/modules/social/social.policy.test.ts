import { InviteCode } from '@pokatim/contracts';
import { describe, expect, it } from 'vitest';

import type { SocialRideFacts } from '../rides';
import type { ConnectionDoc } from './social.collection';
import {
  attendanceCheck,
  autoAttendanceCheck,
  connectionSources,
  generateInviteCode,
  rideAskRecipients,
  rideConnectionDiff,
  SOCIAL_POLICY,
} from './social.policy';

const START = new Date('2026-10-20T08:00:00.000Z');
const DAY = 86_400_000;
const at = (offsetMs: number) => new Date(START.getTime() + offsetMs);

const facts = (overrides: Partial<SocialRideFacts> = {}): SocialRideFacts => ({
  rideId: 'ride-1',
  phase: 'past',
  startsAt: START,
  organizerUserId: 'org',
  participantIds: ['org', 'p1'],
  preciseStart: null,
  ...overrides,
});

describe('SOCIAL_POLICY (K2, K11)', () => {
  it('лимит ручного «В свои» — 30 за 24 ч; окно явки — 7 дней; пороги автоявки', () => {
    expect(SOCIAL_POLICY.manualLimit).toEqual({ limit: 30, windowSec: 86_400 });
    expect(SOCIAL_POLICY.attendanceLimit).toEqual({ limit: 60, windowSec: 3600 });
    expect(SOCIAL_POLICY.attendanceWindowMs).toBe(7 * DAY);
    expect(SOCIAL_POLICY.autoAttendance).toEqual({
      beforeMs: 30 * 60_000,
      afterMs: 2 * 3_600_000,
      radiusM: 500,
    });
  });
});

describe('attendanceCheck — ручная явка (K2)', () => {
  it('границы окна: старт −1 мс — нет; старт и +7 дн — да; +7 дн +1 мс — нет', () => {
    // до старта фаза — upcoming (её считает rides)
    expect(attendanceCheck(facts({ phase: 'upcoming' }), 'p1', at(-1))).toBe('attendance_window');
    expect(attendanceCheck(facts(), 'p1', at(0))).toBeNull();
    expect(attendanceCheck(facts(), 'p1', at(7 * DAY))).toBeNull();
    expect(attendanceCheck(facts(), 'p1', at(7 * DAY + 1))).toBe('attendance_window');
  });

  it('роли: участник «Иду» и организатор — да; не участник — not_participant', () => {
    expect(attendanceCheck(facts(), 'org', at(DAY))).toBeNull();
    expect(attendanceCheck(facts(), 'p1', at(DAY))).toBeNull();
    expect(attendanceCheck(facts(), 'stranger', at(DAY))).toBe('not_participant');
  });

  it('фазы: отменённый и скрытый — ride_unavailable (RC-15)', () => {
    expect(attendanceCheck(facts({ phase: 'cancelled' }), 'p1', at(DAY))).toBe('ride_unavailable');
    expect(attendanceCheck(facts({ phase: 'hidden' }), 'p1', at(DAY))).toBe('ride_unavailable');
  });

  it('по треку окно не проверяется; роли и фаза — проверяются', () => {
    expect(attendanceCheck(facts(), 'p1', at(30 * DAY), 'track')).toBeNull();
    expect(attendanceCheck(facts({ phase: 'upcoming' }), 'p1', at(-1), 'track')).toBeNull();
    expect(attendanceCheck(facts(), 'stranger', at(DAY), 'track')).toBe('not_participant');
    expect(attendanceCheck(facts({ phase: 'hidden' }), 'p1', at(DAY), 'track')).toBe(
      'ride_unavailable',
    );
  });
});

describe('rideConnectionDiff', () => {
  const key = (pair: { ownerId: string; otherId: string }) => `${pair.ownerId}>${pair.otherId}`;

  it('n явившихся без пар → n(n−1) направленных пар', () => {
    const diff = rideConnectionDiff(['a', 'b', 'c'], []);
    expect(diff.add.map(key).sort()).toEqual(['a>b', 'a>c', 'b>a', 'b>c', 'c>a', 'c>b']);
    expect(diff.remove).toEqual([]);
  });

  it('снятие одного — его пары в обе стороны удаляются, остальные не трогаются', () => {
    const existing = rideConnectionDiff(['a', 'b', 'c'], []).add;
    const diff = rideConnectionDiff(['a', 'c'], existing);
    expect(diff.add).toEqual([]);
    expect(diff.remove.map(key).sort()).toEqual(['a>b', 'b>a', 'b>c', 'c>b']);
  });

  it('повтор с тем же набором — пусто; один явившийся — пар нет; дубли во входе — без дублей', () => {
    const existing = rideConnectionDiff(['a', 'b'], []).add;
    expect(rideConnectionDiff(['a', 'b'], existing)).toEqual({ add: [], remove: [] });
    expect(rideConnectionDiff(['a'], [])).toEqual({ add: [], remove: [] });
    expect(rideConnectionDiff(['a', 'a', 'b'], []).add.map(key).sort()).toEqual(['a>b', 'b>a']);
  });
});

describe('connectionSources', () => {
  const doc = (overrides: Partial<ConnectionDoc>): ConnectionDoc => ({
    _id: 'c',
    ownerId: 'a',
    otherId: 'b',
    rides: [],
    rideCount: 0,
    lastRideAt: null,
    inviteAt: null,
    manualAt: null,
    removedAt: null,
    createdAt: START,
    updatedAt: START,
    ...overrides,
  });

  it('источники из полей в порядке справочника; без источников — пусто', () => {
    expect(connectionSources(doc({}))).toEqual([]);
    expect(
      connectionSources(
        doc({
          rides: [{ rideId: 'r', at: START }],
          rideCount: 1,
          inviteAt: START,
          manualAt: START,
        }),
      ),
    ).toEqual(['ride', 'invite', 'manual']);
    expect(connectionSources(doc({ manualAt: START }))).toEqual(['manual']);
  });
});

describe('generateInviteCode (K9, P6)', () => {
  it('7 символов алфавита без похожих — проходит InviteCode', () => {
    for (let index = 0; index < 200; index += 1) {
      const code = generateInviteCode();
      expect(code).toMatch(/^[2-9A-HJKMNP-Z]{7}$/);
      expect(InviteCode.parse(code)).toBe(code);
    }
  });

  it('символ — по индексу случайного числа в алфавите', () => {
    expect(generateInviteCode(() => 0)).toBe('2222222');
    expect(generateInviteCode((max) => max - 1)).toBe('ZZZZZZZ');
  });
});

describe('autoAttendanceCheck — автоявка по заезду (K2, P5)', () => {
  const MINUTE = 60_000;
  const HOUR = 60 * MINUTE;
  const POINT: [number, number] = [27.5576, 53.9006];
  /** Точка на `meters` севернее `POINT` (метров в градусе широты сферы `haversineMeters` — 111 195). */
  const north = (meters: number): [number, number] => [POINT[0], POINT[1] + meters / 111_195];
  const precise = (overrides: Partial<SocialRideFacts> = {}) =>
    facts({ preciseStart: POINT, ...overrides });
  const start = (offsetMs = 0, point: [number, number] = POINT) => ({
    startedAt: at(offsetMs),
    startPoint: point,
  });
  const NOW = at(5 * HOUR);

  it('заезд в окне и радиусе участника — null; организатор тоже', () => {
    expect(autoAttendanceCheck(precise(), start(), 'p1', NOW)).toBeNull();
    expect(autoAttendanceCheck(precise(), start(), 'org', NOW)).toBeNull();
  });

  it('окно по времени: −30 мин и +2 ч включительно; −30 мин −1 с и +2 ч +1 с — out_of_window', () => {
    expect(autoAttendanceCheck(precise(), start(-30 * MINUTE), 'p1', NOW)).toBeNull();
    expect(autoAttendanceCheck(precise(), start(2 * HOUR), 'p1', NOW)).toBeNull();
    expect(autoAttendanceCheck(precise(), start(-30 * MINUTE - 1000), 'p1', NOW)).toBe(
      'out_of_window',
    );
    expect(autoAttendanceCheck(precise(), start(2 * HOUR + 1000), 'p1', NOW)).toBe('out_of_window');
  });

  it('радиус 500 м: ~499 м — да; ~501 м — too_far', () => {
    expect(autoAttendanceCheck(precise(), start(0, north(499)), 'p1', NOW)).toBeNull();
    expect(autoAttendanceCheck(precise(), start(0, north(501)), 'p1', NOW)).toBe('too_far');
  });

  it('обработка: старт +7 дн — да; +7 дн +1 мс — too_late', () => {
    expect(autoAttendanceCheck(precise(), start(), 'p1', at(7 * DAY))).toBeNull();
    expect(autoAttendanceCheck(precise(), start(), 'p1', at(7 * DAY + 1))).toBe('too_late');
  });

  it('райд без точного старта — no_precise_start', () => {
    expect(autoAttendanceCheck(facts(), start(), 'p1', NOW)).toBe('no_precise_start');
  });

  it('райд ещё не начался — attendance_window (RC-P5-4)', () => {
    expect(autoAttendanceCheck(precise({ phase: 'upcoming' }), start(), 'p1', at(-1))).toBe(
      'attendance_window',
    );
  });

  it('отменённый и скрытый — ride_unavailable; не участник — not_participant', () => {
    expect(autoAttendanceCheck(precise({ phase: 'cancelled' }), start(), 'p1', NOW)).toBe(
      'ride_unavailable',
    );
    expect(autoAttendanceCheck(precise({ phase: 'hidden' }), start(), 'p1', NOW)).toBe(
      'ride_unavailable',
    );
    expect(autoAttendanceCheck(precise(), start(), 'stranger', NOW)).toBe('not_participant');
  });

  it('порядок причин: участие раньше фазы, фаза раньше точки, срок раньше окна и радиуса', () => {
    expect(autoAttendanceCheck(precise({ phase: 'upcoming' }), start(), 'stranger', at(-1))).toBe(
      'not_participant',
    );
    expect(autoAttendanceCheck(facts({ phase: 'upcoming' }), start(), 'p1', at(-1))).toBe(
      'attendance_window',
    );
    expect(autoAttendanceCheck(precise(), start(3 * HOUR, north(900)), 'p1', at(8 * DAY))).toBe(
      'too_late',
    );
    expect(autoAttendanceCheck(precise(), start(3 * HOUR, north(900)), 'p1', NOW)).toBe(
      'out_of_window',
    );
  });

  it('политика: окно догона «Как прошёл райд?» — 24 ч, страница регламента — 500', () => {
    expect(SOCIAL_POLICY.askAfterMs).toBe(4 * HOUR);
    expect(SOCIAL_POLICY.askCatchUpMs).toBe(DAY);
    expect(SOCIAL_POLICY.askPageRows).toBe(500);
  });
});

describe('rideAskRecipients — адресаты «Как прошёл райд?» (K10, P5)', () => {
  const entry = (userId: string, via: 'manual' | 'track', declined = false) => ({
    userId,
    via,
    at: START,
    declinedAt: declined ? START : null,
  });

  it('без записи явки — да; явка (ручная и по треку) и «Меня не было» — нет; порядок участников', () => {
    expect(
      rideAskRecipients(
        ['org', 'p1', 'p2', 'p3', 'p4'],
        [entry('p3', 'track'), entry('p1', 'manual', true), entry('org', 'manual')],
      ),
    ).toEqual(['p2', 'p4']);
  });

  it('записей нет — все участники; явились все — пусто', () => {
    expect(rideAskRecipients(['org', 'p1'], [])).toEqual(['org', 'p1']);
    expect(rideAskRecipients(['org'], [entry('org', 'track')])).toEqual([]);
  });
});
