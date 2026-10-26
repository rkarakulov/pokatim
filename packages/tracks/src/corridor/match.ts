import { localProjection } from '../geo.ts';
import type { ParsedPoint } from '../track.ts';
import { CORRIDOR_ENGINE_VERSION, CORRIDOR_POLICY } from './policy.ts';
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
  distanceM: number;
  offCorridorM: number;
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

  if (starts.length === 0) {
    const reason: CorridorRejection = engine.wholeTrackWrongDirection()
      ? 'wrong_direction'
      : 'no_start';
    return result('rejected', [reason], null, touchedCorridor, 0);
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
  if (bestCounted !== null)
    return result('counted', [], bestCounted, touchedCorridor, starts.length);
  return result(
    'rejected',
    bestRejected!.reasons,
    bestRejected!.segment,
    touchedCorridor,
    starts.length,
  );
}

function result(
  verdict: CorridorMatch['verdict'],
  reasons: CorridorRejection[],
  segment: CorridorSegment | null,
  touchedCorridor: boolean,
  candidates: number,
): CorridorMatch {
  return {
    engineVersion: CORRIDOR_ENGINE_VERSION,
    verdict,
    reasons,
    segment,
    touchedCorridor,
    candidates,
  };
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

  constructor(
    private readonly corridor: PreparedCorridor,
    private readonly track: ProjectedTrack,
  ) {
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
  }

  /** Выходы из ворот старта вперёд по маршруту; подряд в пределах 60 с — последний; не больше 20. */
  startCandidates(): Crossing[] {
    const { track } = this;
    const exits: Crossing[] = [];
    for (let k = 0; k + 1 < track.count; k += 1) {
      if (this.inStart[k] !== 1 || this.inStart[k + 1] === 1) continue;
      if (track.s[k + 1]! < track.s[k]!) continue;
      const crossing = this.crossing(k, this.gateX, this.gateY, 'exit');
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
    if (
      segment.offCorridorShare > policy.maxOffCorridorShare ||
      segment.maxExcursionM > policy.maxExcursionM
    ) {
      reasons.push('off_corridor');
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
    const { track, corridor } = this;
    const n = corridor.coverageCells;
    this.resetCells();
    let distanceM = 0;
    let offCorridorM = 0;
    let excursion = 0;
    let maxExcursionM = 0;
    let finish: Crossing | null = null;
    let lastEarlyEntry: Crossing | null = null;
    let endIndex = lastIndex;
    this.cover(start.index);

    for (let k = start.index + 1; k <= lastIndex; k += 1) {
      this.cover(k);
      this.coverStep(k - 1);
      const entering = this.inFinish[k - 1] !== 1 && this.inFinish[k] === 1;
      let entry: Crossing | null = null;
      if (entering) entry = this.crossing(k - 1, this.finishX, this.finishY, 'entry');
      const isFinish =
        entering &&
        findFinish &&
        (this.covered + this.gapCells + this.uncoveredTail()) / n >= CORRIDOR_POLICY.coverageMin;
      const partialEnd = !findFinish && k === lastIndex && entering;

      const from = k - 1 === start.index ? start.u : 0;
      const to = isFinish || partialEnd ? entry!.u : 1;
      const length = track.step[k - 1]! * Math.max(0, to - from);
      distanceM += length;
      const outside = (track.inside[k - 1] === 1 ? 0 : 1) + (track.inside[k] === 1 ? 0 : 1);
      if (outside === 0) {
        excursion = 0;
      } else {
        const off = outside === 2 ? length : length / 2;
        offCorridorM += off;
        excursion += off;
        maxExcursionM = Math.max(maxExcursionM, excursion);
      }

      if (isFinish || partialEnd) this.coverTail();
      if (isFinish) {
        finish = entry;
        endIndex = k;
        break;
      }
      if (entering && findFinish) lastEarlyEntry = entry;
    }

    const runs = this.runs();
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
      maxExcursionM,
      maxMissedRun: runs.missed,
      maxGapRun: runs.gap,
    };
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
   */
  private coverStep(k: number): void {
    const { track } = this;
    const geo = track.step[k]!;
    const s0 = track.s[k]!;
    const s1 = track.s[k + 1]!;
    const ds = s1 - s0;
    if (geo > CORRIDOR_POLICY.gapMaxM) {
      if (ds > 0) this.markRange(s0, s1, GAP);
      return;
    }
    if (track.inside[k] === 1 && track.inside[k + 1] === 1 && ds >= 0 && ds <= 1.5 * geo + 50) {
      this.markRange(s0, s1, COVERED);
    }
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
