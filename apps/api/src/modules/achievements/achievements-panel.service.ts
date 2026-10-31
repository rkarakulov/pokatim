import { Inject, Injectable, Logger } from '@nestjs/common';
import {
  ACHIEVEMENT_LEVELS,
  ACHIEVEMENT_OBJECT_KIND_BY_CODE,
  type AchievementCode,
  type AchievementInvalidStateDetails,
  type AchievementLevel,
  type AchievementObjectKind,
  type ClearRiderAchievementOverrideRequest,
  type ClearRiderAchievementOverrideResult,
  type GrantRiderAchievementRequest,
  isLeveledCode,
  isSeasonalCode,
  minskToday,
  type RevokeRiderAchievementRequest,
  type RiderAchievementAdminItem,
  type RiderAchievementsAdmin,
} from '@pokatim/contracts';
import { CLOCK, type Clock, RateLimiter } from '@rkarakulov/api-kit/core';
import { isDuplicateKey, MongoOutboxWriter, uuidv7 } from '@rkarakulov/api-kit/mongo';

import { type DbSession, MongoTransactions } from '../../db';
import { domainError } from '../../error-messages';
import { consumeUserLimit } from '../../user-limit';
import { IdentityAccounts } from '../identity';
import { PanelAudit, PanelDirectory } from '../panel';
import { riderSubjectLabel } from '../profile';
import {
  RIDER_SEASON_STANDINGS,
  type RiderSeasonOutcome,
  type RiderSeasonStandings,
} from '../standings';
import { AchievementFactsReader } from './achievement-facts.reader';
import { AchievementObjects, objectKey } from './achievement-objects';
import { AchievementsReconciler } from './achievements-reconciler';
import { ACHIEVEMENTS_GRANT_NOTICED, type AchievementsGrantNoticed } from './achievements.events';
import {
  type AchievementOverride,
  adminStatus,
  type FactAchievementCode,
  type LevelRank,
  levelName,
  seasonalAchievements,
  seasonalKey,
  type SeasonalKey,
  sortForList,
  storedRank,
} from './achievements.policy';
import {
  ACHIEVEMENT_GRANTS_UNIQUE_INDEX,
  ACHIEVEMENT_SEASON_GRANTS_UNIQUE_INDEX,
  AchievementsRepository,
} from './achievements.repository';

/** Лимит мутаций сотрудника (RC-14, как `results-panel-user`). */
export const ACHIEVEMENTS_PANEL_LIMIT = { limit: 60, windowSec: 3600 } as const;

type Action = 'granted' | 'revoked' | 'cleared';
type AuditDetails = {
  achievementCode: AchievementCode;
  objectKind: AchievementObjectKind;
  objectId: string;
  achievementLevel?: AchievementLevel;
};

const invalidState = (reason: AchievementInvalidStateDetails['reason']) =>
  domainError('ACHIEVEMENT_INVALID_STATE', 409, {
    reason,
  } satisfies AchievementInvalidStateDetails);
const objectInvalid = () =>
  domainError('VALIDATION_FAILED', 400, { fields: [{ path: 'objectId', code: 'INVALID' }] });
const rankOf = (level: AchievementLevel) => (ACHIEVEMENT_LEVELS.indexOf(level) + 1) as LevelRank;

/**
 * Блок «Достижения» карточки райдера в панели (achievements-panel, `achievements.manage`): все выдачи со статусом, ручная
 * выдача, ручной отзыв и снятие ручного решения. Порядок мутации (5.G): лимит сотрудника → живой аккаунт → (выдача)
 * объект портом владельца вне транзакции → `MongoTransactions.run`: **запись выдачи первой** (замок выдачи, M8) →
 * (выдача) outbox `achievements.grant-noticed` (`origin: 'server'`, RC-4) → `PanelAudit.append`; дубль уникального индекса
 * — снаружи `run` (409). Колбэк — без логов и Redis (повторяется). Снятие решения — после коммита немедленная сверка
 * `reconcile(userId, 'server')`, если у райдера есть маркер первой сверки (RC-5). Логи — id сотрудника, действие и исход;
 * без `userId` райдера, кодов объектов и причины.
 */
@Injectable()
export class AchievementsPanelService {
  private readonly logger = new Logger(AchievementsPanelService.name);

  constructor(
    private readonly repository: AchievementsRepository,
    private readonly objects: AchievementObjects,
    private readonly facts: AchievementFactsReader,
    private readonly reconciler: AchievementsReconciler,
    @Inject(RIDER_SEASON_STANDINGS) private readonly standings: RiderSeasonStandings,
    private readonly accounts: IdentityAccounts,
    private readonly directory: PanelDirectory,
    private readonly audit: PanelAudit,
    private readonly transactions: MongoTransactions,
    private readonly outbox: MongoOutboxWriter,
    private readonly rateLimiter: RateLimiter,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  /**
   * Все выдачи райдера (обе коллекции, включая отозванные) с названиями объектов, сотрудниками решений и «по фактам»
   * (RC-6). Без записи и без сверки; сбой порта сезонов — названия сезонов `null`, `seasonsAvailable: false`.
   */
  async list(userId: string): Promise<RiderAchievementsAdmin> {
    const now = this.clock.now();
    const { grants, seasonGrants } = await this.repository.listForPanel(userId);
    const seasonIds = [...new Set(seasonGrants.map((grant) => grant.seasonId))];
    const [{ earned }, titles, seasons] = await Promise.all([
      this.facts.evaluate(userId),
      this.objects.titles(
        userId,
        grants.map((grant) => grant.object),
      ),
      seasonIds.length > 0 ? this.seasonsSoftly(userId, seasonIds, now) : Promise.resolve([]),
    ]);
    const deciders = [...grants, ...seasonGrants].flatMap((grant) =>
      grant.override ? [grant.override.byUserId] : [],
    );
    const names = deciders.length > 0 ? await this.directory.displayNames(deciders) : new Map();
    const overrideOf = (override: AchievementOverride | null | undefined) =>
      override
        ? {
            decision: override.decision,
            at: override.at.toISOString(),
            by: { userId: override.byUserId, displayName: names.get(override.byUserId) ?? '' },
          }
        : null;

    const items: { code: AchievementCode; factAt: Date; item: RiderAchievementAdminItem }[] = [];
    for (const grant of grants) {
      const fact = earned.get(grant.code);
      items.push({
        code: grant.code,
        factAt: grant.factAt,
        item: {
          code: grant.code,
          object: {
            kind: grant.object.kind,
            id: grant.object.id,
            title: titles.get(objectKey(grant.object)) ?? null,
          },
          level: isLeveledCode(grant.code) ? levelName(storedRank(grant)) : null,
          factDate: minskToday(grant.factAt),
          status: adminStatus(grant),
          grantedAt: grant.grantedAt.toISOString(),
          revokedAt: grant.revokedAt?.toISOString() ?? null,
          override: overrideOf(grant.override),
          byFacts: fact
            ? { state: 'earned', level: fact.level === null ? null : levelName(fact.level) }
            : { state: 'not_earned', level: null },
        },
      });
    }
    const outcomes = seasons ?? [];
    const seasonal = seasonalAchievements(outcomes).earned;
    for (const grant of seasonGrants) {
      const outcome = outcomes.find((item) => item.seasonId === grant.seasonId);
      items.push({
        code: grant.code,
        factAt: grant.factAt,
        item: {
          code: grant.code,
          object: { kind: 'season', id: grant.seasonId, title: outcome?.title ?? null },
          level: null,
          factDate: minskToday(grant.factAt),
          status: adminStatus(grant),
          grantedAt: grant.grantedAt.toISOString(),
          revokedAt: grant.revokedAt?.toISOString() ?? null,
          override: overrideOf(grant.override),
          byFacts: {
            state:
              outcome?.status !== 'final'
                ? 'unknown'
                : seasonal.has(seasonalKey(grant))
                  ? 'earned'
                  : 'not_earned',
            level: null,
          },
        },
      });
    }
    return {
      items: sortForList(items).map((entry) => entry.item),
      seasonsAvailable: seasons !== null,
    };
  }

  /**
   * Ручная выдача (M3): объект проверяет порт владельца вида кода (не найден или чужого вида — 400 на `objectId`); дата
   * факта — дата объекта; уровень счётного — из формы (по умолчанию бронза). Видимая выдача уже есть — 409
   * `already_granted`.
   */
  async grant(
    actorUserId: string,
    userId: string,
    body: GrantRiderAchievementRequest,
  ): Promise<void> {
    const now = await this.admit(actorUserId, userId);
    const override: AchievementOverride = { decision: 'granted', at: now, byUserId: actorUserId };
    const audit = (tx: DbSession, details: AuditDetails) =>
      this.appendAudit(
        tx,
        'achievement.granted_manually',
        actorUserId,
        userId,
        body.reason,
        details,
      );
    try {
      if (isSeasonalCode(body.code)) {
        const outcome = (await this.standings.outcomesOf(userId, [body.objectId], now)).find(
          (item) => item.seasonId === body.objectId,
        );
        if (!outcome) throw objectInvalid();
        const key: SeasonalKey = { code: body.code, seasonId: body.objectId };
        const factAt = new Date(outcome.endsBefore.getTime() - 1);
        const id = uuidv7();
        await this.transactions.run(async (tx) => {
          let grantId = await this.repository.manualGrantSeasonalInTx(
            tx,
            userId,
            key,
            factAt,
            override,
            now,
          );
          if (grantId === null) {
            await this.repository.insertManualSeasonalInTx(
              tx,
              id,
              userId,
              key,
              factAt,
              override,
              now,
            );
            grantId = id;
          }
          await this.notice(tx, { grant: 'season', grantId, level: null, origin: 'server' });
          await audit(tx, {
            achievementCode: body.code,
            objectKind: 'season',
            objectId: key.seasonId,
          });
        });
      } else {
        const code: FactAchievementCode = body.code;
        const kind = ACHIEVEMENT_OBJECT_KIND_BY_CODE[code];
        const object = { kind, id: body.objectId };
        const resolved = await this.objects.resolve(userId, object, now);
        if (!resolved) throw objectInvalid();
        const level = isLeveledCode(code) ? rankOf(body.level ?? 'bronze') : null;
        const manual = { object, factAt: resolved.factAt, level };
        const id = uuidv7();
        await this.transactions.run(async (tx) => {
          let grantId = await this.repository.manualGrantInTx(
            tx,
            userId,
            code,
            manual,
            override,
            now,
          );
          if (grantId === null) {
            await this.repository.insertManualGrantInTx(
              tx,
              id,
              userId,
              code,
              manual,
              override,
              now,
            );
            grantId = id;
          }
          await this.notice(tx, { grant: 'fact', grantId, level, origin: 'server' });
          await audit(tx, {
            achievementCode: code,
            objectKind: kind,
            objectId: object.id,
            ...(level === null ? {} : { achievementLevel: levelName(level) }),
          });
        });
      }
    } catch (error) {
      if (
        isDuplicateKey(error, ACHIEVEMENT_GRANTS_UNIQUE_INDEX) ||
        isDuplicateKey(error, ACHIEVEMENT_SEASON_GRANTS_UNIQUE_INDEX)
      ) {
        this.log('granted', actorUserId, 'conflict');
        throw invalidState('already_granted');
      }
      throw error;
    }
    this.log('granted', actorUserId, 'granted');
  }

  /** Ручной отзыв видимой выдачи (M4): без уведомления; видимой нет — 409 `not_granted`. */
  async revoke(
    actorUserId: string,
    userId: string,
    body: RevokeRiderAchievementRequest,
  ): Promise<void> {
    const now = await this.admit(actorUserId, userId);
    const override: AchievementOverride = { decision: 'revoked', at: now, byUserId: actorUserId };
    const revoked = await this.transactions.run(async (tx) => {
      const details = await this.writeRevoke(tx, userId, body, override, now);
      if (!details) return false;
      await this.appendAudit(
        tx,
        'achievement.revoked_manually',
        actorUserId,
        userId,
        body.reason,
        details,
      );
      return true;
    });
    this.log('revoked', actorUserId, revoked ? 'revoked' : 'conflict');
    if (!revoked) throw invalidState('not_granted');
  }

  /**
   * «Вернуть автоматике» (M5): решение снимается; решения нет — `{ cleared: false }` без журнала (идемпотентно). После
   * коммита — сверка по фактам (RC-5), если у райдера есть маркер первой сверки; сбой — `reconciled: false`.
   */
  async clear(
    actorUserId: string,
    userId: string,
    body: ClearRiderAchievementOverrideRequest,
  ): Promise<ClearRiderAchievementOverrideResult> {
    const now = await this.admit(actorUserId, userId);
    const cleared = await this.transactions.run(async (tx) => {
      const details = await this.writeClear(tx, userId, body, now);
      if (!details) return false;
      await this.appendAudit(
        tx,
        'achievement.override_cleared',
        actorUserId,
        userId,
        body.reason,
        details,
      );
      return true;
    });
    let reconciled = false;
    if (cleared && (await this.repository.syncedAt(userId)) !== null) {
      try {
        await this.reconciler.reconcile(userId, 'server');
        reconciled = true;
      } catch (error) {
        this.logger.warn(
          `achievements.override_reconcile_failed by=${actorUserId} error=${error instanceof Error ? error.name : 'unknown'}`,
        );
      }
    }
    this.log('cleared', actorUserId, cleared ? 'cleared' : 'none');
    return { cleared, reconciled };
  }

  /** Лимит сотрудника → живой аккаунт райдера (удалённый и неизвестный — 404); момент решения. */
  private async admit(actorUserId: string, userId: string): Promise<Date> {
    const now = this.clock.now();
    await consumeUserLimit(
      this.rateLimiter,
      `achievements-panel:${actorUserId}`,
      ACHIEVEMENTS_PANEL_LIMIT,
      now,
    );
    if (!(await this.accounts.liveUserIds([userId])).has(userId))
      throw domainError('NOT_FOUND', 404);
    return now;
  }

  private async writeRevoke(
    tx: DbSession,
    userId: string,
    body: RevokeRiderAchievementRequest,
    override: AchievementOverride,
    now: Date,
  ): Promise<AuditDetails | null> {
    if (isSeasonalCode(body.code)) {
      const key = { code: body.code, seasonId: body.seasonId! };
      const before = await this.repository.manualRevokeSeasonalInTx(tx, userId, key, override, now);
      return (
        before && { achievementCode: body.code, objectKind: 'season', objectId: before.seasonId }
      );
    }
    const before = await this.repository.manualRevokeInTx(tx, userId, body.code, override, now);
    return before && factDetails(body.code, before);
  }

  private async writeClear(
    tx: DbSession,
    userId: string,
    body: ClearRiderAchievementOverrideRequest,
    now: Date,
  ): Promise<AuditDetails | null> {
    if (isSeasonalCode(body.code)) {
      const key = { code: body.code, seasonId: body.seasonId! };
      const before = await this.repository.clearSeasonalOverrideInTx(tx, userId, key, now);
      return (
        before && { achievementCode: body.code, objectKind: 'season', objectId: before.seasonId }
      );
    }
    const before = await this.repository.clearOverrideInTx(tx, userId, body.code, now);
    return before && factDetails(body.code, before);
  }

  /** Итоги сезонов мягко: сбой порта — `null` (лог без текста ошибки). */
  private async seasonsSoftly(
    userId: string,
    seasonIds: readonly string[],
    now: Date,
  ): Promise<RiderSeasonOutcome[] | null> {
    try {
      return await this.standings.outcomesOf(userId, seasonIds, now);
    } catch (error) {
      this.logger.warn(
        `achievements.panel_seasons_unavailable error=${error instanceof Error ? error.name : 'unknown'}`,
      );
      return null;
    }
  }

  private appendAudit(
    tx: DbSession,
    action:
      | 'achievement.granted_manually'
      | 'achievement.revoked_manually'
      | 'achievement.override_cleared',
    actorUserId: string,
    userId: string,
    reason: string,
    details: AuditDetails,
  ): Promise<string> {
    return this.audit.append(tx, {
      action,
      actor: { kind: 'user', userId: actorUserId },
      subject: { kind: 'rider', id: userId, label: riderSubjectLabel(userId) },
      reason,
      details,
    });
  }

  private notice(tx: DbSession, payload: AchievementsGrantNoticed): Promise<unknown> {
    return this.outbox.append(tx, { type: ACHIEVEMENTS_GRANT_NOTICED, payload });
  }

  private log(action: Action, actorUserId: string, outcome: string): void {
    this.logger.log(`achievements.manual action=${action} by=${actorUserId} outcome=${outcome}`);
  }
}

/** Детали журнала несезонной выдачи — из записанного документа (`returnDocument: 'before'`). */
function factDetails(
  code: FactAchievementCode,
  before: {
    object: { kind: Exclude<AchievementObjectKind, 'season'>; id: string };
    level?: LevelRank | null;
  },
): AuditDetails {
  return {
    achievementCode: code,
    objectKind: before.object.kind,
    objectId: before.object.id,
    ...(isLeveledCode(code) ? { achievementLevel: levelName(storedRank(before)) } : {}),
  };
}
