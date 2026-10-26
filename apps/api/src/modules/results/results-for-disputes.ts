import { Inject, Injectable } from '@nestjs/common';
import { CLOCK, type Clock } from '@rkarakulov/api-kit/core';
import { uuidv7 } from '@rkarakulov/api-kit/mongo';

import type { DbSession } from '../../db';
import type { RaceForResults } from '../races';
import type { RaceEntryDoc } from './results.collection';
import type {
  DisputeEntry,
  DisputeStanding,
  ResultsForDisputes,
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
      return {
        resultStatus: result.status,
        place: result.place,
        tied: result.tied,
        elapsedSec: result.elapsedSec,
      };
    });
  }
}
