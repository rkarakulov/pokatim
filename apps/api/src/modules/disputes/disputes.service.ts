import { Inject, Injectable, Logger } from '@nestjs/common';
import type {
  DisputeActionBlock,
  DisputeActionBlockedDetails,
  DisputeAgainstMe,
  DisputeFileRequest,
  DisputeResponseRequest,
  MyDispute,
  MyRaceDisputes,
  RateLimitedDetails,
} from '@pokatim/contracts';
import { CLOCK, type Clock, RateLimiter } from '@rkarakulov/api-kit/core';
import {
  isDuplicateKey,
  MongoOutboxWriter,
  MongoTransactions,
  uuidv7,
} from '@rkarakulov/api-kit/mongo';

import type { DbSession } from '../../db';
import { domainError } from '../../error-messages';
import { RACE_REGISTRY, type RaceForResults, type RaceRegistry } from '../races';
import { RESULTS_FOR_DISPUTES, type ResultsForDisputes } from '../results';
import type { DisputeDoc, DisputeEventDoc } from './disputes.collection';
import {
  DISPUTES_DISPUTE_FILED,
  DISPUTES_DISPUTE_RESPONDED,
  DISPUTES_DISPUTE_WITHDRAWN,
  type DisputeEventPayload,
} from './disputes.events';
import {
  DISPUTES_POLICY,
  fileBlock,
  filingClosesAt,
  filingStatus,
  targetBlock,
} from './disputes.policy';
import { DISPUTES_PAIR_UNIQUE_INDEX, DisputesRepository } from './disputes.repository';

/** `409 DISPUTE_ACTION_BLOCKED` с причиной (и моментом, когда действие станет доступно). */
export const disputeBlocked = (reason: DisputeActionBlock, availableAt?: Date) => {
  const details: DisputeActionBlockedDetails = availableAt
    ? { reason, availableAt: availableAt.toISOString() }
    : { reason };
  return domainError('DISPUTE_ACTION_BLOCKED', 409, details);
};
/** Нет спора или он не виден этому пользователю — не раскрываем существование. */
export const disputeNotFound = () => domainError('DISPUTE_NOT_FOUND', 404);

const decisionView = (doc: DisputeDoc) =>
  doc.decision
    ? {
        outcome: doc.decision.outcome,
        template: doc.decision.template,
        at: doc.decision.at.toISOString(),
      }
    : null;

/** Мой спор как заявителя — без ответа участника (D-51). */
export const myDisputeView = (doc: DisputeDoc): MyDispute => ({
  id: doc._id,
  raceId: doc.raceId,
  targetEntryId: doc.targetEntryId,
  category: doc.category,
  description: doc.description,
  status: doc.status,
  filedAt: doc.filedAt.toISOString(),
  closedAt: doc.closedAt?.toISOString() ?? null,
  decision: decisionView(doc),
});

/** Спор по моему результату — без заявителя и описания (D-51). */
export const againstMeView = (
  doc: DisputeDoc,
  race: Pick<RaceForResults, 'protocolPlannedAt'>,
): DisputeAgainstMe => ({
  id: doc._id,
  raceId: doc.raceId,
  category: doc.category,
  status: doc.status,
  filedAt: doc.filedAt.toISOString(),
  decidableBy: race.protocolPlannedAt.toISOString(),
  response: doc.response ? { text: doc.response.text, at: doc.response.at.toISOString() } : null,
  canRespond: doc.status === 'open' && doc.response === null,
  decision: decisionView(doc),
});

/**
 * Споры приложения (race-results-06): подача, отзыв, ответ и «мои споры в гонке». Клиент присылает только намерение
 * (цель, категория, текст); право подачи, сроки (D-44), анонимность (D-51) считает сервер. Подача — транзакция с
 * `RaceRegistry.lockResults` первой операцией (сериализует подачи гонки и конфликтует с публикацией, решением, отменой
 * и правкой гонки), затем замок заявки-цели (`ResultsForDisputes.lockEntry` — конфликт с отменой участия, явной
 * попыткой и приёмом). Отзыв и ответ — переход из `open` одной записью (RC-12). Логи — после коммита, без описания,
 * ответа и `userId` райдеров.
 */
@Injectable()
export class DisputesService {
  private readonly logger = new Logger(DisputesService.name);

  constructor(
    private readonly repository: DisputesRepository,
    private readonly transactions: MongoTransactions,
    private readonly outbox: MongoOutboxWriter,
    private readonly rateLimiter: RateLimiter,
    @Inject(RACE_REGISTRY) private readonly races: RaceRegistry,
    @Inject(RESULTS_FOR_DISPUTES) private readonly results: ResultsForDisputes,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  /** `GET /v1/races/:raceId/disputes`: приём споров и мои споры (поданные и по моему результату), новые сверху. */
  async myRaceDisputes(userId: string, raceId: string): Promise<MyRaceDisputes> {
    const race = await this.race(raceId);
    const now = this.clock.now();
    const complainant = await this.results.entryOf(raceId, userId);
    const filed = await this.repository.listFiledBy(raceId, userId);
    const against = complainant ? await this.repository.listAgainst(complainant.id) : [];
    const reason = fileBlock({
      race,
      now,
      complainant,
      openByComplainant: filed.filter((doc) => doc.status === 'open').length,
    });
    return {
      raceId,
      filing: {
        status: filingStatus(reason),
        closesAt: filingClosesAt(race).toISOString(),
        protocolPlannedAt: race.protocolPlannedAt.toISOString(),
        reason,
      },
      filed: filed.map(myDisputeView),
      against: against.map((doc) => againstMeView(doc, race)),
    };
  }

  /** «Оспорить результат»: `201 MyDispute`; отказ — `409 DISPUTE_ACTION_BLOCKED` с причиной. */
  async file(userId: string, raceId: string, body: DisputeFileRequest): Promise<MyDispute> {
    const now = this.clock.now();
    await this.limit(userId, now);
    let dispute: DisputeDoc;
    try {
      dispute = await this.transactions.run(async (tx) => {
        const race = await this.races.lockResults(tx, raceId);
        if (!race) throw domainError('NOT_FOUND', 404);
        const complainant = await this.results.entryOf(raceId, userId, tx);
        // лимит открытых проверяется после цели (подачи гонки сериализует `lockResults`)
        const early = fileBlock({ race, now, complainant, openByComplainant: 0 });
        if (early || !complainant) throw disputeBlocked(early ?? 'not_entered');
        const target = await this.results.lockEntry(tx, body.targetEntryId, now);
        const refused = targetBlock(complainant, target, raceId);
        if (refused || !target) throw disputeBlocked(refused ?? 'target_not_counted');
        const open = await this.repository.countOpenByComplainant(tx, raceId, userId);
        if (open >= DISPUTES_POLICY.openLimit) throw disputeBlocked('open_limit');
        const doc: DisputeDoc = {
          _id: uuidv7(),
          raceId,
          groupKey: complainant.groupKey,
          complainantUserId: userId,
          complainantEntryId: complainant.id,
          targetEntryId: target.id,
          targetUserId: target.userId,
          category: body.category,
          description: body.description ?? null,
          status: 'open',
          response: null,
          decision: null,
          filedAt: now,
          closedAt: null,
          version: 0,
          createdAt: now,
          updatedAt: now,
        };
        await this.repository.insert(tx, doc);
        await this.record(tx, doc, 'filed', userId, now, DISPUTES_DISPUTE_FILED);
        return doc;
      });
    } catch (error) {
      // повтор пары (в том числе после отзыва, R2) или параллельная подача той же пары
      if (isDuplicateKey(error, DISPUTES_PAIR_UNIQUE_INDEX)) throw disputeBlocked('already_filed');
      throw error;
    }
    this.logger.log(`disputes.filed dispute=${dispute._id} race=${raceId}`);
    return myDisputeView(dispute);
  }

  /** «Отозвать спор»: только заявитель и только открытый (`closedAt = now`). */
  async withdraw(userId: string, disputeId: string): Promise<MyDispute> {
    const now = this.clock.now();
    await this.limit(userId, now);
    const dispute = await this.transactions.run(async (tx) => {
      const updated = await this.repository.withdraw(tx, disputeId, userId, now);
      if (!updated) {
        const current = await this.repository.findById(disputeId, tx);
        if (current?.complainantUserId !== userId) throw disputeNotFound();
        throw disputeBlocked('not_open');
      }
      await this.record(tx, updated, 'withdrawn', userId, now, DISPUTES_DISPUTE_WITHDRAWN);
      return updated;
    });
    this.logger.log(`disputes.withdrawn dispute=${disputeId} race=${dispute.raceId}`);
    return myDisputeView(dispute);
  }

  /** Ответ участника, чей результат оспорен: один раз, только открытый спор. */
  async respond(
    userId: string,
    disputeId: string,
    body: DisputeResponseRequest,
  ): Promise<DisputeAgainstMe> {
    const now = this.clock.now();
    await this.limit(userId, now);
    const dispute = await this.transactions.run(async (tx) => {
      const updated = await this.repository.respond(tx, disputeId, userId, body.text, now);
      if (!updated) {
        const current = await this.repository.findById(disputeId, tx);
        if (current?.targetUserId !== userId) throw disputeNotFound();
        throw disputeBlocked(current.status === 'open' ? 'already_responded' : 'not_open');
      }
      await this.record(tx, updated, 'responded', userId, now, DISPUTES_DISPUTE_RESPONDED);
      return updated;
    });
    this.logger.log(`disputes.responded dispute=${disputeId} race=${dispute.raceId}`);
    return againstMeView(dispute, await this.race(dispute.raceId));
  }

  /** Опубликованная или отменённая гонка; черновик и неизвестная — 404 (как в `results`). */
  private async race(raceId: string): Promise<RaceForResults> {
    const race = await this.races.get(raceId);
    if (!race) throw domainError('NOT_FOUND', 404);
    return race;
  }

  /** Событие истории (только id и коды) и событие outbox — в транзакции действия. */
  private async record(
    tx: DbSession,
    dispute: DisputeDoc,
    kind: DisputeEventDoc['kind'],
    userId: string,
    at: Date,
    type: string,
  ): Promise<void> {
    await this.repository.insertEvent(tx, {
      _id: uuidv7(),
      disputeId: dispute._id,
      raceId: dispute.raceId,
      kind,
      actor: { kind: 'rider', userId },
      at,
      payload: {},
    });
    const payload: DisputeEventPayload = { disputeId: dispute._id, raceId: dispute.raceId };
    await this.outbox.append(tx, { type, payload });
  }

  private async limit(userId: string, now: Date): Promise<void> {
    const result = await this.rateLimiter.consume(
      `disputes-user:${userId}`,
      DISPUTES_POLICY.userLimit,
      now,
    );
    if (!result.allowed) {
      const details: RateLimitedDetails = { retryAfterSec: result.retryAfterSec };
      throw domainError('RATE_LIMITED', 429, details);
    }
  }
}
