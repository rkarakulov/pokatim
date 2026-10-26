import { Inject, Injectable } from '@nestjs/common';
import type {
  AttemptCandidates,
  AttemptRequest,
  MyRaceEntry,
  RaceEntryBlockedDetails,
  RaceEntryBlockReason,
} from '@pokatim/contracts';
import { CLOCK, type Clock, RateLimiter } from '@rkarakulov/api-kit/core';
import { MongoTransactions } from '@rkarakulov/api-kit/mongo';

import { domainError } from '../../error-messages';
import { RACE_REGISTRY, type RaceRegistry } from '../races';
import { ACTIVITY_SOURCE, type ActivityRef, type ActivitySource } from '../tracks';
import { AttemptIntake } from './attempt-intake';
import { consumeUserLimit } from './entries.service';
import { RESULT_DISPUTE_GATE, type ResultDisputeGate } from './result-dispute-gate.port';
import type { EntryRequest } from './results.collection';
import {
  attemptClosedReason,
  entryDisputeBlock,
  raceRepresentative,
  RESULTS_POLICY,
  uploadClosesAt,
} from './results.policy';
import { ResultsReadService } from './results-read.service';
import { ResultsRepository } from './results.repository';

const sourceInvalid = () => domainError('ATTEMPT_SOURCE_INVALID', 409);
const attemptLimit = () => domainError('ATTEMPT_LIMIT', 409);
const uploadClosed = (reason: RaceEntryBlockReason) => {
  const details: RaceEntryBlockedDetails = { reason };
  return domainError('ATTEMPT_UPLOAD_CLOSED', 409, details);
};

/**
 * Явные попытки (A8): «выбрать свой заезд» (`activityId`) и «загрузить в гонку» (`uploadId` после
 * `POST /v1/tracks/uploads`, Q2). Транзакция под `lockEntry`: источник — порт `ActivitySource` с `userId` вызывающего
 * (чужое и неизвестное — 404); файл ещё разбирается — запрос ждёт `activity-ready`; готов — попытка основной
 * активности группы, `explicit`.
 */
@Injectable()
export class AttemptsService {
  constructor(
    private readonly repository: ResultsRepository,
    private readonly intake: AttemptIntake,
    private readonly read: ResultsReadService,
    private readonly transactions: MongoTransactions,
    private readonly rateLimiter: RateLimiter,
    @Inject(RACE_REGISTRY) private readonly races: RaceRegistry,
    @Inject(ACTIVITY_SOURCE) private readonly activities: ActivitySource,
    @Inject(RESULT_DISPUTE_GATE) private readonly disputes: ResultDisputeGate,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  async add(userId: string, raceId: string, input: AttemptRequest): Promise<MyRaceEntry> {
    const now = this.clock.now();
    await consumeUserLimit(
      this.rateLimiter,
      `results-attempt-user:${userId}`,
      RESULTS_POLICY.attemptUserLimit,
      now,
    );
    await this.read.race(raceId);
    await this.transactions.run(async (tx) => {
      const entry = await this.repository.lockEntryOf(tx, raceId, userId, now);
      if (entry?.status !== 'active') throw domainError('RACE_ENTRY_REQUIRED', 409);
      const race = await this.races.get(raceId, tx);
      if (!race) throw domainError('NOT_FOUND', 404);
      const closed = attemptClosedReason(race, this.races.phase(race, now), now);
      if (closed) throw uploadClosed(closed);
      // D-39 / RC-6 (race-results-06): оба вида тела; гейт — под `lockEntry` (подача спора берёт замок цели)
      const dispute = entryDisputeBlock(
        entry,
        await this.disputes.openAgainst(entry._id, tx),
        race,
      );
      if (dispute) throw uploadClosed(dispute);
      const closesAt = uploadClosesAt(race);

      let request: Pick<EntryRequest, 'uploadId' | 'activityId'>;
      let target: ActivityRef | null;
      let group: Awaited<ReturnType<ActivitySource['group']>> = null;
      if ('activityId' in input) {
        const activity = await this.activities.activity(userId, input.activityId, tx);
        if (!activity) throw domainError('NOT_FOUND', 404);
        if (!activity.isPrimary || activity.uploadCreatedAt >= closesAt) throw sourceInvalid();
        request = { uploadId: activity.uploadId, activityId: activity.id };
        target = activity;
        group = await this.activities.group(activity.id, tx);
      } else {
        const upload = await this.activities.uploadState(userId, input.uploadId, tx);
        if (!upload) throw domainError('NOT_FOUND', 404);
        if (upload.status === 'failed' || upload.status === 'skipped') throw sourceInvalid();
        if (upload.createdAt >= closesAt) throw sourceInvalid();
        request = { uploadId: input.uploadId, activityId: upload.activity?.id ?? null };
        // загрузка-дубль относится к представителю группы в гонке (своевременная основная)
        group = upload.activity ? await this.activities.group(upload.activity.id, tx) : null;
        target = group ? raceRepresentative(group.members, race) : null;
      }

      let attemptId: string | null = null;
      if (target) {
        const attempts = await this.repository.attemptsOfEntry(entry._id, tx);
        const ensured = await this.intake.ensureAttempt(tx, entry, race, target, attempts, {
          origin: 'explicit',
          now,
          groupIds: group?.members.map((member) => member.id) ?? [],
        });
        // основная группы загрузки-дубля принята после срока (A5) — заезд в гонку не идёт
        if (ensured.refused === 'late') throw sourceInvalid();
        if (ensured.refused === 'limit') throw attemptLimit();
        attemptId = ensured.attemptId;
      }
      const known = entry.requests.find((item) => item.uploadId === request.uploadId);
      if (!known && entry.requests.length >= RESULTS_POLICY.maxRequestsPerEntry) {
        throw attemptLimit();
      }
      const next: EntryRequest = {
        ...request,
        requestedAt: known?.requestedAt ?? now,
        attemptId: attemptId ?? known?.attemptId ?? null,
      };
      const requests = known
        ? entry.requests.map((item) => (item.uploadId === request.uploadId ? next : item))
        : [...entry.requests, next];
      await this.repository.setRequests(tx, entry, requests);
      await this.repository.refreshEntry(tx, entry);
    });
    return this.read.myEntry(userId, raceId);
  }

  /** «Выбрать свой заезд»: свои основные заезды, пересекающие окно (≤ 50), с отметкой «уже попытка». */
  async candidates(userId: string, raceId: string): Promise<AttemptCandidates> {
    const race = await this.read.race(raceId);
    const [activities, entry] = await Promise.all([
      this.activities.listInRange(
        userId,
        race.windowStartsAt,
        race.closesAt,
        RESULTS_POLICY.candidatesLimit,
      ),
      this.repository.findEntry(raceId, userId),
    ]);
    const attempts = entry ? await this.repository.attemptsOfEntry(entry._id) : [];
    const attempted = new Set(
      attempts
        .filter((attempt) => attempt.status !== 'withdrawn')
        .map((attempt) => attempt.activityId),
    );
    return {
      items: activities.map((activity) => ({
        activityId: activity.id,
        startedAt: activity.startedAt.toISOString(),
        source: activity.source,
        elapsedSec: activity.elapsedSec,
        distanceM: Math.round(activity.distanceM),
        attempted: attempted.has(activity.id),
      })),
    };
  }
}
