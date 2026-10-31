import { describe, expect, it } from 'vitest';

import type { SocialRideFacts } from '../rides';
import type { ConnectionDoc } from './social.collection';
import {
  attendanceCheck,
  connectionSources,
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
