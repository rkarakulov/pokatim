import { Inject, Injectable } from '@nestjs/common';
import type {
  PanelProtocolRecalculations,
  PanelRaceAttempt,
  PanelRaceAttemptPage,
  PanelRaceAttemptQuery,
  PanelRaceResults,
  PanelRaceStandings,
  PanelStandingRow,
  PublishChecklist,
} from '@pokatim/contracts';
import { CORRIDOR_ENGINE_VERSION } from '@pokatim/tracks/parse';
import { CLOCK, type Clock } from '@rkarakulov/api-kit/core';
import { z } from 'zod';

import type { DbSession } from '../../db';
import { domainError } from '../../error-messages';
import { decodeCursor, encodeCursor } from '../../page-cursor';
import { PanelDirectory, type PanelPrincipal } from '../panel';
import { RACE_REGISTRY, type RaceForResults, type RaceRegistry } from '../races';
import { ACTIVITY_SOURCE, type ActivitySource } from '../tracks';
import type {
  RaceAttemptDoc,
  RaceAttemptReviewDoc,
  RaceEntryDoc,
  RaceProtocolRowDoc,
} from './results.collection';
import {
  attemptHidden,
  publishChecklist,
  rankRows,
  recheckPending,
  RESULTS_POLICY,
  resultStatus,
  uploadClosesAt,
} from './results.policy';
import { segmentView } from './results-read.service';
import { ResultsRepository } from './results.repository';

const notFound = () => domainError('NOT_FOUND', 404);
/** Курсор попыток панели: только `_id` (новые сверху). */
const AttemptCursorKey = z.literal('a');

/** Чек-лист публикации и незавершённые проверки — одно вычисление для чтения и транзакции публикации. */
export interface ProtocolChecks {
  publish: PublishChecklist;
  /** последний запуск перепроверки треков (до или после публикации) */
  recheckStartedAt: Date | null;
  recheckAppliedAt: Date | null;
  /** незавершённые проверки (RC-1): `queued + checking +` устаревшие вердикты */
  pending: number;
  failed: number;
}

const summaryView = (summary: RaceEntryDoc['summary']): PanelStandingRow['summary'] => ({
  total: summary.total,
  pending: summary.pending,
  counted: summary.counted,
  rejectedShown: summary.rejectedShown,
  failed: summary.failed,
  excluded: summary.excluded ?? 0,
});

/**
 * Чтения протокола в панели (race-results-03 сводка и попытки; race-results-05 — фаза, протокол, чек-лист,
 * «Участники», история пересчётов). Видимость гонки — `RaceRegistry.findForPanel` (чужая гонка организатора — 404).
 * Чек-лист считает только сервер (`publishChecklist`).
 */
@Injectable()
export class ResultsPanelReadService {
  constructor(
    private readonly repository: ResultsRepository,
    private readonly directory: PanelDirectory,
    @Inject(RACE_REGISTRY) private readonly races: RaceRegistry,
    @Inject(ACTIVITY_SOURCE) private readonly activities: ActivitySource,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  /** Гонка в панели: невидимая сотруднику (чужая гонка организатора) — 404. */
  async race(principal: PanelPrincipal, raceId: string): Promise<RaceForResults> {
    const race = await this.races.findForPanel(principal, raceId);
    if (!race) throw notFound();
    return race;
  }

  /**
   * Чек-лист публикации гонки (§7.2): строки «необработанные треки» (`ActivitySource`), незавершённые проверки и
   * сбои (RC-1), окно загрузки (A5). `session` — транзакция публикации (то же вычисление, что видит панель).
   */
  async checks(race: RaceForResults, now: Date, session?: DbSession): Promise<ProtocolChecks> {
    const last = await this.repository.lastRecheck(race.id, session);
    const checks = await this.repository.pendingChecks(race.id, last.startedAt, session);
    const userIds = await this.repository.activeEntryUserIds(race.id, session);
    const closesAt = uploadClosesAt(race);
    const unprocessedTracks = await this.activities.countUnprocessed(
      userIds,
      race.windowStartsAt,
      closesAt,
      session,
    );
    const pending = checks.queued + checks.checking + checks.stale;
    return {
      publish: publishChecklist({
        race,
        now,
        uploadClosesAt: closesAt,
        // споры — слайс 06
        openDisputes: 0,
        unprocessedTracks,
        pendingChecks: pending,
        failedChecks: checks.failed,
      }),
      recheckStartedAt: last.startedAt,
      recheckAppliedAt: last.appliedAt,
      pending,
      failed: checks.failed,
    };
  }

  async summary(principal: PanelPrincipal, raceId: string): Promise<PanelRaceResults> {
    return this.summaryOf(await this.race(principal, raceId));
  }

  /** Сводка гонки (ответ чтения и действий панели). */
  async summaryOf(race: RaceForResults): Promise<PanelRaceResults> {
    const now = this.clock.now();
    const checks = await this.checks(race, now);
    let protocol: PanelRaceResults['protocol'] = null;
    if (race.protocolPublishedAt !== null) {
      const revision = (await this.repository.currentRevision(race.id)) ?? 1;
      const rows = await this.repository.countProtocolRows(race.id, revision);
      protocol = {
        publishedAt: race.protocolPublishedAt.toISOString(),
        revision,
        ranked: rows.ranked,
        disqualified: rows.disqualified,
        recheckPending: recheckPending(
          { startedAt: checks.recheckStartedAt, appliedAt: checks.recheckAppliedAt },
          race.protocolPublishedAt,
        ),
      };
    }
    return {
      raceId: race.id,
      lockedAt: race.lockedAt?.toISOString() ?? null,
      engineVersion: CORRIDOR_ENGINE_VERSION,
      counts: await this.repository.panelCounts(race.id, CORRIDOR_ENGINE_VERSION),
      phase: this.races.phase(race, now),
      uploadClosesAt: uploadClosesAt(race).toISOString(),
      protocol,
      recheck: checks.recheckStartedAt
        ? { startedAt: checks.recheckStartedAt.toISOString(), pending: checks.pending }
        : null,
      publish: checks.publish,
    };
  }

  async attempts(
    principal: PanelPrincipal,
    raceId: string,
    query: PanelRaceAttemptQuery,
  ): Promise<PanelRaceAttemptPage> {
    await this.race(principal, raceId);
    const afterId = query.cursor ? decodeCursor(query.cursor, AttemptCursorKey).id : null;
    const docs = await this.repository.panelAttempts(
      raceId,
      query.status,
      afterId,
      query.limit + 1,
    );
    const page = docs.slice(0, query.limit);
    const last = page.at(-1);
    const reviews = await this.repository.latestReviews(page.map((attempt) => attempt._id));
    return {
      items: page.map((attempt) => this.attemptView(attempt, reviews.get(attempt._id) ?? null)),
      nextCursor: docs.length > query.limit && last ? encodeCursor('a', last._id) : null,
    };
  }

  /** Попытка в панели: всё, включая скрытые, и последняя причина исключения/возврата (RC-10). */
  attemptView(attempt: RaceAttemptDoc, review: RaceAttemptReviewDoc | null): PanelRaceAttempt {
    return {
      id: attempt._id,
      entryId: attempt.entryId,
      userId: attempt.userId,
      activityId: attempt.activityId,
      origin: attempt.origin,
      status: attempt.status,
      hidden: attemptHidden(attempt),
      reasons: attempt.reasons,
      failure: attempt.failure,
      withdrawReason: attempt.withdrawReason,
      segment: segmentView(attempt.segment),
      engineVersion: attempt.engineVersion,
      checkRevision: attempt.checkRevision,
      checkAttempts: attempt.checkAttempts,
      diagnostics: attempt.diagnostics,
      createdAt: attempt.createdAt.toISOString(),
      checkedAt: attempt.checkedAt?.toISOString() ?? null,
      review: review
        ? { kind: review.kind, reason: review.reason, at: review.at.toISOString() }
        : null,
    };
  }

  /**
   * «Участники» (§7.6) в одной snapshot-сессии: до публикации — строки с местами по таблице (`rankRows`), затем прочие
   * заявки по времени заявки; после — строки текущей ревизии протокола, затем прочие заявки без места (RC-5).
   */
  async standings(principal: PanelPrincipal, raceId: string): Promise<PanelRaceStandings> {
    const race = await this.race(principal, raceId);
    const now = this.clock.now();
    const max = RESULTS_POLICY.standingsMax;
    return this.repository.withSnapshot(async (session) => {
      const revision =
        race.protocolPublishedAt !== null
          ? ((await this.repository.currentRevision(raceId, session)) ?? 1)
          : null;
      const head =
        revision === null
          ? await this.liveHead(raceId, session)
          : (await this.repository.protocolRows(raceId, revision, session)).map((row) =>
              this.protocolHead(row),
            );
      const headEntries = new Map(
        (
          await this.repository.entriesByIds(
            head.slice(0, max).map((row) => row.entryId),
            session,
          )
        ).map((entry) => [entry._id, entry]),
      );
      const headIds = new Set(head.map((row) => row.entryId));
      const rest = (
        await this.repository.entriesForStandings(raceId, max + head.length + 1, session)
      ).filter((entry) => !headIds.has(entry._id));
      const items: PanelStandingRow[] = [];
      for (const row of head.slice(0, max)) {
        const entry = headEntries.get(row.entryId);
        if (!entry) continue;
        items.push({
          ...row,
          userId: entry.userId,
          entryStatus: entry.status,
          summary: summaryView(entry.summary),
        });
      }
      for (const entry of rest.slice(0, Math.max(0, max - items.length))) {
        items.push({
          entryId: entry._id,
          userId: entry.userId,
          entryStatus: entry.status,
          resultStatus: resultStatus(entry, race, now, { ignoreBest: revision !== null }),
          place: null,
          tied: false,
          elapsedSec: null,
          bestAttemptId: null,
          summary: summaryView(entry.summary),
        });
      }
      return {
        source: revision === null ? 'live' : 'protocol',
        revision,
        truncated: head.length + rest.length > max,
        items,
      };
    });
  }

  /** Живые строки с местами: вся таблица гонки по порядку `(elapsedSec, startedAt, _id)`. */
  private async liveHead(raceId: string, session: DbSession) {
    const ranked = await this.repository.rankedEntries(raceId, session);
    const places = rankRows(
      ranked.map((entry) => ({ elapsedSec: entry.best.elapsedSec })),
      { lessThanFirst: 0, firstIndex: 0, equalCounts: new Map() },
    );
    return ranked.map((entry, index) => ({
      entryId: entry._id,
      resultStatus: 'provisional' as const,
      place: places[index]!.place,
      tied: places[index]!.tied,
      elapsedSec: entry.best.elapsedSec,
      bestAttemptId: entry.best.attemptId,
    }));
  }

  private protocolHead(row: RaceProtocolRowDoc) {
    return {
      entryId: row.entryId,
      resultStatus: row.status,
      place: row.place,
      tied: row.tied,
      elapsedSec: row.elapsedSec,
      bestAttemptId: row.attemptId,
    };
  }

  /** История пересчётов (новые сверху, ≤ 100): имя сотрудника — порт `PanelDirectory`. */
  async recalculations(
    principal: PanelPrincipal,
    raceId: string,
  ): Promise<PanelProtocolRecalculations> {
    await this.race(principal, raceId);
    const docs = await this.repository.listRecalculations(raceId, RESULTS_POLICY.recalculationsMax);
    const names = await this.directory.displayNames(docs.map((doc) => doc.actorUserId));
    return {
      items: docs.map((doc) => ({
        id: doc._id,
        kind: doc.kind,
        entryId: doc.entryId,
        revision: doc.revision,
        reason: doc.reason,
        actor: { userId: doc.actorUserId, displayName: names.get(doc.actorUserId) ?? '' },
        at: doc.at.toISOString(),
      })),
    };
  }
}
