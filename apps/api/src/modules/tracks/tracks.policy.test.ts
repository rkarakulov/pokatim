import { describe, expect, it } from 'vitest';

import { type DedupCandidate, isSameRide, pickPrimary } from './tracks.policy';

const base = new Date('2026-06-14T06:00:00.000Z');
const ride = (overrides: Partial<DedupCandidate> = {}): DedupCandidate => ({
  _id: 'a',
  source: 'upload',
  uploadId: 'u-a',
  startedAt: base,
  elapsedSec: 3600,
  hasHeartRate: false,
  hasPower: false,
  createdAt: base,
  ...overrides,
});

describe('isSameRide — окно дубля (R7)', () => {
  it('старт ±180 с включительно, дальше — разные заезды', () => {
    const at = (ms: number) => new Date(base.getTime() + ms);
    expect(isSameRide(ride(), ride({ source: 'garmin', startedAt: at(180_000) }))).toBe(true);
    expect(isSameRide(ride(), ride({ source: 'garmin', startedAt: at(-180_000) }))).toBe(true);
    expect(isSameRide(ride(), ride({ source: 'garmin', startedAt: at(180_001) }))).toBe(false);
  });

  it('длительность ±5 % включительно (не меньше 1 с)', () => {
    expect(isSameRide(ride(), ride({ source: 'wahoo', elapsedSec: 3780 }))).toBe(true);
    expect(isSameRide(ride(), ride({ source: 'wahoo', elapsedSec: 3420 }))).toBe(true);
    expect(isSameRide(ride(), ride({ source: 'wahoo', elapsedSec: 3781 }))).toBe(false);
    expect(isSameRide(ride({ elapsedSec: 10 }), ride({ source: 'wahoo', elapsedSec: 11 }))).toBe(
      true,
    );
    expect(isSameRide(ride({ elapsedSec: 10 }), ride({ source: 'wahoo', elapsedSec: 12 }))).toBe(
      false,
    );
  });

  it('две тренировки одного провайдера — не дубль; ручные загрузки сравниваются между собой', () => {
    expect(isSameRide(ride({ source: 'garmin' }), ride({ source: 'garmin' }))).toBe(false);
    expect(isSameRide(ride({ source: 'wahoo' }), ride({ source: 'wahoo' }))).toBe(false);
    expect(isSameRide(ride(), ride({ _id: 'b' }))).toBe(true);
  });
});

describe('pickPrimary — приоритет основной (R7)', () => {
  const later = new Date(base.getTime() + 1000);

  it('мощность > пульс > ручная загрузка > Garmin > Wahoo > раньше созданная', () => {
    const upload = ride({ _id: 'upload' });
    const garmin = ride({ _id: 'garmin', source: 'garmin' });
    const wahoo = ride({ _id: 'wahoo', source: 'wahoo' });
    expect(pickPrimary([wahoo, garmin, upload])._id).toBe('upload');
    expect(pickPrimary([wahoo, garmin])._id).toBe('garmin');
    expect(pickPrimary([upload, { ...wahoo, hasHeartRate: true }])._id).toBe('wahoo');
    expect(
      pickPrimary([
        { ...upload, hasHeartRate: true },
        { ...wahoo, hasPower: true },
      ])._id,
    ).toBe('wahoo');
    expect(pickPrimary([ride({ _id: 'late', createdAt: later }), ride({ _id: 'early' })])._id).toBe(
      'early',
    );
  });

  it('при полном равенстве — по id (детерминированно); пустая группа — ошибка', () => {
    expect(pickPrimary([ride({ _id: 'b' }), ride({ _id: 'a' })])._id).toBe('a');
    expect(() => pickPrimary([])).toThrow();
  });
});
