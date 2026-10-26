import { haversineMeters } from './geo.ts';
import type { ParsedPoint } from './track.ts';

/** Ячеек ряда не больше (точек графика панели). */
export const SERIES_MAX_BINS = 400;
/** Ячейка не уже, м: реже записи раз в секунду на гоночной скорости — без пустых ячеек на каждом шаге. */
export const SERIES_MIN_BIN_M = 25;

/** Отрезок трека для рядов — сегмент между воротами попытки. */
export interface SeriesWindow {
  startedAt: Date;
  finishedAt: Date;
}

export interface SeriesSummary {
  /** уд/мин, целые; `null` — пульса в сегменте нет */
  avgHeartRate: number | null;
  maxHeartRate: number | null;
  /** Вт, целые; `null` — мощности в сегменте нет */
  avgPower: number | null;
  maxPower: number | null;
  /** км/ч, 0,1; `null` — сегмент пуст */
  avgSpeedKmh: number | null;
}

/**
 * Ряды заезда по дистанции сегмента (разбор спора, слайс 06b): ячейки равной дистанции, `distanceM[k]` — конец ячейки
 * (м от старта сегмента). Ряд без датчика в сегменте — `null`; ячейка без значений — `null` внутри ряда. Без
 * координат и времени точек: наружу выходят только прореженные значения.
 */
export interface DisputeSeries {
  segmentDistanceM: number;
  distanceM: number[];
  heartRate: (number | null)[] | null;
  power: (number | null)[] | null;
  speedKmh: (number | null)[];
  summary: SeriesSummary;
}

const EMPTY: DisputeSeries = {
  segmentDistanceM: 0,
  distanceM: [],
  heartRate: null,
  power: null,
  speedKmh: [],
  summary: {
    avgHeartRate: null,
    maxHeartRate: null,
    avgPower: null,
    maxPower: null,
    avgSpeedKmh: null,
  },
};

const kmh = (meters: number, ms: number): number => Math.round((meters / ms) * 36_000) / 10;

/** Накопитель значений датчика: по ячейкам и по сегменту. */
class Sensor {
  readonly sums: number[];
  readonly counts: number[];
  total = 0;
  count = 0;
  max = -Infinity;

  constructor(bins: number) {
    this.sums = new Array<number>(bins).fill(0);
    this.counts = new Array<number>(bins).fill(0);
  }

  add(bin: number, value: number | undefined): void {
    if (value === undefined) return;
    this.sums[bin]! += value;
    this.counts[bin]! += 1;
    this.total += value;
    this.count += 1;
    this.max = Math.max(this.max, value);
  }

  series(): (number | null)[] | null {
    if (this.count === 0) return null;
    return this.sums.map((sum, k) => (this.counts[k] ? Math.round(sum / this.counts[k]!) : null));
  }

  average(): number | null {
    return this.count === 0 ? null : Math.round(this.total / this.count);
  }

  maximum(): number | null {
    return this.count === 0 ? null : Math.round(this.max);
  }
}

/**
 * Ряды пульса, мощности и скорости по дистанции: точки со временем в `[startedAt, finishedAt]`, дистанция — сумма
 * haversine соседних точек; ячеек `min(SERIES_MAX_BINS, D / SERIES_MIN_BIN_M)`. Пульс и мощность ячейки — среднее
 * значений её точек; скорость — дистанция пар (i-1, i) ячейки точки i, делённая на их время. Меньше двух точек — пусто.
 */
export function buildSeries(
  points: readonly ParsedPoint[],
  window: SeriesWindow,
  maxBins = SERIES_MAX_BINS,
): DisputeSeries {
  const from = window.startedAt.getTime();
  const to = window.finishedAt.getTime();
  const inside = points.filter((point) => {
    const time = point.time?.getTime();
    return time !== undefined && time >= from && time <= to;
  });
  if (inside.length < 2) return EMPTY;

  const along = [0];
  for (let i = 1; i < inside.length; i += 1) {
    along.push(along[i - 1]! + haversineMeters(inside[i - 1]!, inside[i]!));
  }
  const total = along.at(-1)!;
  const durationMs = inside.at(-1)!.time!.getTime() - inside[0]!.time!.getTime();
  if (total <= 0 || durationMs <= 0) return EMPTY;

  const bins = Math.max(1, Math.min(maxBins, Math.floor(total / SERIES_MIN_BIN_M)));
  const width = total / bins;
  const heart = new Sensor(bins);
  const power = new Sensor(bins);
  const meters = new Array<number>(bins).fill(0);
  const millis = new Array<number>(bins).fill(0);

  inside.forEach((point, i) => {
    const bin = Math.min(Math.floor(along[i]! / width), bins - 1);
    heart.add(bin, point.hr);
    power.add(bin, point.power);
    if (i === 0) return;
    meters[bin]! += along[i]! - along[i - 1]!;
    millis[bin]! += point.time!.getTime() - inside[i - 1]!.time!.getTime();
  });

  return {
    segmentDistanceM: Math.round(total),
    distanceM: Array.from({ length: bins }, (_, k) =>
      k === bins - 1 ? Math.round(total) : Math.round((k + 1) * width),
    ),
    heartRate: heart.series(),
    power: power.series(),
    speedKmh: meters.map((m, k) => (millis[k]! > 0 ? kmh(m, millis[k]!) : null)),
    summary: {
      avgHeartRate: heart.average(),
      maxHeartRate: heart.maximum(),
      avgPower: power.average(),
      maxPower: power.maximum(),
      avgSpeedKmh: kmh(total, durationMs),
    },
  };
}
