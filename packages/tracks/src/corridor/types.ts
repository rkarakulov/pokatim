/** Окно гонки для сверки. `closesAt` — исключающая граница (`windowEndsAt + 1 мин`, считает `races`). */
export interface MatchWindow {
  startsAt: Date;
  closesAt: Date;
}

/** Только в конец; совпадёт с enum контракта слайса 03. */
export const CORRIDOR_REJECTIONS = [
  'no_start',
  'no_finish',
  'wrong_direction',
  'missed_section',
  'gps_gap',
  'off_corridor',
  'outside_window',
] as const;
export type CorridorRejection = (typeof CORRIDOR_REJECTIONS)[number];

export interface CorridorSegment {
  /** интерполированный выход из ворот старта */
  startedAt: Date;
  /** интерполированный вход в ворота финиша; без финиша (`no_finish`) — последняя точка трека */
  finishedAt: Date;
  elapsedMs: number;
  /** Math.round(elapsedMs / 1000) — A7 */
  elapsedSec: number;
  /** длина трека на сегменте, м (целое) */
  distanceM: number;
  /** м (целое) */
  offCorridorM: number;
  /** offCorridorM / distanceM, 0..1 */
  offCorridorShare: number;
  /** самый длинный непрерывный выход, м (целое) */
  maxExcursionM: number;
  /** доля покрытых ячеек 250 м, 0..1 */
  coverage: number;
  /** выбросы GPS внутри сегмента (в расчёте не участвуют) */
  noisePoints: number;
}

export interface CorridorMatch {
  /** CORRIDOR_ENGINE_VERSION */
  engineVersion: number;
  verdict: 'counted' | 'rejected';
  /** [] при counted; первый — основной */
  reasons: CorridorRejection[];
  /** counted — лучший; rejected — лучший кандидат или null (нет кандидата старта) */
  segment: CorridorSegment | null;
  touchedCorridor: boolean;
  /** число проверенных кандидатов старта */
  candidates: number;
  /** длина линии коридора (по ней ячейки и привязка) и заявленная длина маршрута, м (целые) — для журнала */
  diagnostics: { corridorLengthM: number; declaredDistanceM: number };
}

/**
 * Подготовленный коридор (`prepareCorridor`): уплотнённая линия, chainage, сеточный индекс, ворота, ячейки.
 * Внутренняя структура движка — потребители передают её в `matchCorridor` как есть.
 */
export interface PreparedCorridor {
  readonly widthM: number;
  readonly isLoop: boolean;
  /** вершины уплотнённой линии, градусы */
  readonly lon: Float64Array;
  readonly lat: Float64Array;
  /** chainage вершин, м; length = вершин */
  readonly chainage: Float64Array;
  /** длина уплотнённой линии, м */
  readonly lengthM: number;
  /** `CorridorGeometry.distanceM` — только диагностика (метрика коридора — `lengthM`) */
  readonly declaredDistanceM: number;
  /** на отрезок: метров в градусе долготы (локальная проекция вокруг середины отрезка) */
  readonly segKx: Float64Array;
  /** метров в градусе широты */
  readonly ky: number;
  readonly grid: SegmentGrid;
  readonly gateRadiusM: number;
  /** центры ворот [lon, lat]: старт — первая вершина, финиш — последняя (у петли с общим концом — один круг) */
  readonly startGate: readonly [number, number];
  readonly finishGate: readonly [number, number];
  readonly coverageCells: number;
}

/** Сеточный индекс отрезков: отсортированные ключи ячеек и CSR-списки отрезков. */
export interface SegmentGrid {
  readonly minLon: number;
  readonly minLat: number;
  readonly cellLon: number;
  readonly cellLat: number;
  readonly columns: number;
  readonly rows: number;
  /** ключи непустых ячеек (row * columns + column) по возрастанию */
  readonly keys: Float64Array;
  /** keys.length + 1 */
  readonly offsets: Int32Array;
  readonly segments: Int32Array;
}
