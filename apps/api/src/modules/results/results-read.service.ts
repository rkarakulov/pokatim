import { Inject, Injectable } from '@nestjs/common';
import type {
  MyAttempt,
  MyRaceEntry,
  PanelRaceAttempt,
  PanelRaceAttemptPage,
  PanelRaceAttemptQuery,
  PanelRaceResults,
  PendingUpload,
  RaceResultsPage,
  RaceResultsQuery,
} from '@pokatim/contracts';
import { CORRIDOR_ENGINE_VERSION } from '@pokatim/tracks/parse';
import { CLOCK, type Clock } from '@rkarakulov/api-kit/core';
import { z } from 'zod';

import { domainError } from '../../error-messages';
import { decodeCursor, encodeCursor } from '../../page-cursor';
import type { PanelPrincipal } from '../panel';
import { RACE_REGISTRY, type RaceForResults, type RaceRegistry } from '../races';
import { ACTIVITY_SOURCE, type ActivitySource } from '../tracks';
import type { AttemptSegmentDoc, RaceAttemptDoc, RaceEntryDoc } from './results.collection';
import {
  attemptHidden,
  entryActions,
  rankRows,
  RESULTS_POLICY,
  resultStatus,
  uploadClosesAt,
} from './results.policy';
import { type RankPosition, ResultsRepository } from './results.repository';

const notFound = () => domainError('NOT_FOUND', 404);

/** Курсор таблицы: `<elapsedSec>.<startedAt, мс>` + `_id` последней строки. */
const RankCursorKey = z.string().regex(/^\d{1,9}\.\d{1,15}$/);
/** Курсор попыток панели: только `_id` (новые сверху). */
const AttemptCursorKey = z.literal('a');

const segmentView = (segment: AttemptSegmentDoc | null) =>
  segment
    ? {
        startedAt: segment.startedAt.toISOString(),
        finishedAt: segment.finishedAt.toISOString(),
        elapsedSec: segment.elapsedSec,
        distanceM: segment.distanceM,
        offCorridorM: segment.offCorridorM,
        offCorridorShare: segment.offCorridorShare,
        maxExcursionM: segment.maxExcursionM,
        coverage: segment.coverage,
      }
    : null;

/**
 * Чтение участия и результатов (race-results-03): «моё участие» (только свои попытки, без скрытых), публичная
 * предварительная таблица (анонимные строки, места при чтении в snapshot-сессии), панель — сводка и попытки.
 */
@Injectable()
export class ResultsReadService {
  constructor(
    private readonly repository: ResultsRepository,
    @Inject(RACE_REGISTRY) private readonly races: RaceRegistry,
    @Inject(ACTIVITY_SOURCE) private readonly activities: ActivitySource,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  /** Опубликованная или отменённая гонка; черновик и неизвестная — 404. */
  async race(raceId: string): Promise<RaceForResults> {
    const race = await this.races.get(raceId);
    if (!race) throw notFound();
    return race;
  }

  async myEntry(userId: string, raceId: string): Promise<MyRaceEntry> {
    const race = await this.race(raceId);
    const now = this.clock.now();
    const entry = (await this.repository.findEntry(raceId, userId)) ?? null;
    const attempts = entry ? await this.repository.attemptsOfEntry(entry._id) : [];
    const standing = await this.standing(raceId, entry);
    return {
      raceId,
      entry: entry
        ? {
            id: entry._id,
            status: entry.status,
            createdAt: entry.createdAt.toISOString(),
            withdrawnAt: entry.withdrawnAt?.toISOString() ?? null,
          }
        : null,
      result: {
        status: resultStatus(entry, race, now),
        elapsedSec: standing.place === null ? null : (entry?.best?.elapsedSec ?? null),
        place: standing.place,
        tied: standing.tied,
        ranked: standing.ranked,
        group: RESULTS_POLICY.groupKey,
      },
      attempts: attempts
        .filter((attempt) => !attemptHidden(attempt))
        .map((attempt) => this.myAttempt(attempt, entry)),
      pendingUploads: entry ? await this.pendingUploads(entry) : [],
      uploadClosesAt: uploadClosesAt(race).toISOString(),
      actions: entryActions(race, this.races.phase(race, now), entry, now),
    };
  }

  /** Место своей строки (активная заявка с лучшим) и число строк — в одной snapshot-сессии. */
  private standing(
    raceId: string,
    entry: RaceEntryDoc | null,
  ): Promise<{ place: number | null; tied: boolean; ranked: number }> {
    return this.repository.withSnapshot(async (session) => {
      const ranked = await this.repository.countRanked(raceId, session);
      const best = entry?.status === 'active' ? entry.best : null;
      if (!best) return { place: null, tied: false, ranked };
      const less = await this.repository.countRankedLess(raceId, best.elapsedSec, session);
      const equal = await this.repository.countRankedEqual(raceId, best.elapsedSec, session);
      return { place: less + 1, tied: equal >= 2, ranked };
    });
  }

  private myAttempt(attempt: RaceAttemptDoc, entry: RaceEntryDoc | null): MyAttempt {
    return {
      id: attempt._id,
      origin: attempt.origin,
      status: attempt.status,
      reasons: attempt.reasons,
      segment: segmentView(attempt.segment),
      isBest: entry?.best?.attemptId === attempt._id,
      activity: {
        id: attempt.activityId,
        startedAt: attempt.activity.startedAt.toISOString(),
        source: attempt.activity.source,
        elapsedSec: attempt.activity.elapsedSec,
        distanceM: Math.round(attempt.activity.distanceM),
      },
      createdAt: attempt.createdAt.toISOString(),
      checkedAt: attempt.checkedAt?.toISOString() ?? null,
    };
  }

  /** Запросы «загрузить в гонку» без попытки — статус файла (удалённая загрузка — без строки). */
  private async pendingUploads(entry: RaceEntryDoc): Promise<PendingUpload[]> {
    const waiting = entry.requests.filter((request) => request.attemptId === null);
    if (waiting.length === 0) return [];
    const states = await this.activities.uploadStates(
      entry.userId,
      waiting.map((request) => request.uploadId),
    );
    return waiting.flatMap((request) => {
      const state = states.get(request.uploadId);
      return state ? [{ uploadId: request.uploadId, ...state }] : [];
    });
  }

  /**
   * Публичная предварительная таблица (без ПДн: `entryId`, место, ничья, время сегмента). Отменённая или без
   * коридора — пусто. Страница и счётчики мест — в одной snapshot-сессии.
   */
  async publicResults(raceId: string, query: RaceResultsQuery): Promise<RaceResultsPage> {
    const race = await this.race(raceId);
    const after = query.cursor ? this.decodeRankCursor(query.cursor) : null;
    const empty = race.status === 'cancelled' || race.corridor === null;
    return this.repository.withSnapshot(async (session) => {
      const entries = await this.repository.countActiveEntries(raceId, session);
      const base = {
        group: RESULTS_POLICY.groupKey,
        status: 'provisional' as const,
        entries,
      };
      if (empty) return { ...base, ranked: 0, items: [], nextCursor: null };
      const ranked = await this.repository.countRanked(raceId, session);
      const rows = await this.repository.rankedPage(raceId, after, query.limit + 1, session);
      const page = rows.slice(0, query.limit);
      const first = page[0];
      const last = page.at(-1);
      if (!first || !last) return { ...base, ranked, items: [], nextCursor: null };
      const lessThanFirst = await this.repository.countRankedLess(
        raceId,
        first.best.elapsedSec,
        session,
      );
      const firstIndex = after ? await this.repository.countRankedUpTo(raceId, after, session) : 0;
      const equalCounts = new Map<number, number>();
      for (const elapsedSec of new Set([first.best.elapsedSec, last.best.elapsedSec])) {
        equalCounts.set(
          elapsedSec,
          await this.repository.countRankedEqual(raceId, elapsedSec, session),
        );
      }
      const places = rankRows(
        page.map((row) => ({ elapsedSec: row.best.elapsedSec })),
        { lessThanFirst, firstIndex, equalCounts },
      );
      return {
        ...base,
        ranked,
        items: page.map((row, index) => ({
          entryId: row._id,
          place: places[index]!.place,
          tied: places[index]!.tied,
          elapsedSec: row.best.elapsedSec,
        })),
        nextCursor:
          rows.length > query.limit
            ? encodeCursor(`${last.best.elapsedSec}.${last.best.startedAt.getTime()}`, last._id)
            : null,
      };
    });
  }

  private decodeRankCursor(raw: string): RankPosition {
    const { k, id } = decodeCursor(raw, RankCursorKey);
    const [elapsed, started] = k.split('.');
    return { elapsedSec: Number(elapsed), startedAt: new Date(Number(started)), id };
  }

  /** Гонка в панели: невидимая сотруднику (чужая гонка организатора) — 404. */
  private async panelRace(principal: PanelPrincipal, raceId: string): Promise<RaceForResults> {
    const race = await this.races.findForPanel(principal, raceId);
    if (!race) throw notFound();
    return race;
  }

  async panelSummary(principal: PanelPrincipal, raceId: string): Promise<PanelRaceResults> {
    const race = await this.panelRace(principal, raceId);
    return {
      raceId,
      lockedAt: race.lockedAt?.toISOString() ?? null,
      engineVersion: CORRIDOR_ENGINE_VERSION,
      counts: await this.repository.panelCounts(raceId, CORRIDOR_ENGINE_VERSION),
    };
  }

  async panelAttempts(
    principal: PanelPrincipal,
    raceId: string,
    query: PanelRaceAttemptQuery,
  ): Promise<PanelRaceAttemptPage> {
    await this.panelRace(principal, raceId);
    const afterId = query.cursor ? decodeCursor(query.cursor, AttemptCursorKey).id : null;
    const docs = await this.repository.panelAttempts(
      raceId,
      query.status,
      afterId,
      query.limit + 1,
    );
    const page = docs.slice(0, query.limit);
    const last = page.at(-1);
    return {
      items: page.map((attempt) => this.panelAttempt(attempt)),
      nextCursor: docs.length > query.limit && last ? encodeCursor('a', last._id) : null,
    };
  }

  private panelAttempt(attempt: RaceAttemptDoc): PanelRaceAttempt {
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
    };
  }
}
