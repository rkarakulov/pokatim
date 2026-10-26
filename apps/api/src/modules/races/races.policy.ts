import { corridorGateRadiusM } from '@pokatim/tracks';
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

import type { PanelPrincipal } from '../panel';
import type { ReadyRoute } from '../routes';
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

/**
 * Поля, зафиксированные первой заявкой участника (V-12, race-results-03): коридор, окно (оба конца — продление тоже,
 * A14), класс, покрытия. Строже V-11 и применяется поверх него.
 */
export const LOCKED_BY_ENTRIES: readonly RaceField[] = [
  'corridor',
  'windowStartsAt',
  'windowEndsAt',
  'bikeClass',
  'surfaces',
];

/** Есть заявки (`lockedAt` пишет первая заявка); документы до `0015_results` поля не имеют. */
export const entriesLocked = (race: Pick<RaceDoc, 'lockedAt'>): boolean =>
  (race.lockedAt ?? null) !== null;

/** Поля, которые можно менять у опубликованной гонки с закрытым окном (V-11). */
const CLOSED_WINDOW_FIELDS: readonly RaceField[] = ['description', 'protocolPlannedAt'];

const windowClosesAt = (race: Pick<RaceDoc, 'windowEndsAt'>) =>
  race.windowEndsAt.getTime() + RACE_POLICY.windowEndGraceMs;

/** Протокол гонки опубликован (race-results-05); документы до `0016_protocol` поля не имеют. */
export const protocolPublished = (race: { protocolPublishedAt?: Date | null }): boolean =>
  (race.protocolPublishedAt ?? null) !== null;

/** Фаза гонки по статусу, окну и публикации протокола (R5; `final` — race-results-05). */
export function racePhase(
  race: Pick<RaceDoc, 'status' | 'windowStartsAt' | 'windowEndsAt'> & {
    protocolPublishedAt?: Date | null;
  },
  now: Date,
): RacePhase {
  if (race.status === 'draft') return 'draft';
  if (race.status === 'cancelled') return 'cancelled';
  if (protocolPublished(race)) return 'final';
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

/**
 * Видимость гонок панели по правам (R8, Q3): с `races.manage_any` — все; с `races.manage` без него (организатор) —
 * только свои; только чтение (`races.read`, модератор) — все. Чужая невидимая гонка — 404 (существование не
 * раскрываем). Одна функция для `races` и порта `RaceRegistry` (результаты гонки в панели).
 */
export function ownScope(principal: Pick<PanelPrincipal, 'permissions'>): boolean {
  return (
    principal.permissions.includes('races.manage') &&
    !principal.permissions.includes('races.manage_any')
  );
}

export function raceVisible(
  principal: Pick<PanelPrincipal, 'permissions' | 'userId'>,
  race: Pick<RaceDoc, 'ownerUserId'>,
): boolean {
  return !ownScope(principal) || race.ownerUserId === principal.userId;
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

/** Поля опубликованного протокола (race-results-05): только описание. */
const FINAL_FIELDS: readonly RaceField[] = ['description'];

/** Поля, которые опубликованная гонка позволяет менять в своей фазе; `locked` — есть заявки (V-12). */
function publishedFields(phase: RacePhase, locked: boolean): RaceField[] {
  const fields =
    phase === 'upcoming'
      ? [...RACE_FIELDS]
      : phase === 'open'
        ? RACE_FIELDS.filter((field) => field !== 'windowStartsAt')
        : phase === 'final'
          ? [...FINAL_FIELDS]
          : [...CLOSED_WINDOW_FIELDS];
  return locked ? fields.filter((field) => !LOCKED_BY_ENTRIES.includes(field)) : fields;
}

/**
 * Можно ли менять коридор (race-results-01 §5): черновик и до окна — да; открытое окно — только гонке без коридора
 * (анонсу); закрытое окно — нет; есть заявки (V-12) — нет.
 */
function corridorEditable(race: RaceDoc, phase: RacePhase): boolean {
  if (entriesLocked(race)) return false;
  if (race.status === 'draft' || phase === 'upcoming') return true;
  return phase === 'open' && corridorOf(race) === null;
}

/** Можно ли сейчас менять коридор гонки (до проверки маршрута: зафиксированный коридор маршрут не проверяет). */
export function corridorChangeAllowed(race: RaceDoc, now: Date): boolean {
  return corridorEditable(race, racePhase(race, now));
}

/**
 * Ворота коридора (то же, что `assert` движка `gates overlap`, но при выборе коридора, а не в каждой попытке):
 * линейный маршрут с концами не дальше `2 · corridorGateRadiusM(widthM)` — `CORRIDOR_GATES_OVERLAP`.
 */
export function validateCorridorRoute(
  route: Pick<ReadyRoute, 'isLoop' | 'endsDistanceM'>,
  widthM: number,
): FieldIssue | null {
  if (route.isLoop || route.endsDistanceM > 2 * corridorGateRadiusM(widthM)) return null;
  return { path: 'corridor.routeId', code: 'CORRIDOR_GATES_OVERLAP' };
}

/**
 * Правила формы гонки (создание и каждое изменение) и V-11 для опубликованной: `prev` — текущий документ или
 * `null` (создание). Порядок ошибок стабилен (по полям).
 */
export function validateRaceRules(next: RaceValues, prev: RaceDoc | null, now: Date): FieldIssue[] {
  const issues: FieldIssue[] = [];

  if (prev && prev.status !== 'published' && changedRaceFields(prev, next).includes('corridor')) {
    if (!corridorEditable(prev, racePhase(prev, now))) {
      issues.push({ path: 'corridor', code: 'FIELD_LOCKED' });
    }
  }
  if (prev?.status === 'published') {
    const phase = racePhase(prev, now);
    const allowed = publishedFields(phase, entriesLocked(prev)).filter(
      (field) => field !== 'corridor' || corridorEditable(prev, phase),
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
  { canManage, seasonFound }: { canManage: boolean; seasonFound: boolean },
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
      fields: editableFields(race, [...RACE_FIELDS], 'draft'),
      canPublish: reasons.length === 0,
      canCancel: false,
      canDiscard: true,
      reasons,
    };
  }

  const phase = racePhase(race, now);
  const locked = entriesLocked(race);
  // протокол опубликован: только описание, отмена недоступна (D-19); `window_closed` не показывается (RC-6)
  const reasons: RaceEditBlockReason[] =
    phase === 'open'
      ? ['window_open']
      : phase === 'closed'
        ? ['window_closed']
        : phase === 'final'
          ? ['results_final']
          : [];
  if (locked) reasons.push('entries_locked');
  return {
    ...none,
    fields: editableFields(race, publishedFields(phase, locked), phase),
    canCancel: phase !== 'final',
    reasons,
  };
}

/** Поля фазы с правилами коридора: с коридором `distanceKm` вычисляется сервером — не в `fields`. */
function editableFields(race: RaceDoc, fields: RaceField[], phase: RacePhase): RaceField[] {
  const hasCorridor = corridorOf(race) !== null;
  return fields.filter((field) => {
    if (field === 'distanceKm') return !hasCorridor;
    if (field === 'corridor') return corridorEditable(race, phase);
    return true;
  });
}
