import { localProjection } from '../geo.ts';
import type { ParsedPoint } from '../track.ts';
import { CORRIDOR_ENGINE_VERSION, CORRIDOR_POLICY } from './policy.ts';
import { chordOutsideM, segmentDistance, visitMarks, type VisitMarks } from './prepare.ts';
import { projectTrack, type ProjectedTrack } from './project.ts';
import type {
  CorridorMatch,
  CorridorRejection,
  CorridorSegment,
  MatchWindow,
  PreparedCorridor,
} from './types.ts';

const COVERED = 1;
/** ячейка без точек внутри пары соседних точек дальше `gapMaxM` — данных нет */
const GAP = 2;

interface Crossing {
  /** индекс точки до пересечения (пересечение — на шаге [index, index + 1]) */
  index: number;
  /** доля шага */
  u: number;
  timeMs: number;
}

interface Scan {
  finish: Crossing | null;
  /** последний вход в ворота финиша при недостаточном покрытии */
  lastEarlyEntry: Crossing | null;
  /** конец просмотра (финиш или последняя точка) */
  endIndex: number;
  covered: number;
  gapCells: number;
  directionNeg: number;
  directionAbs: number;
  /** неокруглённые метры: пороги A6 сравниваются по ним, в результат — целые */
  distanceM: number;
  offCorridorM: number;
  /** часть схода — недобранный путь хорд (редкая запись), а не точки или хорды вне коридора */
  shortfallM: number;
  maxExcursionM: number;
  maxMissedRun: number;
  maxGapRun: number;
}

interface Evaluated {
  segment: CorridorSegment;
  reasons: CorridorRejection[];
}

/**
 * Сверка заезда с коридором (§7.3–7.5): кандидаты старта — выходы из ворот старта вперёд по маршруту; финиш —
 * первый вход в ворота финиша при покрытии ≥ 98 %; моменты — интерполяция пересечения окружности ворот; проверки
 * сегмента — направление, покрытие, разрыв GPS, сход (A6), окно (A5). Засчитанных несколько — лучший по времени.
 * Детерминирована: одинаковый вход → одинаковый результат. Пульс и мощность не читаются.
 */
export function matchCorridor(
  points: readonly ParsedPoint[],
  corridor: PreparedCorridor,
  window: MatchWindow,
): CorridorMatch {
  const track = projectTrack(points, corridor);
  const engine = new Engine(corridor, track);
  const touchedCorridor = track.inside.some((flag) => flag === 1);
  const starts = engine.startCandidates();
  const result = (
    verdict: CorridorMatch['verdict'],
    reasons: CorridorRejection[],
    segment: CorridorSegment | null,
  ): CorridorMatch => ({
    engineVersion: CORRIDOR_ENGINE_VERSION,
    verdict,
    reasons,
    segment,
    touchedCorridor,
    candidates: starts.length,
    diagnostics: {
      corridorLengthM: Math.round(corridor.lengthM),
      declaredDistanceM: Math.round(corridor.declaredDistanceM),
      geometryLimited: engine.geometryLimited,
    },
  });

  if (starts.length === 0) {
    const reason: CorridorRejection = engine.wholeTrackWrongDirection()
      ? 'wrong_direction'
      : 'no_start';
    return result('rejected', [reason], null);
  }

  let bestCounted: CorridorSegment | null = null;
  let bestRejected: Evaluated | null = null;
  for (const start of starts) {
    const evaluated = engine.evaluate(start, window);
    if (evaluated.reasons.length === 0) {
      if (bestCounted === null || evaluated.segment.elapsedMs < bestCounted.elapsedMs) {
        bestCounted = evaluated.segment;
      }
    } else if (
      bestRejected === null ||
      evaluated.segment.coverage > bestRejected.segment.coverage
    ) {
      bestRejected = evaluated;
    }
  }
  if (bestCounted !== null) return result('counted', [], bestCounted);
  return result('rejected', bestRejected!.reasons, bestRejected!.segment);
}

class Engine {
  private readonly cells: Uint8Array;
  private readonly inStart: Uint8Array;
  private readonly inFinish: Uint8Array;
  private readonly gateX: Float64Array;
  private readonly gateY: Float64Array;
  private readonly finishX: Float64Array;
  private readonly finishY: Float64Array;
  private covered = 0;
  private gapCells = 0;
  private lastNewCell = -1;
  private directionNeg = 0;
  private directionAbs = 0;
  private wholeTrackWrong: boolean | undefined;
  private readonly corridor: PreparedCorridor;
  private readonly track: ProjectedTrack;
  /** буферы запроса сетки и интервалов пересечения хорды с коридором */
  private readonly gridOut: Int32Array;
  private readonly visits: VisitMarks;
  private readonly lows: Float64Array;
  private readonly highs: Float64Array;
  /** часть хорды вне коридора по шагу (полный шаг) — общая для всех кандидатов старта; NaN — не считалась */
  private readonly chordCache: Float64Array;
  private readonly chordWork = { count: 0 };
  /** лимит работы точной геометрии исчерпан — дальше консервативная оценка */
  geometryLimited = false;

  // без параметров-свойств: вход `parse` грузится Node со стиранием типов (только стираемый синтаксис)
  constructor(corridor: PreparedCorridor, track: ProjectedTrack) {
    this.corridor = corridor;
    this.track = track;
    this.cells = new Uint8Array(corridor.coverageCells);
    const n = track.count;
    this.gateX = new Float64Array(n);
    this.gateY = new Float64Array(n);
    this.finishX = new Float64Array(n);
    this.finishY = new Float64Array(n);
    this.inStart = new Uint8Array(n);
    this.inFinish = new Uint8Array(n);
    const r2 = corridor.gateRadiusM ** 2;
    const project = (gate: readonly [number, number], xs: Float64Array, ys: Float64Array) => {
      const { kx, ky } = localProjection(gate[1]);
      for (let k = 0; k < n; k += 1) {
        xs[k] = (track.points[k]!.lon - gate[0]) * kx;
        ys[k] = (track.points[k]!.lat - gate[1]) * ky;
      }
    };
    project(corridor.startGate, this.gateX, this.gateY);
    project(corridor.finishGate, this.finishX, this.finishY);
    for (let k = 0; k < n; k += 1) {
      this.inStart[k] = this.gateX[k]! ** 2 + this.gateY[k]! ** 2 <= r2 ? 1 : 0;
      this.inFinish[k] = this.finishX[k]! ** 2 + this.finishY[k]! ** 2 <= r2 ? 1 : 0;
    }
    const segments = corridor.lon.length - 1;
    this.gridOut = new Int32Array(segments);
    this.visits = visitMarks(segments);
    this.lows = new Float64Array(segments);
    this.highs = new Float64Array(segments);
    this.chordCache = new Float64Array(n).fill(Number.NaN);
  }

  /** Выходы из ворот старта вперёд по маршруту; подряд в пределах 60 с — последний; не больше 20. */
  startCandidates(): Crossing[] {
    const { track } = this;
    const exits: Crossing[] = [];
    for (let k = 0; k + 1 < track.count; k += 1) {
      const crossing = this.startExit(k);
      if (crossing === null) continue;
      const previous = exits[exits.length - 1];
      if (
        previous !== undefined &&
        crossing.timeMs - previous.timeMs <= CORRIDOR_POLICY.startDebounceMs
      ) {
        exits[exits.length - 1] = crossing;
      } else {
        exits.push(crossing);
      }
    }
    const max = CORRIDOR_POLICY.maxStartCandidates;
    if (exits.length <= max) return exits;
    let peak = 0;
    for (let k = 1; k < track.count; k += 1) if (track.s[k]! > track.s[peak]!) peak = k;
    const beforePeak = exits.filter((exit) => exit.index < peak);
    return (beforePeak.length > 0 ? beforePeak : exits).slice(-max);
  }

  /** Направление по всему треку (нет кандидата старта или финиша): порядок первого покрытия ячеек. */
  wholeTrackWrongDirection(): boolean {
    if (this.wholeTrackWrong === undefined) {
      this.resetCells();
      for (let k = 0; k < this.track.count; k += 1) this.cover(k);
      this.wholeTrackWrong = this.wrongDirection();
    }
    return this.wholeTrackWrong;
  }

  evaluate(start: Crossing, window: MatchWindow): Evaluated {
    const scan = this.scan(start, this.track.count - 1, true);
    if (scan.finish !== null) return this.verdict(start, scan.finish, scan, window, false);
    if (scan.lastEarlyEntry !== null) {
      const partial = this.scan(start, scan.lastEarlyEntry.index + 1, false);
      return this.verdict(start, scan.lastEarlyEntry, partial, window, true);
    }
    const wrong = this.wholeTrackWrongDirection();
    const lastTime = this.track.time[scan.endIndex]!;
    const end: Crossing = { index: scan.endIndex, u: 0, timeMs: lastTime };
    return {
      segment: this.segment(start, end, scan),
      reasons: [wrong ? 'wrong_direction' : 'no_finish'],
    };
  }

  private verdict(
    start: Crossing,
    finish: Crossing,
    scan: Scan,
    window: MatchWindow,
    incomplete: boolean,
  ): Evaluated {
    const segment = this.segment(start, finish, scan);
    const n = this.corridor.coverageCells;
    const policy = CORRIDOR_POLICY;
    const reasons: CorridorRejection[] = [];
    if (
      scan.directionAbs > 0 &&
      scan.directionNeg >= policy.wrongDirectionShare * scan.directionAbs
    ) {
      reasons.push('wrong_direction');
    }
    if (
      incomplete ||
      (scan.covered + scan.gapCells) / n < policy.coverageMin ||
      scan.maxMissedRun > policy.maxUncoveredCells
    ) {
      reasons.push('missed_section');
    }
    if (
      scan.gapCells > 0 &&
      (scan.covered / n < policy.coverageMin || scan.maxGapRun > policy.maxUncoveredCells)
    ) {
      reasons.push('gps_gap');
    }
    const tolerance = policy.thresholdToleranceM;
    if (
      scan.offCorridorM > policy.maxOffCorridorShare * scan.distanceM + tolerance ||
      scan.maxExcursionM > policy.maxExcursionM + tolerance
    ) {
      // сход главным образом из-за недобранного пути хорд — «запись слишком редкая»
      const sparse = scan.shortfallM > scan.offCorridorM - scan.shortfallM;
      reasons.push(sparse ? 'sparse_recording' : 'off_corridor');
    }
    if (start.timeMs < window.startsAt.getTime() || finish.timeMs >= window.closesAt.getTime()) {
      reasons.push('outside_window');
    }
    return { segment, reasons };
  }

  private segment(start: Crossing, finish: Crossing, scan: Scan): CorridorSegment {
    const elapsedMs = finish.timeMs - start.timeMs;
    const distanceM = Math.round(scan.distanceM);
    const offCorridorM = Math.round(scan.offCorridorM);
    let noisePoints = 0;
    for (const time of this.track.noiseTimes) {
      if (time >= start.timeMs && time <= finish.timeMs) noisePoints += 1;
    }
    return {
      startedAt: new Date(start.timeMs),
      finishedAt: new Date(finish.timeMs),
      elapsedMs,
      elapsedSec: Math.round(elapsedMs / 1000),
      distanceM,
      offCorridorM,
      offCorridorShare: distanceM > 0 ? offCorridorM / distanceM : 0,
      maxExcursionM: Math.round(scan.maxExcursionM),
      coverage: scan.covered / this.corridor.coverageCells,
      noisePoints,
    };
  }

  /**
   * Просмотр от выхода из ворот старта: покрытие, направление, длина, сход. `findFinish` — остановиться на первом
   * входе в ворота финиша при покрытии (с учётом разрывов GPS) ≥ 98 %; иначе — до `lastIndex` (последний шаг —
   * до точки входа, доля `u` ворот).
   */
  private scan(start: Crossing, lastIndex: number, findFinish: boolean): Scan {
    const { corridor } = this;
    const n = corridor.coverageCells;
    this.resetCells();
    let finish: Crossing | null = null;
    let lastEarlyEntry: Crossing | null = null;
    let endIndex = lastIndex;
    /** доля последнего шага до конца сегмента (вход в ворота финиша) */
    let endU = 1;
    this.cover(start.index);

    for (let k = start.index + 1; k <= lastIndex; k += 1) {
      this.cover(k);
      this.coverStep(k - 1, k - 1 === start.index);
      // вход в ворота финиша — строго после выхода из ворот старта
      let entry = this.finishEntry(k - 1);
      if (
        entry !== null &&
        (entry.timeMs <= start.timeMs || (k - 1 === start.index && entry.u <= start.u))
      ) {
        entry = null;
      }
      const entering = entry !== null;
      const isFinish =
        entering &&
        findFinish &&
        (this.covered + this.gapCells + this.uncoveredTail()) / n >= CORRIDOR_POLICY.coverageMin;
      const partialEnd = !findFinish && k === lastIndex && entering;
      if (isFinish || partialEnd) endU = entry!.u;

      if (isFinish) this.coverTail();
      if (isFinish) {
        finish = entry;
        endIndex = k;
        break;
      }
      if (entering && findFinish) lastEarlyEntry = entry;
    }

    const runs = this.runs();
    const { distanceM, offCorridorM, maxExcursionM, shortfallM } = this.offCorridor(
      start,
      endIndex,
      endU,
    );
    return {
      finish,
      lastEarlyEntry,
      endIndex,
      covered: this.covered,
      gapCells: this.gapCells,
      directionNeg: this.directionNeg,
      directionAbs: this.directionAbs,
      distanceM,
      offCorridorM,
      shortfallM,
      maxExcursionM,
      maxMissedRun: runs.missed,
      maxGapRun: runs.gap,
    };
  }

  /**
   * Выход из ворот старта вперёд по маршруту на шаге [k, k + 1]: точка в круге → точка вне круга, или хорда сквозь
   * круг (шаг ≤ gapMaxM), или — длинный шаг по маршруту (редкая запись, поворот у ворот) — `s` проходит отметку
   * выхода (R от начала, у петли — от начала круга).
   */
  private startExit(k: number): Crossing | null {
    const { track } = this;
    if (track.s[k + 1]! < track.s[k]!) return null;
    if (
      this.inStart[k + 1] !== 1 &&
      (this.inStart[k] === 1 || this.passesThrough(k, this.gateX, this.gateY))
    ) {
      return this.crossing(k, this.gateX, this.gateY, 'exit');
    }
    return this.chainageCrossing(k, this.corridor.gateRadiusM);
  }

  /** Вход в ворота финиша на шаге [k, k + 1] — то же правило, отметка — R до конца маршрута (круга). */
  private finishEntry(k: number): Crossing | null {
    if (this.inFinish[k] === 1) return null;
    if (this.inFinish[k + 1] === 1 || this.passesThrough(k, this.finishX, this.finishY)) {
      return this.crossing(k, this.finishX, this.finishY, 'entry');
    }
    return this.chainageCrossing(k, this.corridor.lengthM - this.corridor.gateRadiusM);
  }

  /**
   * Длинный шаг по маршруту (`interpolable`, хорда > 2R — может обойти круг ворот): первая отметка `mark` (у петли —
   * с целым числом кругов) внутри (s_k, s_k+1] — пересечение; момент — линейно по `s`.
   */
  private chainageCrossing(k: number, mark: number): Crossing | null {
    const { track, corridor } = this;
    if (track.step[k]! <= 2 * corridor.gateRadiusM || !this.interpolable(k)) return null;
    const s0 = track.s[k]!;
    const s1 = track.s[k + 1]!;
    let position = mark;
    if (corridor.isLoop) {
      const L = corridor.lengthM;
      position = mark + (Math.floor((s0 - mark) / L) + 1) * L;
    }
    if (!(position > s0 && position <= s1)) return null;
    const u = (position - s0) / (s1 - s0);
    const t0 = track.time[k]!;
    return { index: k, u, timeMs: Math.round(t0 + u * (track.time[k + 1]! - t0)) };
  }

  /** Шаг по маршруту: обе точки внутри, `Δgeo ≤ gapMaxM`, `0 ≤ Δs ≤ 1.5·Δgeo + 50`. */
  private interpolable(k: number, fromGate = false): boolean {
    const { track } = this;
    const geo = track.step[k]!;
    const ds = track.s[k + 1]! - track.s[k]!;
    return (
      (fromGate || track.inside[k] === 1) &&
      track.inside[k + 1] === 1 &&
      geo <= CORRIDOR_POLICY.gapMaxM &&
      ds >= 0 &&
      ds <= 1.5 * geo + 50
    );
  }

  /**
   * Длина трека и сход на сегменте: шаги от выхода из ворот старта (доля `start.u`) до точки `endIndex` (последний
   * шаг — до доли `endU`; < 1 — вход в ворота финиша). Шаг целиком снаружи — весь, одна точка снаружи — половина;
   * выход завершается точкой внутри; момент ворот — точка коридора. Шаг «внутри → внутри» — отдельный выход:
   * больше из части хорды вне коридора (точно) и недобранного пути `Δs − хорда` сверх допуска
   * (`chordToleranceM + chordToleranceShare · хорда`) — на каждом шаге, от частоты записи и Δt не зависит.
   * Работа геометрии хорд ограничена правдоподобием трека (`matchCorridor`: средняя скорость ≤ 30 м/с).
   */
  private offCorridor(
    start: Crossing,
    endIndex: number,
    endU: number,
  ): { distanceM: number; offCorridorM: number; maxExcursionM: number; shortfallM: number } {
    const { track } = this;
    const policy = CORRIDOR_POLICY;
    let distanceM = 0;
    let offCorridorM = 0;
    let shortfallM = 0;
    let excursion = 0;
    let maxExcursionM = 0;
    for (let k = start.index + 1; k <= endIndex; k += 1) {
      const from = k - 1 === start.index ? start.u : 0;
      const atEnd = k === endIndex && endU < 1;
      const to = atEnd ? endU : 1;
      const share = Math.max(0, to - from);
      const chord = track.step[k - 1]!;
      const length = chord * share;
      distanceM += length;
      const fromInside = k - 1 === start.index || track.inside[k - 1] === 1;
      const toInside = atEnd || track.inside[k] === 1;
      const outside = (fromInside ? 0 : 1) + (toInside ? 0 : 1);
      let off = outside === 2 ? length : outside === 1 ? length / 2 : 0;
      if (outside === 0 && share > 0) {
        // недобранный путь — на каждом шаге «внутри → внутри», без условия интерполяции покрытия; хорда длиннее
        // gapMaxM — разрыв GPS (`gps_gap`), не сход
        const tolerance = policy.chordToleranceM + policy.chordToleranceShare * chord;
        const shortfall =
          chord > policy.gapMaxM
            ? 0
            : Math.max(0, track.s[k]! - track.s[k - 1]! - chord - tolerance) * share;
        // Δs > 1.5·хорда + 50 редкой записью не объяснить (так короче хорды не бывает дуга) — это сход, не «редкая
        // запись»: `sparse_recording` — только по шагам, где покрытие интерполируется
        const sparse = this.interpolable(k - 1, k - 1 === start.index);
        let geometric = 0;
        if (chord <= policy.gapMaxM) {
          // хорда длиннее — разрыв GPS (gps_gap); точка хорды не дальше половины хорды от конца, конец — не
          // дальше d от маршрута: короткая хорда внутри без расчёта
          const nearest = Math.max(track.d[k - 1]!, track.d[k]!);
          if (chord / 2 + nearest > this.corridor.widthM)
            geometric = this.chordOutside(k - 1, from, to);
        }
        off = Math.max(geometric, shortfall);
        if (sparse && shortfall > geometric) shortfallM += off;
      }
      if (off > 0) {
        offCorridorM += off;
        excursion = fromInside ? off : excursion + off;
        maxExcursionM = Math.max(maxExcursionM, excursion);
      }
      if (toInside) excursion = 0;
    }
    return { distanceM, offCorridorM, maxExcursionM, shortfallM };
  }

  /**
   * Часть хорды шага [k, k + 1] между долями `from` и `to` вне коридора, м — точно: пересечение отрезка с буферами
   * отрезков маршрута.
   */
  private chordOutside(k: number, from: number, to: number): number {
    const full = from === 0 && to === 1;
    if (full && !Number.isNaN(this.chordCache[k]!)) return this.chordCache[k]!;
    // точно и дёшево: оба конца в буфере одного отрезка маршрута (буфер выпуклый) — хорда внутри
    if (full && this.insideOneBuffer(k)) return 0;
    // за лимитом — оценка только длинных хорд (> 2w); короткие (стоянки, дрожание) — всегда точно
    if (
      full &&
      this.chordWork.count >= CORRIDOR_POLICY.maxChordWork &&
      this.track.step[k]! > 2 * this.corridor.widthM
    ) {
      // за лимитом — верхняя оценка: у каждого конца внутри коридора гарантированно (w − d) хорды
      this.geometryLimited = true;
      const w = this.corridor.widthM;
      const inside = Math.max(0, w - this.track.d[k]!) + Math.max(0, w - this.track.d[k + 1]!);
      return Math.max(0, this.track.step[k]! - inside);
    }
    const value = this.exactChordOutside(k, from, to);
    if (full) this.chordCache[k] = value;
    return value;
  }

  private insideOneBuffer(k: number): boolean {
    const { track, corridor } = this;
    const w = corridor.widthM;
    const a = track.points[k]!;
    const b = track.points[k + 1]!;
    const segA = track.nearest[k]!;
    const segB = track.nearest[k + 1]!;
    return (
      (segA >= 0 && segmentDistance(corridor, segA, b.lon, b.lat) <= w) ||
      (segB >= 0 && segmentDistance(corridor, segB, a.lon, a.lat) <= w)
    );
  }

  private exactChordOutside(k: number, from: number, to: number): number {
    const a = this.track.points[k]!;
    const b = this.track.points[k + 1]!;
    return chordOutsideM(
      this.corridor,
      a.lon + (b.lon - a.lon) * from,
      a.lat + (b.lat - a.lat) * from,
      a.lon + (b.lon - a.lon) * to,
      a.lat + (b.lat - a.lat) * to,
      this.gridOut,
      this.visits,
      this.lows,
      this.highs,
      this.chordWork,
    );
  }

  /** Обе точки шага [k, k + 1] вне ворот, а хорда (≤ gapMaxM) проходит сквозь круг. */
  private passesThrough(k: number, xs: Float64Array, ys: Float64Array): boolean {
    if (this.track.step[k]! > CORRIDOR_POLICY.gapMaxM) return false;
    const ax = xs[k]!;
    const ay = ys[k]!;
    const dx = xs[k + 1]! - ax;
    const dy = ys[k + 1]! - ay;
    const a = dx * dx + dy * dy;
    if (a === 0) return false;
    const t = Math.max(0, Math.min(1, -(ax * dx + ay * dy) / a));
    return (ax + t * dx) ** 2 + (ay + t * dy) ** 2 <= this.corridor.gateRadiusM ** 2;
  }

  /** Момент пересечения окружности ворот на шаге [k, k + 1]: корень квадратного уравнения, время — линейно. */
  private crossing(
    k: number,
    xs: Float64Array,
    ys: Float64Array,
    kind: 'exit' | 'entry',
  ): Crossing {
    const ax = xs[k]!;
    const ay = ys[k]!;
    const dx = xs[k + 1]! - ax;
    const dy = ys[k + 1]! - ay;
    const a = dx * dx + dy * dy;
    const b = 2 * (ax * dx + ay * dy);
    const c = ax * ax + ay * ay - this.corridor.gateRadiusM ** 2;
    let u = 0;
    if (a > 0) {
      const root = Math.sqrt(Math.max(0, b * b - 4 * a * c));
      u = kind === 'exit' ? (-b + root) / (2 * a) : (-b - root) / (2 * a);
      u = Math.max(0, Math.min(1, u));
    }
    const t0 = this.track.time[k]!;
    const t1 = this.track.time[k + 1]!;
    return { index: k, u, timeMs: Math.round(t0 + u * (t1 - t0)) };
  }

  private wrongDirection(): boolean {
    return (
      this.directionAbs > 0 &&
      this.directionNeg >= CORRIDOR_POLICY.wrongDirectionShare * this.directionAbs
    );
  }

  private resetCells(): void {
    this.cells.fill(0);
    this.covered = 0;
    this.gapCells = 0;
    this.lastNewCell = -1;
    this.directionNeg = 0;
    this.directionAbs = 0;
  }

  /** Точка внутри коридора покрывает свою ячейку. */
  private cover(k: number): void {
    if (this.track.inside[k] === 1) this.markRange(this.track.s[k]!, this.track.s[k]!, COVERED);
  }

  /**
   * Шаг [k, k + 1]: обе точки внутри, `Δgeo ≤ gapMaxM`, `0 ≤ Δs ≤ 1.5·Δgeo + 50` — покрывает ячейки между ними;
   * `Δgeo > gapMaxM` и движение вперёд — ячейки между точками помечаются разрывом GPS (если не покрыты).
   * `fromGate` — шаг начинается выходом из ворот старта: момент выхода — точка коридора.
   */
  private coverStep(k: number, fromGate = false): void {
    const { track } = this;
    const geo = track.step[k]!;
    const s0 = track.s[k]!;
    const s1 = track.s[k + 1]!;
    const ds = s1 - s0;
    if (geo > CORRIDOR_POLICY.gapMaxM) {
      if (ds > 0) this.markRange(s0, s1, GAP);
      return;
    }
    if (this.interpolable(k, fromGate)) this.markRange(s0, s1, COVERED);
  }

  /** Первая ячейка, целиком лежащая в воротах финиша (`[L − R, L]`): её покрывает сам вход в ворота. */
  private tailStart(): number {
    const from = this.corridor.lengthM - this.corridor.gateRadiusM;
    return Math.ceil(from / CORRIDOR_POLICY.coverageCellM);
  }

  private uncoveredTail(): number {
    let count = 0;
    for (let c = this.tailStart(); c < this.corridor.coverageCells; c += 1) {
      if (this.cells[c] === 0) count += 1;
    }
    return count;
  }

  private coverTail(): void {
    for (let c = this.tailStart(); c < this.corridor.coverageCells; c += 1) this.mark(c, COVERED);
  }

  /** Ячейки от s0 до s1 (s0 ≤ s1) по ходу; петля — по модулю длины. */
  private markRange(s0: number, s1: number, state: number): void {
    const L = this.corridor.lengthM;
    const n = this.corridor.coverageCells;
    if (!this.corridor.isLoop) {
      const c0 = this.cellOf(Math.max(0, Math.min(L, s0)));
      const c1 = this.cellOf(Math.max(0, Math.min(L, s1)));
      for (let c = c0; c <= c1; c += 1) this.mark(c, state);
      return;
    }
    if (s1 - s0 >= L) {
      for (let c = 0; c < n; c += 1) this.mark(c, state);
      return;
    }
    const lap = Math.floor(s0 / L);
    const r0 = s0 - lap * L;
    const r1 = s1 - lap * L;
    if (r1 < L) {
      for (let c = this.cellOf(r0); c <= this.cellOf(r1); c += 1) this.mark(c, state);
    } else {
      for (let c = this.cellOf(r0); c < n; c += 1) this.mark(c, state);
      for (let c = 0; c <= this.cellOf(r1 - L); c += 1) this.mark(c, state);
    }
  }

  private cellOf(position: number): number {
    return Math.max(
      0,
      Math.min(
        this.corridor.coverageCells - 1,
        Math.floor(position / CORRIDOR_POLICY.coverageCellM),
      ),
    );
  }

  /** Направление — по порядку первого покрытия ячеек: обратный ход по уже покрытому не считается. */
  private mark(cell: number, state: number): void {
    const current = this.cells[cell]!;
    if (current === COVERED || current === state) return;
    if (state === GAP) {
      this.cells[cell] = GAP;
      this.gapCells += 1;
      return;
    }
    if (current === GAP) this.gapCells -= 1;
    this.cells[cell] = COVERED;
    this.covered += 1;
    if (this.lastNewCell >= 0) {
      const n = this.corridor.coverageCells;
      let delta = cell - this.lastNewCell;
      if (this.corridor.isLoop) {
        if (delta > n / 2) delta -= n;
        else if (delta < -n / 2) delta += n;
      }
      if (delta < 0) this.directionNeg -= delta;
      this.directionAbs += Math.abs(delta);
    }
    this.lastNewCell = cell;
  }

  /** Самые длинные непрерывные полосы непокрытых ячеек: без данных (разрыв) и пропущенные. */
  private runs(): { missed: number; gap: number } {
    let missed = 0;
    let gap = 0;
    let missedRun = 0;
    let gapRun = 0;
    for (const state of this.cells) {
      missedRun = state === 0 ? missedRun + 1 : 0;
      gapRun = state === GAP ? gapRun + 1 : 0;
      missed = Math.max(missed, missedRun);
      gap = Math.max(gap, gapRun);
    }
    return { missed, gap };
  }
}
