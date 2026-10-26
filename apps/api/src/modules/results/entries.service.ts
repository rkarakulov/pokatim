import { Inject, Injectable, Logger } from '@nestjs/common';
import type { MyRaceEntry, RaceEntryBlockReason, RateLimitedDetails } from '@pokatim/contracts';
import { CLOCK, type Clock, RateLimiter, type RateLimitRule } from '@rkarakulov/api-kit/core';
import {
  isDuplicateKey,
  MongoOutboxWriter,
  MongoTransactions,
  uuidv7,
} from '@rkarakulov/api-kit/mongo';

import { domainError } from '../../error-messages';
import { RACE_REGISTRY, type RaceRegistry } from '../races';
import type { RaceEntryDoc } from './results.collection';
import { RESULTS_ENTRY_CREATED } from './results.events';
import { RESULTS_POLICY } from './results.policy';
import { ResultsReadService } from './results-read.service';
import { ResultsRepository } from './results.repository';

const entryClosed = (reason: RaceEntryBlockReason) =>
  domainError('RACE_ENTRY_CLOSED', 409, { reason });

/** Лимит частоты действия пользователя (`RateLimiter`, ключ — `userId`). */
export async function consumeUserLimit(
  rateLimiter: RateLimiter,
  key: string,
  rule: RateLimitRule,
  now: Date,
): Promise<void> {
  const result = await rateLimiter.consume(key, rule, now);
  if (!result.allowed) {
    const details: RateLimitedDetails = { retryAfterSec: result.retryAfterSec };
    throw domainError('RATE_LIMITED', 429, details);
  }
}

/**
 * Заявка и отмена участия (race-results-03): клиент присылает только намерение. Заявка — транзакция с
 * `RaceRegistry.admitEntry` первой операцией (запись `lockedAt` в документ гонки, V-12); отмена — под `lockEntry`.
 */
@Injectable()
export class EntriesService {
  private readonly logger = new Logger(EntriesService.name);

  constructor(
    private readonly repository: ResultsRepository,
    private readonly read: ResultsReadService,
    private readonly transactions: MongoTransactions,
    private readonly outbox: MongoOutboxWriter,
    private readonly rateLimiter: RateLimiter,
    @Inject(RACE_REGISTRY) private readonly races: RaceRegistry,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  /**
   * «Участвовать»: `created` — новая заявка (`201`), иначе уже активна (`200`). Гонка двух первых заявок, заявки и
   * правки/отмены гонки — конфликт записи в документ гонки, `MongoTransactions.run` повторяет проигравшую.
   */
  async enter(userId: string, raceId: string): Promise<{ created: boolean; entry: MyRaceEntry }> {
    const now = this.clock.now();
    await this.limit(userId, now);
    let created = false;
    try {
      await this.transactions.run(async (tx) => {
        created = false;
        const race = await this.races.admitEntry(tx, raceId, now);
        if (!race) {
          if ((await this.races.get(raceId, tx))?.status === 'cancelled') {
            throw entryClosed('cancelled');
          }
          throw domainError('NOT_FOUND', 404);
        }
        const existing = await this.repository.findEntry(raceId, userId, tx);
        if (existing?.status === 'active') return;
        if (existing) throw domainError('RACE_ENTRY_WITHDRAWN', 409);
        if (!race.corridor) throw entryClosed('no_corridor');
        const phase = this.races.phase(race, now);
        if (phase !== 'upcoming' && phase !== 'open') throw entryClosed('entries_closed');
        const entry: RaceEntryDoc = {
          _id: uuidv7(),
          raceId,
          userId,
          status: 'active',
          groupKey: RESULTS_POLICY.groupKey,
          tier: null,
          requests: [],
          best: null,
          summary: { total: 0, pending: 0, counted: 0, rejectedShown: 0, failed: 0 },
          createdAt: now,
          updatedAt: now,
          withdrawnAt: null,
          version: 0,
        };
        await this.repository.insertEntry(tx, entry);
        await this.outbox.append(tx, {
          type: RESULTS_ENTRY_CREATED,
          payload: { entryId: entry._id },
        });
        created = true;
      });
    } catch (error) {
      // гонка двух первых заявок одного райдера вне конфликта записи — заявка уже есть
      if (!isDuplicateKey(error, 'race_entries_race_user_unique')) throw error;
      created = false;
    }
    if (created) this.logger.log(`race ${raceId}: entry by ${userId}`);
    return { created, entry: await this.read.myEntry(userId, raceId) };
  }

  /**
   * «Отменить участие» (C1/H2): только в `upcoming|open`; попытки и треки остаются, строки в таблице нет, повторной
   * заявки нет. Уже отменённая — идемпотентно.
   */
  async withdraw(userId: string, raceId: string): Promise<MyRaceEntry> {
    const now = this.clock.now();
    await this.limit(userId, now);
    await this.read.race(raceId);
    await this.transactions.run(async (tx) => {
      const entry = await this.repository.lockEntryOf(tx, raceId, userId, now);
      if (!entry) throw domainError('RACE_ENTRY_REQUIRED', 409);
      if (entry.status === 'withdrawn') return;
      const race = await this.races.get(raceId, tx);
      if (!race) throw domainError('NOT_FOUND', 404);
      const phase = this.races.phase(race, now);
      if (phase !== 'upcoming' && phase !== 'open') throw domainError('RACE_WITHDRAW_CLOSED', 409);
      await this.repository.withdrawEntry(tx, entry._id, now);
    });
    return this.read.myEntry(userId, raceId);
  }

  private limit(userId: string, now: Date): Promise<void> {
    return consumeUserLimit(
      this.rateLimiter,
      `results-entry-user:${userId}`,
      RESULTS_POLICY.entryUserLimit,
      now,
    );
  }
}
