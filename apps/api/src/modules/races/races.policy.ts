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

import type { RaceDoc, SeasonDoc } from './races.collection';

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

const sameValue = (a: unknown, b: unknown): boolean => {
  if (a instanceof Date && b instanceof Date) return a.getTime() === b.getTime();
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
 * Правила формы гонки (создание и каждое изменение) и V-11 для опубликованной: `prev` — текущий документ или
 * `null` (создание). Порядок ошибок стабилен (по полям).
 */
export function validateRaceRules(next: RaceValues, prev: RaceDoc | null, now: Date): FieldIssue[] {
  const issues: FieldIssue[] = [];

  if (prev?.status === 'published') {
    const phase = racePhase(prev, now);
    const allowed = publishedFields(phase);
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
      fields: [...RACE_FIELDS],
      canPublish: reasons.length === 0,
      canCancel: false,
      canDiscard: true,
      reasons,
    };
  }

  const phase = racePhase(race, now);
  const reasons: RaceEditBlockReason[] =
    phase === 'open' ? ['window_open'] : phase === 'closed' ? ['window_closed'] : [];
  return { ...none, fields: publishedFields(phase), canCancel: true, reasons };
}
