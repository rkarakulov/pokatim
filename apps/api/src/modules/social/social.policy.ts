import type {
  AttendanceVia,
  ConnectionSource,
  SocialActionBlockedDetails,
  SocialBlockReason,
} from '@pokatim/contracts';

import { domainError } from '../../error-messages';
import type { SocialRideFacts } from '../rides';
import type { ConnectionDoc } from './social.collection';

const MINUTE_MS = 60_000;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;

/**
 * Правила «Свои» (`docs/product/social.md`): лимит ручного «В свои» (K11, `consumeUserLimit` `social-manual:<uid>`),
 * лимит ручных отметок явки (`social-attendance:<uid>`), окно ручной явки (K2), пороги автоявки (K2 `[ASSUMPTION]`, P5), «Как прошёл райд?» и повтор уведомления о ручном
 * добавлении (K10, K11 — P7), пачка `bulkWrite` пересчёта связей.
 */
export const SOCIAL_POLICY = {
  manualLimit: { limit: 30, windowSec: 86_400 },
  /** «Я был на райде» и «Меня не было» (P2): общий ключ `social-attendance:<uid>`, на каждую попытку */
  attendanceLimit: { limit: 60, windowSec: 3600 },
  attendanceWindowMs: 7 * DAY_MS,
  autoAttendance: { beforeMs: 30 * MINUTE_MS, afterMs: 2 * HOUR_MS, radiusM: 500 },
  askAfterMs: 4 * HOUR_MS,
  manualRenotifyMs: 30 * DAY_MS,
  bulkBatch: 1000,
} as const;

/** Источники связи из полей документа (K1) в порядке справочника `CONNECTION_SOURCES`. */
export function connectionSources(
  doc: Pick<ConnectionDoc, 'rides' | 'inviteAt' | 'manualAt'>,
): ConnectionSource[] {
  const sources: ConnectionSource[] = [];
  if (doc.rides.length > 0) sources.push('ride');
  if (doc.inviteAt !== null) sources.push('invite');
  if (doc.manualAt !== null) sources.push('manual');
  return sources;
}

/**
 * Можно ли менять явку райдера (K2, RC-15): участник «Иду» или организатор; райд не отменён и не скрыт; ручная
 * отметка и снятие — от старта до +7 дней (по треку окна нет). `null` — можно.
 */
export function attendanceCheck(
  facts: SocialRideFacts,
  userId: string,
  now: Date,
  via: AttendanceVia = 'manual',
): SocialBlockReason | null {
  if (!facts.participantIds.includes(userId)) return 'not_participant';
  if (facts.phase === 'hidden' || facts.phase === 'cancelled') return 'ride_unavailable';
  if (via === 'track') return null;
  const closesAt = facts.startsAt.getTime() + SOCIAL_POLICY.attendanceWindowMs;
  if (facts.phase === 'upcoming' || now.getTime() > closesAt) return 'attendance_window';
  return null;
}

export interface ConnectionPair {
  ownerId: string;
  otherId: string;
}

/**
 * Пары связи `ride` райда (K2): каждая направленная пара явившихся. `add` — пар ещё нет у райда, `remove` — у райда
 * есть, а один из пары уже не явился.
 */
export function rideConnectionDiff(
  attendees: readonly string[],
  existing: readonly ConnectionPair[],
): { add: ConnectionPair[]; remove: ConnectionPair[] } {
  const present = new Set(attendees);
  const key = (pair: ConnectionPair) => `${pair.ownerId}\u0000${pair.otherId}`;
  const existingKeys = new Set(existing.map(key));
  const add: ConnectionPair[] = [];
  for (const ownerId of present) {
    for (const otherId of present) {
      if (ownerId === otherId) continue;
      const pair = { ownerId, otherId };
      if (!existingKeys.has(key(pair))) add.push(pair);
    }
  }
  const remove = existing.filter(
    (pair) => !present.has(pair.ownerId) || !present.has(pair.otherId),
  );
  return { add, remove };
}

/** Отказ домена «Свои»: `409 SOCIAL_ACTION_BLOCKED { reason }`. */
export const socialBlocked = (reason: SocialBlockReason) =>
  domainError('SOCIAL_ACTION_BLOCKED', 409, { reason } satisfies SocialActionBlockedDetails);
