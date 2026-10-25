import { describe, expect, it } from 'vitest';

import { importDecision, isAllowedReturnUrl, pullWindow } from './devices.policy';
import type { AggregatorWorkout } from './wearables-aggregator';

const NOW = new Date('2026-10-25T12:00:00Z');
const DAY = 86_400_000;
const at = (offsetMs: number) => new Date(NOW.getTime() + offsetMs);

const workout = (overrides: Partial<AggregatorWorkout> = {}): AggregatorWorkout => ({
  id: '0190e6a2-0000-7000-8000-000000000001',
  provider: 'garmin',
  type: 'cycling',
  startedAt: at(-3 * 3_600_000),
  endedAt: at(-2 * 3_600_000),
  durationSec: 3600,
  hasHeartRate: false,
  hasPower: false,
  ...overrides,
});

describe('pullWindow', () => {
  it('до первой синхронизации — вся история', () => {
    expect(pullWindow({ lastSyncedAt: null, catchUpUntil: null }, NOW, 30)).toEqual({
      from: at(-30 * DAY),
      to: NOW,
    });
  });

  it('первые 48 ч после подключения (catch-up) — вся история, даже после синхронизации', () => {
    expect(pullWindow({ lastSyncedAt: at(-60_000), catchUpUntil: at(1) }, NOW, 30).from).toEqual(
      at(-30 * DAY),
    );
  });

  it('после catch-up — от lastSyncedAt минус сутки, но не раньше истории', () => {
    expect(pullWindow({ lastSyncedAt: at(-3_600_000), catchUpUntil: NOW }, NOW, 30).from).toEqual(
      at(-3_600_000 - DAY),
    );
    expect(pullWindow({ lastSyncedAt: at(-40 * DAY), catchUpUntil: null }, NOW, 30).from).toEqual(
      at(-30 * DAY),
    );
  });
});

describe('importDecision', () => {
  it.each(['cycling', 'mountain_biking', 'indoor_cycling', 'cyclocross', 'e_biking', 'Cycling'])(
    'велотип %s — импорт',
    (type) => {
      expect(importDecision(workout({ type }), 'garmin')).toEqual({
        kind: 'import',
        end: at(-2 * 3_600_000),
      });
    },
  );

  it.each(['running', 'walking', 'motorcycling', 'unknown', ''])(
    'не велотип %s — без записи',
    (type) => {
      expect(importDecision(workout({ type }), 'garmin')).toEqual({ kind: 'ignore' });
    },
  );

  it('провайдер тренировки ≠ провайдер подключения (или неизвестен) — без записи', () => {
    expect(importDecision(workout({ provider: 'wahoo' }), 'garmin')).toEqual({ kind: 'ignore' });
    expect(importDecision(workout({ provider: null }), 'garmin')).toEqual({ kind: 'ignore' });
  });

  it('конец — из end_time, иначе старт + длительность; нет обоих — skipped', () => {
    expect(importDecision(workout({ endedAt: null, durationSec: 600 }), 'garmin')).toEqual({
      kind: 'import',
      end: at(-3 * 3_600_000 + 600_000),
    });
    expect(importDecision(workout({ endedAt: null, durationSec: null }), 'garmin')).toEqual({
      kind: 'skip',
      reason: 'no_track',
    });
  });

  it('длительность > 48 ч — skipped too_long, ровно 48 ч — импорт', () => {
    const start = at(-49 * 3_600_000);
    expect(
      importDecision(workout({ startedAt: start, endedAt: at(-3_600_000 + 1) }), 'garmin'),
    ).toEqual({
      kind: 'skip',
      reason: 'too_long',
    });
    expect(
      importDecision(workout({ startedAt: start, endedAt: at(-3_600_000) }), 'garmin').kind,
    ).toBe('import');
  });
});

describe('isAllowedReturnUrl', () => {
  const allow = ['https://app.test/devices/return', 'pokatim://devices/return', 'exp://'];

  it('точное совпадение и продолжение query', () => {
    expect(isAllowedReturnUrl('https://app.test/devices/return', allow)).toBe(true);
    expect(isAllowedReturnUrl('https://app.test/devices/return?from=onboarding', allow)).toBe(true);
    expect(isAllowedReturnUrl('pokatim://devices/return', allow)).toBe(true);
    expect(isAllowedReturnUrl('exp://192.168.1.5:8081/--/devices/return', allow)).toBe(true);
  });

  it('чужой хост, продолжение имени, пробелы — отказ', () => {
    expect(isAllowedReturnUrl('https://evil.test/devices/return', allow)).toBe(false);
    expect(isAllowedReturnUrl('https://app.test/devices/returnx', allow)).toBe(false);
    expect(isAllowedReturnUrl('https://app.test/devices/return.evil.test', allow)).toBe(false);
    expect(isAllowedReturnUrl('https://app.test.evil/devices/return', allow)).toBe(false);
    expect(isAllowedReturnUrl('https://app.test/devices/return?\nx', allow)).toBe(false);
    expect(isAllowedReturnUrl('javascript:alert(1)', allow)).toBe(false);
  });
});
