import { DEFAULT_NOTIFICATION_SETTINGS, NOTIFICATION_KINDS } from '@pokatim/contracts';
import { describe, expect, it } from 'vitest';

import { EMAIL_KINDS, groupOf, NOTIFICATIONS_POLICY, quietUntil } from './notifications.policy';

/** Момент по настенному времени Минска (UTC+3, без перехода на летнее время). */
const minsk = (wall: string) => new Date(`${wall}:00+03:00`);
const quiet = (startHour: number, endHour: number, enabled = true) => ({
  enabled,
  startHour,
  endHour,
});

describe('groupOf: kind → группа настроек (N4)', () => {
  it('каждый kind — в своей группе', () => {
    const groups = Object.fromEntries(NOTIFICATION_KINDS.map((kind) => [kind, groupOf(kind)]));
    expect(groups).toEqual({
      result_counted: 'races',
      result_rejected: 'races',
      protocol_published: 'races',
      protocol_disqualified: 'races',
      protocol_restored: 'races',
      protocol_rechecked: 'races',
      dispute_filed: 'disputes',
      dispute_withdrawn: 'disputes',
      dispute_responded: 'disputes',
      dispute_decided: 'disputes',
      ride_cancelled: 'rides',
      ride_rescheduled: 'rides',
      ride_joined: 'rides',
      ride_report_resolved: 'rides',
    });
  });

  it('e-mail — только N2: «Райд отменён» и «Решение по спору»', () => {
    expect([...EMAIL_KINDS]).toEqual(['dispute_decided', 'ride_cancelled']);
  });
});

describe('quietUntil: тихие часы по Минску (N6)', () => {
  it('выключены — null в любое время', () => {
    expect(quietUntil(minsk('2026-10-22T23:30'), quiet(22, 8, false))).toBeNull();
  });

  it('через полночь 22–8: вечер — до 08:00 следующего дня, ночь — до 08:00 этого дня', () => {
    const settings = DEFAULT_NOTIFICATION_SETTINGS.quietHours;
    expect(quietUntil(minsk('2026-10-22T23:30'), settings)).toEqual(minsk('2026-10-23T08:00'));
    expect(quietUntil(minsk('2026-10-23T03:10'), settings)).toEqual(minsk('2026-10-23T08:00'));
  });

  it('границы часа: начало включительно, конец — уже не тихо', () => {
    const settings = quiet(22, 8);
    expect(quietUntil(minsk('2026-10-22T22:00'), settings)).toEqual(minsk('2026-10-23T08:00'));
    expect(quietUntil(minsk('2026-10-22T21:59'), settings)).toBeNull();
    expect(quietUntil(minsk('2026-10-23T07:59'), settings)).toEqual(minsk('2026-10-23T08:00'));
    expect(quietUntil(minsk('2026-10-23T08:00'), settings)).toBeNull();
  });

  it('внутри суток 13–15: до 15:00 этого дня; вне интервала — null', () => {
    const settings = quiet(13, 15);
    expect(quietUntil(minsk('2026-10-22T14:45'), settings)).toEqual(minsk('2026-10-22T15:00'));
    expect(quietUntil(minsk('2026-10-22T12:59'), settings)).toBeNull();
    expect(quietUntil(minsk('2026-10-22T15:00'), settings)).toBeNull();
    expect(quietUntil(minsk('2026-10-22T23:00'), settings)).toBeNull();
  });

  it('0–23: тихо почти весь день; 23–0: один час до полуночи', () => {
    expect(quietUntil(minsk('2026-10-22T00:00'), quiet(0, 23))).toEqual(minsk('2026-10-22T23:00'));
    expect(quietUntil(minsk('2026-10-22T23:20'), quiet(23, 0))).toEqual(minsk('2026-10-23T00:00'));
    expect(quietUntil(minsk('2026-10-23T00:00'), quiet(23, 0))).toBeNull();
  });

  it('конец месяца и года — следующий календарный день', () => {
    expect(quietUntil(minsk('2026-12-31T23:00'), quiet(22, 8))).toEqual(minsk('2027-01-01T08:00'));
  });
});

describe('NOTIFICATIONS_POLICY', () => {
  it('сроки и лимиты продукта', () => {
    expect(NOTIFICATIONS_POLICY).toMatchObject({
      ttlDays: 90,
      maxTokensPerUser: 10,
      settingsLimit: { limit: 30, windowSec: 3600 },
      pushTokenLimit: { limit: 30, windowSec: 3600 },
      readLimit: { limit: 120, windowSec: 60 },
    });
  });
});
