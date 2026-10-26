import type {
  DisputeCategory,
  DisputeDecisionTemplate,
  DisputeEventKind,
  DisputeOutcome,
  DisputeStatus,
  ResultGroupKey,
} from '@pokatim/contracts';
import type { Collection, Db } from 'mongodb';

/**
 * Споры по результатам гонки (race-results-06). Создаёт миграция `0018_disputes`; единственный писатель —
 * `DisputesRepository`. Время — BSON `Date` (UTC) из `CLOCK`, nullable — явным `null`.
 */
export const DISPUTES_COLLECTIONS = { disputes: 'disputes', events: 'dispute_events' } as const;

/**
 * Спор — проекция текущего состояния (RC-8): переходы только из `open` (`updateOne` с `status: 'open'` в фильтре,
 * `$set` — только `status`/`response`/`decision`/`closedAt`/`updatedAt`, `$inc version`); содержание подачи
 * (категория, описание, участники) не меняется, удалений и замен нет. История решений — append-only
 * `dispute_events`. Один спор на (гонка, заявитель, цель) — уникальный индекс `disputes_pair_unique`.
 */
export interface DisputeDoc {
  _id: string;
  raceId: string;
  groupKey: ResultGroupKey;
  complainantUserId: string;
  complainantEntryId: string;
  targetEntryId: string;
  targetUserId: string;
  category: DisputeCategory;
  /** видит только команда платформы (D-51) */
  description: string | null;
  status: DisputeStatus;
  /** ответ участника-цели (один раз); заявителю не уходит (D-51) */
  response: { text: string; at: Date } | null;
  decision: {
    outcome: DisputeOutcome;
    template: DisputeDecisionTemplate;
    /** внутренняя заметка — только команде */
    note: string | null;
    actorUserId: string;
    at: Date;
  } | null;
  filedAt: Date;
  closedAt: Date | null;
  version: number;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * Событие истории спора — только вставка (сторож `disputes.repository.test.ts`). Свободного текста нет: описание,
 * ответ и заметка лежат только в документе спора.
 */
export interface DisputeEventDoc {
  _id: string;
  disputeId: string;
  raceId: string;
  kind: DisputeEventKind;
  actor: { kind: 'rider' | 'staff'; userId: string };
  at: Date;
  payload: { outcome?: DisputeOutcome; template?: DisputeDecisionTemplate };
}

export interface DisputesCollections {
  disputes: Collection<DisputeDoc>;
  events: Collection<DisputeEventDoc>;
}

export function disputesCollections(db: Db): DisputesCollections {
  return {
    disputes: db.collection<DisputeDoc>(DISPUTES_COLLECTIONS.disputes),
    events: db.collection<DisputeEventDoc>(DISPUTES_COLLECTIONS.events),
  };
}
