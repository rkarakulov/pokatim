import {
  RACE_FIELDS,
  RACE_PROTOCOL_MIN_DELAY_HOURS,
  type FieldErrorCode,
  type RaceEditable,
  type RaceEditBlockReason,
  type RaceField,
  type RacePhase,
  type SeasonPhase,
} from '@pokatim/contracts';

import type { RaceCorridor, RaceDoc, SeasonDoc } from './races.collection';

/**
 * Правила гонок и сезонов — чистые функции (unit, ADR-0010). Источник истины — сервер; UI получает итог в
 * `PanelRace.editable` и коды полей ошибок.
 */
export const RACE_POLICY = {
  protocolMinDelayMs: RACE_PROTOCOL_MIN_DELAY_HOURS * 3_600_000,
  /** Длина окна ≤ 60 суток (`[ASSUMPTION]`). */
  windowMaxMs: 60 * 86_400_000,
  /** Окно включает последнюю минуту (R12): открыто, пока `now < windowEndsAt + 1 мин`. */
  windowEndGraceMs: 60_000,
} as const;

/** Значения полей гонки (моменты — `Date`), из запроса или документа. */
export type RaceValues = Pick<RaceDoc, RaceField>;

/** Ошибка поля для `VALIDATION_FAILED.details.fields`. */
export interface FieldIssue {
  path: string;
  code: FieldErrorCode;
}

/** Поля, которые можно менять у опубликованной гонки с закрытым окном (V-11). */
const CLOSED_WINDOW_FIELDS: readonly RaceField[] = ['description', 'protocolPlannedAt'];

const windowClosesAt = (race: Pick<RaceDoc, 'windowEndsAt'>) =>
  race.windowEndsAt.getTime() + RACE_POLICY.windowEndGraceMs;

/** Фаза гонки по статусу и окну (R5). */
export function racePhase(
  race: Pick<RaceDoc, 'status' | 'windowStartsAt' | 'windowEndsAt'>,
  now: Date,
): RacePhase {
  if (race.status === 'draft') return 'draft';
  if (race.status === 'cancelled') return 'cancelled';
  if (now < race.windowStartsAt) return 'upcoming';
  return now.getTime() < windowClosesAt(race) ? 'open' : 'closed';
}

/** Фаза сезона по границам-моментам Минска. */
export function seasonPhase(
  season: Pick<SeasonDoc, 'startsAt' | 'endsBefore'>,
  now: Date,
): SeasonPhase {
  if (now < season.startsAt) return 'upcoming';
  return now < season.endsBefore ? 'current' : 'finished';
}

/** Окно уже закрылось на `now` (опубликовать нельзя, `WINDOW_IN_PAST`). */
export function windowPassed(race: Pick<RaceDoc, 'windowEndsAt'>, now: Date): boolean {
  return windowClosesAt(race) <= now.getTime();
}

/** Дистанция гонки с коридором — длина маршрута, км с точностью 0,1 (сервер — авторитет, Q7). */
export const corridorDistanceKm = (corridor: Pick<RaceCorridor, 'distanceM'>): number =>
  Math.round(corridor.distanceM / 100) / 10;

/** Коридор документа (до миграции `0013_routes` поля нет — как без коридора). */
const corridorOf = (race: Pick<RaceValues, 'corridor'>): RaceCorridor | null =>
  race.corridor ?? null;

const isCorridor = (value: unknown): value is RaceCorridor =>
  typeof value === 'object' && value !== null && 'routeId' in value;

const sameValue = (a: unknown, b: unknown): boolean => {
  if (a instanceof Date && b instanceof Date) return a.getTime() === b.getTime();
  // коридор — по маршруту и допуску: снимок длины следует из маршрута
  if (isCorridor(a) && isCorridor(b)) return a.routeId === b.routeId && a.widthM === b.widthM;
  if (a === undefined || b === undefined) return (a ?? null) === (b ?? null);
  if (Array.isArray(a) && Array.isArray(b)) {
    return a.length === b.length && a.every((item, index) => item === b[index]);
  }
  return a === b;
};

/** Имена изменённых полей (для журнала и проверки V-11) — в порядке `RACE_FIELDS`. */
export function changedRaceFields(prev: RaceValues, next: RaceValues): RaceField[] {
  return RACE_FIELDS.filter((field) => !sameValue(prev[field], next[field]));
}

/** Поля, которые опубликованная гонка позволяет менять в своей фазе. */
function publishedFields(phase: RacePhase): RaceField[] {
  if (phase === 'upcoming') return [...RACE_FIELDS];
  if (phase === 'open') return RACE_FIELDS.filter((field) => field !== 'windowStartsAt');
  return [...CLOSED_WINDOW_FIELDS];
}

/**
 * Можно ли менять коридор (race-results-01 §5): черновик и до окна — да; открытое окно — только гонке без коридора
 * (анонсу); закрытое окно — нет. `locked` — точка расширения слайса 03 («есть заявки»), сейчас всегда `false`.
 */
function corridorEditable(race: RaceDoc, phase: RacePhase, locked: boolean): boolean {
  if (locked) return false;
  if (race.status === 'draft' || phase === 'upcoming') return true;
  return phase === 'open' && corridorOf(race) === null;
}

/** Можно ли сейчас менять коридор гонки (до проверки маршрута: зафиксированный коридор маршрут не проверяет). */
export function corridorChangeAllowed(race: RaceDoc, now: Date, locked = false): boolean {
  return corridorEditable(race, racePhase(race, now), locked);
}

/** Фиксация полей с первой заявки (V-12) добавит слайс 03; здесь — всегда `false`. */
export interface RaceLockOptions {
  locked?: boolean;
}

/**
 * Правила формы гонки (создание и каждое изменение) и V-11 для опубликованной: `prev` — текущий документ или
 * `null` (создание). Порядок ошибок стабилен (по полям).
 */
export function validateRaceRules(
  next: RaceValues,
  prev: RaceDoc | null,
  now: Date,
  { locked = false }: RaceLockOptions = {},
): FieldIssue[] {
  const issues: FieldIssue[] = [];

  if (prev && prev.status !== 'published' && changedRaceFields(prev, next).includes('corridor')) {
    if (!corridorEditable(prev, racePhase(prev, now), locked)) {
      issues.push({ path: 'corridor', code: 'FIELD_LOCKED' });
    }
  }
  if (prev?.status === 'published') {
    const phase = racePhase(prev, now);
    const allowed = publishedFields(phase).filter(
      (field) => field !== 'corridor' || corridorEditable(prev, phase, locked),
    );
    const changed = changedRaceFields(prev, next);
    for (const field of changed) {
      if (!allowed.includes(field)) issues.push({ path: field, code: 'FIELD_LOCKED' });
    }
    if (changed.includes('windowStartsAt') && allowed.includes('windowStartsAt')) {
      if (next.windowStartsAt < now)
        issues.push({ path: 'windowStartsAt', code: 'WINDOW_IN_PAST' });
    }
    if (changed.includes('windowEndsAt') && allowed.includes('windowEndsAt')) {
      if (windowPassed(next, now)) issues.push({ path: 'windowEndsAt', code: 'WINDOW_IN_PAST' });
    }
    if (
      phase === 'closed' &&
      changed.includes('protocolPlannedAt') &&
      next.protocolPlannedAt < prev.protocolPlannedAt
    ) {
      issues.push({ path: 'protocolPlannedAt', code: 'PROTOCOL_ONLY_LATER' });
    }
  }

  // с коридором дистанцию вычисляет сервер: другое значение в запросе — поле зафиксировано
  const corridor = corridorOf(next);
  if (
    corridor !== null &&
    next.distanceKm !== corridorDistanceKm(corridor) &&
    !issues.some((issue) => issue.path === 'distanceKm')
  ) {
    issues.push({ path: 'distanceKm', code: 'FIELD_LOCKED' });
  }

  const windowMs = next.windowEndsAt.getTime() - next.windowStartsAt.getTime();
  if (windowMs <= 0) issues.push({ path: 'windowEndsAt', code: 'DATE_ORDER' });
  else if (windowMs > RACE_POLICY.windowMaxMs)
    issues.push({ path: 'windowEndsAt', code: 'INVALID' });

  if (
    next.protocolPlannedAt.getTime() <
    next.windowEndsAt.getTime() + RACE_POLICY.protocolMinDelayMs
  ) {
    issues.push({ path: 'protocolPlannedAt', code: 'PROTOCOL_TOO_EARLY' });
  }
  return issues;
}

/**
 * Что можно делать с гонкой сейчас (R10). `canManage` — у сотрудника есть право менять эту гонку (свою или
 * `races.manage_any`); `seasonFound` — конец окна черновика попадает в сезон (предпросмотр).
 */
export function raceEditable(
  race: RaceDoc,
  now: Date,
  {
    canManage,
    seasonFound,
    locked = false,
  }: { canManage: boolean; seasonFound: boolean } & RaceLockOptions,
): RaceEditable {
  const none: RaceEditable = {
    fields: [],
    canPublish: false,
    canCancel: false,
    canDiscard: false,
    reasons: [],
  };
  if (!canManage) return none;
  if (race.status === 'cancelled') return { ...none, reasons: ['cancelled'] };

  if (race.status === 'draft') {
    const reasons: RaceEditBlockReason[] = [];
    if (windowPassed(race, now)) reasons.push('window_closed');
    if (!seasonFound) reasons.push('outside_season');
    return {
      fields: editableFields(race, [...RACE_FIELDS], 'draft', locked),
      canPublish: reasons.length === 0,
      canCancel: false,
      canDiscard: true,
      reasons,
    };
  }

  const phase = racePhase(race, now);
  const reasons: RaceEditBlockReason[] =
    phase === 'open' ? ['window_open'] : phase === 'closed' ? ['window_closed'] : [];
  return {
    ...none,
    fields: editableFields(race, publishedFields(phase), phase, locked),
    canCancel: true,
    reasons,
  };
}

/** Поля фазы с правилами коридора: с коридором `distanceKm` вычисляется сервером — не в `fields`. */
function editableFields(
  race: RaceDoc,
  fields: RaceField[],
  phase: RacePhase,
  locked: boolean,
): RaceField[] {
  const hasCorridor = corridorOf(race) !== null;
  return fields.filter((field) => {
    if (field === 'distanceKm') return !hasCorridor;
    if (field === 'corridor') return corridorEditable(race, phase, locked);
    return true;
  });
}
