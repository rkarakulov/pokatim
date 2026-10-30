import { DEFAULT_NOTIFICATION_SETTINGS, NOTIFICATION_KINDS } from '@pokatim/contracts';
import { describe, expect, it } from 'vitest';

import {
  DEFAULT_DELIVERY_SETTINGS,
  EMAIL_KINDS,
  groupOf,
  initialDelivery,
  NOTIFICATIONS_POLICY,
  quietUntil,
} from './notifications.policy';

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
      route_published: 'routes',
      route_rejected: 'routes',
      event_reminder: 'events',
      profile_name_reset: 'rides',
      profile_avatar_reset: 'rides',
      profile_club_reset: 'rides',
    });
  });

  it('e-mail — N2: «Райд отменён», «Решение по спору» и напоминание о событии (PR D)', () => {
    expect([...EMAIL_KINDS]).toEqual(['dispute_decided', 'ride_cancelled', 'event_reminder']);
  });

  it('умолчания доставки — основные умолчания контракта + «Мероприятия» и «Маршруты» включены', () => {
    expect(DEFAULT_DELIVERY_SETTINGS.push.routes).toBe(true);
    expect(DEFAULT_DELIVERY_SETTINGS).toEqual({
      push: { ...DEFAULT_NOTIFICATION_SETTINGS.push, events: true, routes: true },
      email: { ...DEFAULT_NOTIFICATION_SETTINGS.email, events: true },
      quietHours: DEFAULT_NOTIFICATION_SETTINGS.quietHours,
    });
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

describe('initialDelivery: состояние доставки нового уведомления (intake)', () => {
  const day = minsk('2026-10-22T12:00');
  const night = minsk('2026-10-22T23:30');
  const settings = DEFAULT_DELIVERY_SETTINGS;
  const off = (
    patch: Partial<typeof settings.push>,
    email: Partial<typeof settings.email> = {},
  ) => ({
    ...settings,
    push: { ...settings.push, ...patch },
    email: { ...settings.email, ...email },
  });

  it('группа включена, push включён — pending сейчас; в тихие часы — до их конца', () => {
    expect(initialDelivery('result_counted', settings, day, true).push).toEqual({
      state: 'pending',
      notBefore: day,
      claimId: null,
      claimedUntil: null,
      sentAt: null,
      reason: null,
    });
    expect(initialDelivery('result_counted', settings, night, true).push).toMatchObject({
      state: 'pending',
      notBefore: minsk('2026-10-23T08:00'),
    });
  });

  it('группа выключена — skipped: disabled; PUSH_ENABLED=false — skipped: push_off', () => {
    expect(initialDelivery('ride_joined', off({ rides: false }), day, true).push).toMatchObject({
      state: 'skipped',
      reason: 'disabled',
      notBefore: day,
    });
    expect(initialDelivery('ride_joined', settings, day, false).push).toMatchObject({
      state: 'skipped',
      reason: 'push_off',
    });
  });

  it('письмо — только N2 по тумблеру группы; тихие часы письмо не задерживают', () => {
    const pending = { state: 'pending', claimedUntil: null, sentAt: null };
    expect(initialDelivery('ride_cancelled', settings, night, true).email).toEqual(pending);
    expect(initialDelivery('dispute_decided', settings, day, false).email).toEqual(pending);
    expect(
      initialDelivery('ride_cancelled', off({}, { rides: false }), day, true).email,
    ).toMatchObject({ state: 'skipped' });
    expect(initialDelivery('dispute_decided', off({ disputes: false }), day, true).email).toEqual(
      pending,
    );
    expect(initialDelivery('ride_rescheduled', settings, day, true).email).toBeNull();
    expect(initialDelivery('result_counted', settings, day, true).email).toBeNull();
  });

  it('напоминание о событии: push по push.events, письмо по email.events (RC-D7)', () => {
    const pending = { state: 'pending', claimedUntil: null, sentAt: null };
    expect(initialDelivery('event_reminder', settings, day, true)).toMatchObject({
      push: { state: 'pending' },
      email: pending,
    });
    expect(
      initialDelivery('event_reminder', off({ events: false }, { events: false }), day, true),
    ).toMatchObject({
      push: { state: 'skipped', reason: 'disabled' },
      email: { state: 'skipped' },
    });
    // другие группы тумблеры «Мероприятий» не трогают
    expect(
      initialDelivery('ride_cancelled', off({ events: false }, { events: false }), day, true),
    ).toMatchObject({ push: { state: 'pending' }, email: pending });
  });

  it('решение по маршруту: push по push.routes (rides не влияет), письма нет', () => {
    expect(initialDelivery('route_published', off({ rides: false }), day, true)).toMatchObject({
      push: { state: 'pending' },
      email: null,
    });
    expect(initialDelivery('route_rejected', off({ routes: false }), day, true)).toMatchObject({
      push: { state: 'skipped', reason: 'disabled' },
      email: null,
    });
    expect(initialDelivery('ride_cancelled', off({ routes: false }), day, true).push.state).toBe(
      'pending',
    );
  });
});
