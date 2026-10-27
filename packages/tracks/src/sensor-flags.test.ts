import { readFileSync, writeFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import { parseGpx } from './gpx.ts';
import { parseTrackFile } from './parse.ts';
import { sanitizePoints } from './points.ts';
import { FLAGS_VERSION, SENSOR_FLAGS_POLICY, sensorFlags } from './sensor-flags.ts';
import { parseStream, TrackStreamV1 } from './stream.ts';
import type { ParsedPoint } from './track.ts';

const T0 = Date.parse('2026-10-25T06:00:00Z');
const MIN = 60;

/** Точка в секунду на `seconds` секунд; `sensors(s)` — пульс и мощность секунды `s` (undefined — нет отсчёта). */
function ride(
  seconds: number,
  sensors: (s: number) => Partial<Pick<ParsedPoint, 'hr' | 'power'>>,
  step = 1,
): ParsedPoint[] {
  const points: ParsedPoint[] = [];
  for (let s = 0; s <= seconds; s += step) {
    points.push({
      lat: 53.9 + s * 0.0001,
      lon: 27.55,
      time: new Date(T0 + s * 1000),
      ...sensors(s),
    });
  }
  return points;
}

const whole = (points: readonly ParsedPoint[]) => ({
  startedAt: points[0]!.time!,
  finishedAt: points.at(-1)!.time!,
});
const run = (points: ParsedPoint[]) => sensorFlags(points, whole(points));
const codes = (points: ParsedPoint[]) => run(points).flags.map((flag) => flag.code);

/** Пропуски пульса: секунды из `holes` ([from, to) в секундах) — без пульса. */
const withHoles = (seconds: number, holes: [number, number][]) =>
  ride(seconds, (s) => (holes.some(([a, b]) => s >= a && s < b) ? {} : { hr: 140 }));

/**
 * Рывки мощности: база 150 Вт, рывок — 300 Вт 10 с каждые 120 с (после 120 с разгона). Ответ пульса — 140 вместо 130
 * в [s+10, s+60] у рывков `responds(k) === true`.
 */
function surges(count: number, responds: (k: number) => boolean, tailSec = 0) {
  const lead = 120;
  const seconds = Math.max(lead + count * 120 + tailSec, 21 * MIN);
  return ride(seconds, (s) => {
    const k = Math.floor((s - lead) / 120);
    const offset = (s - lead) % 120;
    const inSurge = s >= lead && k < count && offset < 10;
    const answered = s >= lead && k < count && responds(k) && offset >= 10 && offset <= 60;
    return { power: inSurge ? 300 : 150, hr: answered ? 140 : 130 };
  });
}

describe('sensorFlags: датчики сегмента', () => {
  it('нет пульса — hr: false, флагов нет; мощность есть — power: true', () => {
    expect(run(ride(30 * MIN, () => ({ power: 200 })))).toEqual({
      sensors: { hr: false, power: true },
      flags: [],
    });
    expect(run(ride(10, () => ({})))).toEqual({ sensors: { hr: false, power: false }, flags: [] });
  });

  it('только точки сегмента: отсчёты до старта и после финиша не считаются', () => {
    const points = ride(100, (s) => (s < 10 || s > 90 ? { hr: 140, power: 200 } : {}));
    const result = sensorFlags(points, {
      startedAt: new Date(T0 + 20_000),
      finishedAt: new Date(T0 + 80_000),
    });
    expect(result).toEqual({ sensors: { hr: false, power: false }, flags: [] });
  });
});

describe('sensorFlags: HR_GAPS', () => {
  it(`один пропуск: 119 с — нет, 121 с — флаг (> ${SENSOR_FLAGS_POLICY.hrGapMaxMs / 1000} с)`, () => {
    // длительность пропуска — от последнего отсчёта до первого после: дыра [a, b) секунд даёт b − a + 1 с
    expect(codes(withHoles(60 * MIN, [[600, 718]]))).toEqual([]);
    const flagged = run(withHoles(60 * MIN, [[600, 720]]));
    expect(flagged.flags).toEqual([{ code: 'HR_GAPS', metric: 3 }]);
  });

  it('доля пропусков: 10 % — нет, 11 % — флаг; метрика — целые проценты', () => {
    // 1000 с сегмента: два пропуска по 50 с (99→149, 299→349) = 10 %; ещё 10 с (949→959) — 11 %
    const holes: [number, number][] = [
      [100, 149],
      [300, 349],
    ];
    expect(codes(withHoles(1000, holes))).toEqual([]);
    expect(run(withHoles(1000, [...holes, [950, 959]])).flags).toEqual([
      { code: 'HR_GAPS', metric: 11 },
    ]);
  });

  it('разрежённая запись (точка раз в 10 с) с пульсом в каждой — не пропуск', () => {
    expect(codes(ride(60 * MIN, () => ({ hr: 140 }), 10))).toEqual([]);
    // а та же редкая запись с точками без пульса на 130 с — пропуск
    expect(codes(ride(60 * MIN, (s) => (s >= 600 && s < 730 ? {} : { hr: 140 }), 10))).toEqual([
      'HR_GAPS',
    ]);
  });

  it('пропуск у края сегмента считается от старта / до финиша', () => {
    expect(codes(withHoles(60 * MIN, [[0, 125]]))).toEqual(['HR_GAPS']);
    expect(codes(withHoles(60 * MIN, [[60 * MIN - 124, 60 * MIN + 1]]))).toEqual(['HR_GAPS']);
  });
});

describe('sensorFlags: HR_POWER_DECOUPLED', () => {
  /** 40 мин: пульс 140; мощность 200 Вт в первой половине, `second` — во второй. */
  const halves = (second: number, minutes = 40) =>
    ride(minutes * MIN, (s) => ({ hr: 140, power: s < (minutes * MIN) / 2 ? 200 : second }));

  it('развязка половин: 14 % — нет, 16 % — флаг с метрикой', () => {
    expect(codes(halves(172))).toEqual([]);
    expect(run(halves(168)).flags).toEqual([{ code: 'HR_POWER_DECOUPLED', metric: 16 }]);
  });

  it('сегмент короче 20 мин и покрытие 79 % — не оцениваются', () => {
    expect(codes(halves(100, 19))).toEqual([]);
    const sparse = ride(40 * MIN, (s) =>
      s % 100 < 21 ? { hr: 140 } : { hr: 140, power: s < 20 * MIN ? 200 : 100 },
    );
    expect(codes(sparse)).toEqual([]);
    const enough = ride(40 * MIN, (s) =>
      s % 100 < 19 ? { hr: 140 } : { hr: 140, power: s < 20 * MIN ? 200 : 100 },
    );
    expect(codes(enough)).toEqual(['HR_POWER_DECOUPLED']);
  });

  it('рывки без ответа пульса: 5 — флаг, 4 — нет', () => {
    expect(run(surges(5, () => false)).flags).toEqual([
      { code: 'HR_POWER_DECOUPLED', metric: 100 },
    ]);
    expect(codes(surges(4, () => false))).toEqual([]);
    expect(codes(surges(10, () => true))).toEqual([]);
  });

  it('база рывка — только полные 60 с сегмента: разгон со старта (первые 65 с) — не рывок', () => {
    // 4 настоящих рывка без ответа + разгон 50 → 150 Вт на 3-й секунде сегмента (неполная база) — флага нет
    const start = surges(4, () => false).map((point, s) =>
      s < 3 ? { ...point, power: 50 } : point,
    );
    expect(codes(start)).toEqual([]);
  });

  it('доля без ответа: 70 % — нет, 71 % — флаг', () => {
    expect(codes(surges(10, (k) => k >= 7))).toEqual([]);
    expect(run(surges(24, (k) => k >= 17)).flags).toEqual([
      { code: 'HR_POWER_DECOUPLED', metric: 71 },
    ]);
  });

  it('через разбор GPX: мощность 0 — отсчёт, а не пропуск (накат 0/100 Вт во второй половине)', () => {
    const points = ride(40 * MIN, (s) => ({
      hr: 140,
      power: s < 20 * MIN ? 200 : s % 2 === 0 ? 0 : 100,
    }));
    const trkpts = points
      .map(
        (point) =>
          `<trkpt lat="${point.lat}" lon="${point.lon}"><time>${point.time!.toISOString()}</time>` +
          `<extensions><hr>${point.hr}</hr><power>${point.power}</power></extensions></trkpt>`,
      )
      .join('');
    const parsed = sanitizePoints(
      parseGpx(`<gpx><trk><trkseg>${trkpts}</trkseg></trk></gpx>`).points,
    );
    expect(run(parsed).flags).toEqual([{ code: 'HR_POWER_DECOUPLED', metric: 75 }]);
  });

  it('сработали оба правила — один флаг с метрикой развязки половин', () => {
    const both = surges(10, () => false).map((point, i, all) =>
      i >= all.length / 2 ? { ...point, power: point.power! / 2 } : point,
    );
    const { flags } = run(both);
    expect(flags).toHaveLength(1);
    expect(flags[0]!.code).toBe('HR_POWER_DECOUPLED');
    expect(flags[0]!.metric).toBeGreaterThan(15);
    expect(flags[0]!.metric).not.toBe(100);
  });
});

describe('sensorFlags: результат', () => {
  it('метрики — целые, без значений пульса и мощности; сериализуемо', () => {
    const result = run(withHoles(60 * MIN, [[600, 720]]));
    expect(structuredClone(result)).toEqual(result);
    for (const flag of result.flags) expect(Number.isInteger(flag.metric)).toBe(true);
    expect(Object.keys(result).sort()).toEqual(['flags', 'sensors']);
  });

  /**
   * Сторож порогов на реальных треках с пульсом (окно — весь трек). Изменился результат — поднять `FLAGS_VERSION` и
   * перезаписать эталон: `UPDATE_SENSOR_FLAGS_GOLDEN=1 pnpm --filter @pokatim/tracks test`.
   */
  it('golden: реальные треки с пульсом = эталону своей версии', () => {
    const golden = new URL('./__fixtures__/sensor-flags-golden.json', import.meta.url);
    const fixture = (name: string) =>
      new Uint8Array(readFileSync(new URL(`./__fixtures__/${name}`, import.meta.url)));
    const tracks: Record<string, ParsedPoint[]> = {};
    for (const name of [
      'garmin-connect.gpx',
      'garmin-edge-ride.fit',
      'strava.gpx',
      'wahoo-elemnt-ride.fit',
    ]) {
      tracks[name] = sanitizePoints(parseTrackFile(fixture(name)).points);
    }
    // поток агрегатора (`ow-stream.json`) значений датчиков не несёт — только флаги каналов
    expect(
      parseStream(
        TrackStreamV1.parse(JSON.parse(new TextDecoder().decode(fixture('ow-stream.json')))),
      ).points.some((point) => point.hr !== undefined),
    ).toBe(false);
    const results: Record<string, ReturnType<typeof sensorFlags>> = {};
    for (const [name, points] of Object.entries(tracks)) {
      expect(
        points.some((point) => point.hr !== undefined),
        `${name}: нет пульса`,
      ).toBe(true);
      results[name] = run(points);
    }
    const actual = { version: FLAGS_VERSION, results };
    if (process.env.UPDATE_SENSOR_FLAGS_GOLDEN === '1') {
      writeFileSync(golden, `${JSON.stringify(actual, null, 2)}\n`);
    }
    const stored = JSON.parse(readFileSync(golden, 'utf8')) as { version: number };
    expect(stored.version, 'эталон другой версии — перезаписать').toBe(FLAGS_VERSION);
    expect(actual, 'результат изменился — поднять FLAGS_VERSION').toEqual(stored);
  });
});
