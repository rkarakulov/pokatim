import { describe, expect, it } from 'vitest';

import { checkPlausibility } from './plausibility.ts';
import { sanitizePoints } from './points.ts';
import { summarizeTrack } from './summary.ts';
import { TrackParseError, type ParsedPoint, type ParsedTrack } from './track.ts';

const NOW = new Date('2026-10-25T12:00:00Z');
const T0 = Date.UTC(2026, 9, 20, 8, 0, 0);

/** Прямая на север: шаг `stepM` метров раз в `stepSec` секунд. */
function line(count: number, stepM = 7, stepSec = 1, startMs = T0): ParsedPoint[] {
  return Array.from({ length: count }, (_, i) => ({
    lat: 53.9 + (i * stepM) / 111_195,
    lon: 27.56,
    time: new Date(startMs + i * stepSec * 1000),
  }));
}

const track = (points: ParsedPoint[]): ParsedTrack => ({
  format: 'gpx',
  sport: 'cycling',
  points,
  hasHeartRate: false,
  hasPower: false,
});

const check = (points: ParsedPoint[]) =>
  checkPlausibility(track(points), sanitizePoints(points), NOW);

describe('sanitizePoints', () => {
  it('отбрасывает (0,0), вне диапазона и NaN, порядок сохраняет', () => {
    const [a, b, c] = line(3);
    const result = sanitizePoints([
      a!,
      { lat: 0, lon: 0, time: new Date(T0 + 500) },
      { lat: 91, lon: 27, time: new Date(T0 + 600) },
      { lat: 53, lon: -181 },
      { lat: Number.NaN, lon: 27 },
      b!,
      c!,
    ]);
    expect(result).toEqual([a, b, c]);
  });

  it('точка со временем раньше предыдущей отбрасывается, не сортируется; без времени — остаётся', () => {
    const [a, b, c, d] = line(4);
    const noTime = { lat: 53.95, lon: 27.56 };
    expect(sanitizePoints([a!, c!, b!, noTime, d!])).toEqual([a, c, noTime, d]);
  });
});

describe('checkPlausibility', () => {
  it('нормальный трек — null', () => {
    expect(check(line(100))).toBeNull();
  });

  it('< 2 точек с координатами — no_track', () => {
    expect(check([])).toBe('no_track');
    expect(check(line(1))).toBe('no_track');
  });

  it('нет времени — no_timestamps', () => {
    expect(check(line(10).map(({ lat, lon }) => ({ lat, lon })))).toBe('no_timestamps');
  });

  it('начало в будущем (> now + 24 ч) — implausible; в пределах суток — допустимо', () => {
    expect(check(line(10, 7, 1, NOW.getTime() + 25 * 3600_000))).toBe('implausible');
    expect(check(line(10, 7, 1, NOW.getTime() + 23 * 3600_000))).toBeNull();
  });

  it('начало до 2000-01-01 — implausible', () => {
    expect(check(line(10, 7, 1, Date.UTC(1999, 11, 31, 23, 0, 0)))).toBe('implausible');
    expect(check(line(10, 7, 1, Date.UTC(2000, 0, 1)))).toBeNull();
  });

  it('длительность > 48 ч — implausible', () => {
    expect(check(line(3, 100, 25 * 3600))).toBe('implausible');
    expect(check(line(3, 100, 24 * 3600))).toBeNull();
  });

  it('очистка оставила < 50 % точек — implausible, ровно половина — допустимо', () => {
    const good = line(10);
    const zeros = (n: number) => line(n).map((p) => ({ ...p, lat: 0, lon: 0 }));
    expect(check([...good, ...zeros(11)])).toBe('implausible');
    expect(check([...good, ...zeros(10)])).toBeNull();
  });
});

describe('summarizeTrack', () => {
  it('время, дистанция, движение без паузы', () => {
    const moving = line(601); // 600 с по 7 м
    const last = moving[moving.length - 1]!;
    const pause = Array.from({ length: 120 }, (_, i) => ({
      ...last,
      time: new Date(last.time!.getTime() + (i + 1) * 1000),
    }));
    const summary = summarizeTrack([...moving, ...pause]);
    expect(summary.startedAt).toEqual(new Date(T0));
    expect(summary.endedAt).toEqual(new Date(T0 + 720_000));
    expect(summary.elapsedSec).toBe(720);
    expect(summary.movingSec).toBe(600);
    expect(summary.distanceM).toBeGreaterThan(4190);
    expect(summary.distanceM).toBeLessThan(4210);
    expect(summary.elevationGainM).toBeNull();
  });

  it('интервал длиннее 5 мин в движение не входит', () => {
    const [a, b] = line(2, 2000, 400);
    expect(summarizeTrack([a!, b!]).movingSec).toBe(0);
  });

  it('набор высоты с порогом шума 3 м', () => {
    const elevations = [100, 102, 100, 102, 100, 105, 104, 110, 107, 112];
    const points = line(elevations.length).map((p, i) => ({ ...p, ele: elevations[i]! }));
    // шум ±2 м не копится; 100→105 (+5), 105→110 (+5), 110→107 (сброс), 107→112 (+5)
    expect(summarizeTrack(points).elevationGainM).toBe(15);
  });

  it('без двух точек со временем — no_timestamps', () => {
    expect(() => summarizeTrack(line(1))).toThrow(TrackParseError);
  });
});
