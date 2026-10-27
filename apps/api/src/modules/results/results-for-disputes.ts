import { Inject, Injectable } from '@nestjs/common';
import { CLOCK, type Clock } from '@rkarakulov/api-kit/core';
import { uuidv7 } from '@rkarakulov/api-kit/mongo';

import type { DbSession } from '../../db';
import type { RaceForResults } from '../races';
import type { RaceEntryDoc } from './results.collection';
import { rowFlags, speedClusterFlags } from './results.policy';
import type {
  DisputeEntry,
  DisputeStanding,
  ResultsForDisputes,
  SeriesSegment,
} from './results-for-disputes.port';
import { ResultsReadService } from './results-read.service';
import { ResultsRepository } from './results.repository';

const toEntry = (doc: RaceEntryDoc): DisputeEntry => ({
  id: doc._id,
  raceId: doc.raceId,
  userId: doc.userId,
  groupKey: doc.groupKey,
  status: doc.status,
  best: doc.best ? { elapsedSec: doc.best.elapsedSec, startedAt: doc.best.startedAt } : null,
  // поле — DQ по спору до публикации; после публикации `disputes` гонку уже отклоняет (RC-3)
  disqualified: (doc.disqualified ?? null) !== null,
  // race-results-07: заявки до 07 — Verified с местом (RC-7)
  tier: doc.tier ?? 'verified',
  ranked: doc.best !== null && (doc.tier ?? 'verified') === 'verified' && (doc.best.ranked ?? true),
});

/**
 * Реализация порта `ResultsForDisputes` (race-results-06): заявки и замок заявки — `ResultsRepository`; DQ до
 * публикации (D-43) — поле заявки и запись журнала пересчётов `revision: null` в транзакции решения; место цели — тот
 * же код, что «моё участие» (`ResultsReadService.entryResult`), без второго расчёта мест.
 */
@Injectable()
export class ResultsForDisputesService implements ResultsForDisputes {
  constructor(
    private readonly repository: ResultsRepository,
    private readonly read: ResultsReadService,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  async entryOf(raceId: string, userId: string, session?: DbSession): Promise<DisputeEntry | null> {
    const doc = await this.repository.findEntry(raceId, userId, session);
    return doc ? toEntry(doc) : null;
  }

  async entry(entryId: string, session?: DbSession): Promise<DisputeEntry | null> {
    const doc = await this.repository.findEntryById(entryId, session);
    return doc ? toEntry(doc) : null;
  }

  async lockEntry(tx: DbSession, entryId: string, now: Date): Promise<DisputeEntry | null> {
    const doc = await this.repository.lockEntry(tx, entryId, now);
    return doc ? toEntry(doc) : null;
  }

  async disqualify(
    tx: DbSession,
    input: { raceId: string; entryId: string; disputeId: string; actorUserId: string; at: Date },
  ): Promise<boolean> {
    const marked = await this.repository.disqualifyEntry(tx, input.raceId, input.entryId, {
      at: input.at,
      disputeId: input.disputeId,
    });
    if (!marked) return false;
    // источник «действующих DQ» для протокола — журнал (DV-13 05): запись до публикации — без ревизии
    await this.repository.insertRecalculation(tx, {
      _id: uuidv7(),
      raceId: input.raceId,
      kind: 'disqualified',
      entryId: input.entryId,
      revision: null,
      reason: `dispute:${input.disputeId}`,
      actorUserId: input.actorUserId,
      at: input.at,
    });
    return true;
  }

  standing(race: RaceForResults, entryId: string): Promise<DisputeStanding | null> {
    const now = this.clock.now();
    return this.repository.withSnapshot(async (session) => {
      const entry = await this.repository.findEntryById(entryId, session);
      if (!entry || entry.raceId !== race.id) return null;
      const result = await this.read.entryResult(race, entry, now, session);
      // живые флаги цели: датчики лучшей попытки + скорость по строкам с местом всех групп
      const speed = speedClusterFlags(
        (await this.repository.rankedEntries(race.id, session)).map((row) => ({
          entryId: row._id,
          groupKey: row.groupKey,
          elapsedSec: row.best.elapsedSec,
        })),
      );
      return {
        resultStatus: result.status,
        place: result.place,
        tied: result.tied,
        elapsedSec: result.elapsedSec,
        tier: entry.tier ?? 'verified',
        groupKey: entry.groupKey,
        flags: rowFlags(entry.best?.flags ?? [], speed.get(entry._id)),
      };
    });
  }

  async bestSegment(entryId: string): Promise<SeriesSegment | null> {
    const entry = await this.repository.findEntryById(entryId);
    if (!entry?.best) return null;
    const attempt = await this.repository.findAttempt(entry.best.attemptId);
    if (!attempt || attempt.status !== 'counted' || !attempt.segment) return null;
    return {
      attemptId: attempt._id,
      activityId: attempt.activityId,
      checkRevision: attempt.checkRevision,
      startedAt: attempt.segment.startedAt,
      finishedAt: attempt.segment.finishedAt,
    };
  }
}
