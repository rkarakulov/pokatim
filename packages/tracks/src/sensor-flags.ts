import type { SeriesWindow } from './series.ts';
import type { ParsedPoint } from './track.ts';

/*
 * Флаги датчиков попытки «Требует внимания» (race-results-07, спайк 07-08 §3.3): сигнал команде, не дисквалификация.
 * Только worker (поток разбора). Наружу — наличие каналов и метрики в целых процентах; значений пульса и мощности нет.
 */

/** Версия порогов и определений; смена `SENSOR_FLAGS_POLICY` или алгоритма — поднять и перезаписать golden. */
export const FLAGS_VERSION = 1;
/** Коды флагов датчиков ⊂ `ATTEMPT_FLAG_CODES` контракта (сторож — в api). */
export const SENSOR_FLAG_CODES = ['HR_POWER_DECOUPLED', 'HR_GAPS'] as const;

/** Умеренные пороги спайка §3.3. */
export const SENSOR_FLAGS_POLICY = {
  /** доля времени сегмента без пульса */
  hrGapShare: 0.1,
  /** один пропуск пульса, мс */
  hrGapMaxMs: 120_000,
  /** развязка оценивается на сегменте не короче, мс */
  decoupleMinMs: 20 * 60_000,
  /** доля точек сегмента с обоими каналами */
  decoupleMinCoverage: 0.8,
  /** расхождение Pw:HR половин, % */
  decouplePct: 15,
  /** рывок: среднее мощности за `surgeAvgMs` > `surgeRatio` × среднего за предыдущие `surgeBaseMs` */
  surgeRatio: 1.5,
  surgeBaseMs: 60_000,
  surgeAvgMs: 5_000,
  /** следующий рывок — не раньше, мс от начала прошлого */
  surgeRefractoryMs: 60_000,
  /** ответ пульса: рост ≥ `responseBpm` за `responseMs` после рывка */
  responseMs: 90_000,
  responseBpm: 5,
  minSurges: 5,
  /** доля рывков без ответа пульса */
  nonResponseShare: 0.7,
} as const;

export type SensorFlagCode = (typeof SENSOR_FLAG_CODES)[number];

/** Есть ли хоть один отсчёт канала в сегменте. */
export interface SensorPresence {
  hr: boolean;
  power: boolean;
}

/** Флаг датчиков: метрика — целые проценты. */
export interface SensorFlag {
  code: SensorFlagCode;
  metric: number;
}

const P = SENSOR_FLAGS_POLICY;

/** Отсчёты одного канала: время (мс) и значение, по возрастанию времени; префиксные суммы для средних окна. */
class Channel {
  readonly times: number[] = [];
  readonly values: number[] = [];
  private prefix: number[] = [0];

  add(time: number, value: number): void {
    this.times.push(time);
    this.values.push(value);
    this.prefix.push(this.prefix.at(-1)! + value);
  }

  /** Сумма значений отсчётов `[lo, hi)` по индексам. */
  sum(lo: number, hi: number): number {
    return this.prefix[hi]! - this.prefix[lo]!;
  }
}

/**
 * Монотонный указатель «первый индекс со временем ≥ / > порога»: пороги растут — суммарно O(n).
 */
class Cursor {
  private index = 0;
  private readonly times: readonly number[];
  private readonly inclusive: boolean;

  /** `inclusive` — `at(x)` даёт первый индекс со временем ≥ x, иначе > x. */
  constructor(times: readonly number[], inclusive: boolean) {
    this.times = times;
    this.inclusive = inclusive;
  }

  at(threshold: number): number {
    const passed = (time: number) => (this.inclusive ? time < threshold : time <= threshold);
    while (this.index < this.times.length && passed(this.times[this.index]!)) this.index += 1;
    return this.index;
  }
}

/**
 * Пропуски пульса: «пропуск» — серия подряд идущих точек сегмента без пульса; длительность — от последнего отсчёта
 * до серии (или старта) до первого после (или финиша). Разрежённая запись без точек без пульса — не пропуск.
 */
function hrGaps(inside: readonly ParsedPoint[], from: number, to: number): SensorFlag | null {
  let total = 0;
  let longest = 0;
  let lastHr = from;
  let inGap = false;
  for (const point of inside) {
    const time = point.time!.getTime();
    if (point.hr === undefined) {
      inGap = true;
      continue;
    }
    if (inGap) {
      total += time - lastHr;
      longest = Math.max(longest, time - lastHr);
      inGap = false;
    }
    lastHr = time;
  }
  if (inGap) {
    total += to - lastHr;
    longest = Math.max(longest, to - lastHr);
  }
  const share = total / (to - from);
  if (share > P.hrGapShare || longest > P.hrGapMaxMs) {
    return { code: 'HR_GAPS', metric: Math.round(share * 100) };
  }
  return null;
}

/** (а) Pw:HR половин сегмента по времени, %; `null` — в половине нет точек с обоими каналами. */
function halvesDecouplingPct(both: readonly ParsedPoint[], mid: number): number | null {
  const sums = [
    { power: 0, hr: 0, n: 0 },
    { power: 0, hr: 0, n: 0 },
  ];
  for (const point of both) {
    const half = sums[point.time!.getTime() < mid ? 0 : 1]!;
    half.power += point.power!;
    half.hr += point.hr!;
    half.n += 1;
  }
  const [first, second] = sums as [(typeof sums)[0], (typeof sums)[0]];
  if (first.n === 0 || second.n === 0 || first.hr === 0 || second.hr === 0) return null;
  const r1 = first.power / first.hr;
  const r2 = second.power / second.hr;
  if (r1 === 0) return null;
  return (Math.abs(r1 - r2) / r1) * 100;
}

/**
 * (б) Доля рывков мощности без ответа пульса; `null` — рывков меньше `minSurges`. Рывок — отсчёт мощности `t`, где
 * среднее за `[t − 5 с, t]` > 1,5 × среднего за `[t − 65 с, t − 5 с)`; ответ — `max(hr в (t, t + 90 с]) −
 * mean(hr в [t − 5 с, t]) ≥ 5`. Рывок без отсчётов пульса до или после не оценивается.
 */
function surgeNonResponseShare(power: Channel, hr: Channel): number | null {
  const avgFrom = new Cursor(power.times, true);
  const baseFrom = new Cursor(power.times, true);
  const hrPreFrom = new Cursor(hr.times, true);
  const hrPreTo = new Cursor(hr.times, false);
  let surges = 0;
  let silent = 0;
  let lastSurge = -Infinity;
  for (let i = 0; i < power.times.length; i += 1) {
    const t = power.times[i]!;
    const avgLo = avgFrom.at(t - P.surgeAvgMs);
    const baseLo = baseFrom.at(t - P.surgeAvgMs - P.surgeBaseMs);
    const preLo = hrPreFrom.at(t - P.surgeAvgMs);
    const preHi = hrPreTo.at(t);
    if (t - lastSurge < P.surgeRefractoryMs || baseLo >= avgLo) continue;
    const avg = power.sum(avgLo, i + 1) / (i + 1 - avgLo);
    const base = power.sum(baseLo, avgLo) / (avgLo - baseLo);
    if (!(base > 0 && avg > P.surgeRatio * base)) continue;
    lastSurge = t;
    if (preHi <= preLo) continue;
    const before = hr.sum(preLo, preHi) / (preHi - preLo);
    let peak = -Infinity;
    // окно ответа (t, t + 90 с]: рывки разнесены ≥ 60 с — каждый отсчёт пульса просматривается не больше двух раз
    for (let k = preHi; k < hr.times.length && hr.times[k]! <= t + P.responseMs; k += 1) {
      peak = Math.max(peak, hr.values[k]!);
    }
    if (peak === -Infinity) continue;
    surges += 1;
    if (peak - before < P.responseBpm) silent += 1;
  }
  return surges >= P.minSurges ? silent / surges : null;
}

function decoupling(inside: readonly ParsedPoint[], from: number, to: number): SensorFlag | null {
  if (to - from < P.decoupleMinMs) return null;
  const both = inside.filter((point) => point.hr !== undefined && point.power !== undefined);
  if (both.length / inside.length < P.decoupleMinCoverage) return null;
  const pct = halvesDecouplingPct(both, from + (to - from) / 2);
  if (pct !== null && pct > P.decouplePct) {
    return { code: 'HR_POWER_DECOUPLED', metric: Math.round(pct) };
  }
  const power = new Channel();
  const hr = new Channel();
  for (const point of inside) {
    const time = point.time!.getTime();
    if (point.power !== undefined) power.add(time, point.power);
    if (point.hr !== undefined) hr.add(time, point.hr);
  }
  const share = surgeNonResponseShare(power, hr);
  if (share !== null && share > P.nonResponseShare) {
    return { code: 'HR_POWER_DECOUPLED', metric: Math.round(share * 100) };
  }
  return null;
}

/**
 * Датчики и флаги сегмента попытки: точки со временем в `[startedAt, finishedAt]` (как `buildSeries`). `HR_GAPS` —
 * только при пульсе; `HR_POWER_DECOUPLED` — при обоих каналах, сегменте ≥ 20 мин и покрытии ≥ 80 %: (а) половины,
 * иначе (б) рывки. Без значений датчиков в результате.
 */
export function sensorFlags(
  points: readonly ParsedPoint[],
  window: SeriesWindow,
): { sensors: SensorPresence; flags: SensorFlag[] } {
  const from = window.startedAt.getTime();
  const to = window.finishedAt.getTime();
  const inside = points.filter((point) => {
    const time = point.time?.getTime();
    return time !== undefined && time >= from && time <= to;
  });
  const sensors = {
    hr: inside.some((point) => point.hr !== undefined),
    power: inside.some((point) => point.power !== undefined),
  };
  const flags: SensorFlag[] = [];
  if (to <= from) return { sensors, flags };
  if (sensors.hr && sensors.power) {
    const flag = decoupling(inside, from, to);
    if (flag) flags.push(flag);
  }
  if (sensors.hr) {
    const flag = hrGaps(inside, from, to);
    if (flag) flags.push(flag);
  }
  return { sensors, flags };
}
