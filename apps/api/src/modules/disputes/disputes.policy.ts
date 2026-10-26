import {
  DISPUTE_DECISION_DELAY_HOURS,
  DISPUTE_FILING_LEAD_HOURS,
  DISPUTE_OPEN_LIMIT,
  type DisputeDecideBlock,
  type DisputeFileBlock,
  type DisputeFilingStatus,
} from '@pokatim/contracts';

import type { RaceForResults } from '../races';
import type { DisputeEntry } from '../results';
import type { DisputeDoc } from './disputes.collection';

const HOUR_MS = 3_600_000;

/** Правила споров (race-results-06) — чистые функции (unit). Значения `[ASSUMPTION]` — R2, §7.1, §7.4. */
export const DISPUTES_POLICY = {
  filingLeadMs: DISPUTE_FILING_LEAD_HOURS * HOUR_MS,
  decisionDelayMs: DISPUTE_DECISION_DELAY_HOURS * HOUR_MS,
  openLimit: DISPUTE_OPEN_LIMIT,
  /** мутации райдера: подача, отзыв, ответ */
  userLimit: { limit: 20, windowSec: 3600 },
  /** решения сотрудника */
  panelUserLimit: { limit: 60, windowSec: 3600 },
} as const;

/**
 * Ряды пульса и мощности на разборе спора (race-results-06b): TTL кэша Redis, постановки и отметки журнала, лимит
 * постановок сотрудника, повторы задачи. Опрос «готовится» лимит не тратит.
 */
export const DISPUTE_SERIES_POLICY = {
  readyTtlSec: 15 * 60,
  failedTtlSec: 2 * 60,
  /**
   * Ключ постановки живёт дольше окна опроса панели (3 мин): ожидание слота семафора потоков (общего со сверкой
   * попыток) не ограничено, и при очереди сверок задача ждёт минуты. Процессор снимает ключ в конце; истёк (worker
   * упал) — следующий запрос ставит задачу снова.
   */
  pendingTtlSec: 10 * 60,
  /** журнал `disputes.series_viewed` — не чаще раза в час на (сотрудник, спор) */
  viewedTtlSec: 60 * 60,
  staffLimit: { limit: 30, windowSec: 3600 },
  jobAttempts: 2,
  jobBackoffMs: 5_000,
} as const;

/** D-44 (RC-7): приём закрывается зафиксированной отсечкой или за 24 ч до плановой публикации (исключающая граница). */
export function filingClosesAt(
  race: Pick<RaceForResults, 'protocolPlannedAt' | 'disputeFilingClosedAt'>,
): Date {
  return (
    race.disputeFilingClosedAt ??
    new Date(race.protocolPlannedAt.getTime() - DISPUTES_POLICY.filingLeadMs)
  );
}

/** D-25: решение — не раньше 12 ч после подачи. */
export function decidableAt(filedAt: Date): Date {
  return new Date(filedAt.getTime() + DISPUTES_POLICY.decisionDelayMs);
}

/**
 * Почему заявитель не может подать спор в гонке; `null` — может. Порядок: гонка отменена → протокол опубликован →
 * нет заявки → отменил участие → DQ → нет засчитанного → срок прошёл → лимит открытых.
 */
export function fileBlock(input: {
  race: RaceForResults;
  now: Date;
  complainant: DisputeEntry | null;
  openByComplainant: number;
}): DisputeFileBlock | null {
  const { race, now, complainant } = input;
  if (race.status === 'cancelled') return 'cancelled';
  if (race.protocolPublishedAt !== null) return 'protocol_published';
  if (!complainant) return 'not_entered';
  if (complainant.status === 'withdrawn') return 'withdrawn';
  if (complainant.disqualified) return 'disqualified';
  if (!complainant.best) return 'no_counted_result';
  if (now >= filingClosesAt(race)) return 'filing_closed';
  if (input.openByComplainant >= DISPUTES_POLICY.openLimit) return 'open_limit';
  return null;
}

/** `filing.status` (RC-10): `closed` — мог бы подать, но срок / публикация / лимит (M1); иначе `unavailable`. */
export function filingStatus(block: DisputeFileBlock | null): DisputeFilingStatus {
  if (block === null) return 'open';
  return block === 'filing_closed' || block === 'protocol_published' || block === 'open_limit'
    ? 'closed'
    : 'unavailable';
}

/** Цель спора: своя заявка — `own_result`; нет, другой гонки или группы, не активна, без лучшего, DQ — не засчитана. */
export function targetBlock(
  complainant: DisputeEntry,
  target: DisputeEntry | null,
  raceId: string,
): 'own_result' | 'target_not_counted' | null {
  if (!target || target.raceId !== raceId) return 'target_not_counted';
  if (target.id === complainant.id) return 'own_result';
  if (
    target.groupKey !== complainant.groupKey ||
    target.status !== 'active' ||
    !target.best ||
    target.disqualified
  ) {
    return 'target_not_counted';
  }
  return null;
}

/**
 * Почему решение недоступно (`decideBlockedBy` и `409 DISPUTE_ACTION_BLOCKED`): спор закрыт → гонка отменена →
 * протокол опубликован → раньше `filedAt + 12 ч` (D-25).
 */
export function decideBlock(
  dispute: Pick<DisputeDoc, 'status' | 'filedAt'>,
  race: Pick<RaceForResults, 'status' | 'protocolPublishedAt'>,
  now: Date,
): DisputeDecideBlock | null {
  if (dispute.status !== 'open') return 'not_open';
  if (race.status === 'cancelled') return 'cancelled';
  if (race.protocolPublishedAt !== null) return 'protocol_published';
  if (now < decidableAt(dispute.filedAt)) return 'too_early';
  return null;
}
