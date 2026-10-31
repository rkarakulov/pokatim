import { Inject, Injectable, Logger } from '@nestjs/common';
import { CLOCK, type Clock } from '@rkarakulov/api-kit/core';
import { isDuplicateKey, MongoOutboxWriter, uuidv7 } from '@rkarakulov/api-kit/mongo';

import { type DbSession, MongoTransactions } from '../../db';
import {
  RIDER_SEASON_STANDINGS,
  type RiderSeasonOutcome,
  type RiderSeasonStandings,
} from '../standings';
import { AchievementFactsReader, type Titled } from './achievement-facts.reader';
import {
  ACHIEVEMENTS_GRANT_NOTICED,
  type AchievementsGrantNoticed,
  type ReconcileOrigin,
} from './achievements.events';
import {
  noticeDue,
  type ProgressItem,
  reconcilePlan,
  type ReconcileStep,
  seasonalAchievements,
  type SeasonalEarned,
  seasonalPlan,
  type SeasonalStep,
} from './achievements.policy';
import {
  ACHIEVEMENT_GRANTS_UNIQUE_INDEX,
  ACHIEVEMENT_SEASON_GRANTS_UNIQUE_INDEX,
  AchievementsRepository,
} from './achievements.repository';

/** Итог сверки — то, что нужно ответу `GET /v1/achievements` (факты второй раз не читаются). */
export interface Reconciled {
  titled: Titled[];
  progress: ProgressItem[];
  seasonal: ReadonlyMap<string, SeasonalEarned>;
  outcomes: RiderSeasonOutcome[];
}

/**
 * Сверка выдач райдера с фактами (ADR-0020, «Дополнение: push»): одна для `GET /v1/achievements` (`origin: 'read'`) и
 * серверной сверки (`'server'`, PR N2). Факты → планы (`reconcilePlan`, `seasonalPlan`) → запись → маркер первой
 * сверки → итог. Шаги, которые могут дать уведомление (вставка не в первой сверке, `refresh`/`restore` несезонной), —
 * транзакция «условная запись выдачи → событие outbox `achievements.grant-noticed`» (AGENTS §4.5); первой операцией
 * транзакции стоит сама запись выдачи, чтения-проверки перед ней нет: параллельная сверка конфликтует по документу,
 * повтор колбэка видит закоммиченный `notifiedLevel` или документ (P3). Отзывы, сезонные восстановления, вся первая
 * сверка (A3) и маркер — прежние одиночные операции без транзакции. Лимита пользователя здесь нет (он — у HTTP).
 */
@Injectable()
export class AchievementsReconciler {
  private readonly logger = new Logger(AchievementsReconciler.name);

  constructor(
    private readonly repository: AchievementsRepository,
    @Inject(RIDER_SEASON_STANDINGS) private readonly standings: RiderSeasonStandings,
    private readonly facts: AchievementFactsReader,
    private readonly transactions: MongoTransactions,
    private readonly outbox: MongoOutboxWriter,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  async reconcile(userId: string, origin: ReconcileOrigin): Promise<Reconciled> {
    const now = this.clock.now();
    const [{ earned, progress }, stored, storedSeasonal, syncedAt] = await Promise.all([
      this.facts.evaluate(userId),
      this.repository.listOf(userId),
      this.repository.listSeasonalOf(userId),
      this.repository.syncedAt(userId),
    ]);
    const seasonIds = [...new Set(storedSeasonal.map((grant) => grant.seasonId))];
    const [titled, outcomes] = await Promise.all([
      this.facts.titled(earned, userId),
      // серверная сверка (worker) сбой порта не глотает — задача повторится (ревью N2 pass 2); GET — мягко
      origin === 'server'
        ? this.standings.outcomesOf(userId, seasonIds, now)
        : this.seasonOutcomes(userId, seasonIds, now),
    ]);
    const seasonal = seasonalAchievements(outcomes);
    const first = syncedAt === null;
    const plan = reconcilePlan(stored, earned, first, now);
    const seasonalSteps = seasonalPlan(
      storedSeasonal,
      seasonal.earned,
      seasonal.settled,
      first,
      now,
    );
    let noticed = 0;
    for (const step of plan) {
      if (await this.apply(userId, step, first, origin, now)) noticed += 1;
    }
    for (const step of seasonalSteps) {
      if (await this.applySeasonal(userId, step, first, origin, now)) noticed += 1;
    }
    if (first) await this.repository.markSynced(userId, now);
    if (plan.length > 0 || seasonalSteps.length > 0)
      this.logSync(userId, first, origin, noticed, plan, seasonalSteps);
    return { titled, progress, seasonal: seasonal.earned, outcomes };
  }

  /**
   * Итоги сезонов для чтения (GET, публичный список); сбой порта — как «ни одного сезона» (ревью pass 1, MEDIUM):
   * `settled` пуст — сезонные выдачи не трогаются, в ответе их нет до следующего запроса; несезонные и прогресс
   * отдаются. Лог — uid, без текста ошибки. Серверная сверка зовёт порт напрямую — сбой уходит в ретрай задачи.
   */
  async seasonOutcomes(
    userId: string,
    alsoSeasonIds: readonly string[],
    now: Date,
  ): Promise<RiderSeasonOutcome[]> {
    try {
      return await this.standings.outcomesOf(userId, alsoSeasonIds, now);
    } catch (error) {
      this.logger.warn(
        `achievements.seasons_unavailable uid=${userId} error=${error instanceof Error ? error.name : 'unknown'}`,
      );
      return [];
    }
  }

  /** Шаг несезонной выдачи; `true` — записано событие уведомления. */
  private async apply(
    userId: string,
    step: ReconcileStep,
    first: boolean,
    origin: ReconcileOrigin,
    now: Date,
  ): Promise<boolean> {
    switch (step.type) {
      case 'insert': {
        if (first) {
          await this.repository.insertGrant(userId, step.code, step.earned, step.seenAt, now);
          return false;
        }
        const id = uuidv7();
        return this.insertWithNotice(ACHIEVEMENT_GRANTS_UNIQUE_INDEX, async (tx) => {
          await this.repository.insertGrantInTx(tx, id, userId, step.code, step.earned, now);
          await this.notice(tx, { grant: 'fact', grantId: id, level: step.earned.level, origin });
        });
      }
      case 'revoke':
        await this.repository.revoke(userId, step.code, now);
        return false;
      case 'restore':
      case 'refresh': {
        const revoked = step.type === 'restore';
        if (first) {
          await this.repository.restoreOrRefresh(userId, step.code, step.earned, revoked, now);
          return false;
        }
        return this.transactions.run(async (tx) => {
          const before = await this.repository.restoreOrRefresh(
            userId,
            step.code,
            step.earned,
            revoked,
            now,
            tx,
          );
          if (!before || !noticeDue(before, step.earned.level)) return false;
          await this.notice(tx, {
            grant: 'fact',
            grantId: before._id,
            level: step.earned.level,
            origin,
          });
          return true;
        });
      }
    }
  }

  /** Шаг сезонной выдачи; уведомление — только вставка не в первой сверке (сезонный `restore` всегда тихий). */
  private async applySeasonal(
    userId: string,
    step: SeasonalStep,
    first: boolean,
    origin: ReconcileOrigin,
    now: Date,
  ): Promise<boolean> {
    switch (step.type) {
      case 'insert': {
        if (first) {
          await this.repository.insertSeasonal(userId, step.earned, step.seenAt, now);
          return false;
        }
        const id = uuidv7();
        return this.insertWithNotice(ACHIEVEMENT_SEASON_GRANTS_UNIQUE_INDEX, async (tx) => {
          await this.repository.insertSeasonalInTx(tx, id, userId, step.earned, now);
          await this.notice(tx, { grant: 'season', grantId: id, level: null, origin });
        });
      }
      case 'revoke':
        await this.repository.revokeSeasonal(userId, step.key, now);
        return false;
      case 'restore':
        await this.repository.restoreSeasonal(userId, step.key, now);
        return false;
    }
  }

  /**
   * Вставка с событием в одной транзакции. Дубль уникального индекса обрывает транзакцию (не транзиентная ошибка) —
   * ловится **снаружи** `run`: транзакция откатилась, события нет, проигравшая сверка — `false`. Ловить дубль внутри
   * колбэка нельзя (api-kit: ошибки операций внутри не глотать).
   */
  private async insertWithNotice(
    uniqueIndex: string,
    write: (tx: DbSession) => Promise<void>,
  ): Promise<boolean> {
    try {
      await this.transactions.run(write);
      return true;
    } catch (error) {
      if (isDuplicateKey(error, uniqueIndex)) return false;
      throw error;
    }
  }

  private notice(tx: DbSession, payload: AchievementsGrantNoticed): Promise<unknown> {
    return this.outbox.append(tx, { type: ACHIEVEMENTS_GRANT_NOTICED, payload });
  }

  private logSync(
    userId: string,
    first: boolean,
    origin: ReconcileOrigin,
    noticed: number,
    plan: readonly ReconcileStep[],
    seasonal: readonly SeasonalStep[],
  ): void {
    const count = (type: ReconcileStep['type']) => plan.filter((step) => step.type === type).length;
    const countSeasonal = (type: SeasonalStep['type']) =>
      seasonal.filter((step) => step.type === type).length;
    this.logger.log(
      `achievements.sync uid=${userId} first=${first} granted=${count('insert')} revoked=${count('revoke')} restored=${count('restore')} refreshed=${count('refresh')} seasonal_granted=${countSeasonal('insert')} seasonal_revoked=${countSeasonal('revoke')} seasonal_restored=${countSeasonal('restore')} origin=${origin} noticed=${noticed}`,
    );
  }
}
