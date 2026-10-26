import { Inject, Injectable } from '@nestjs/common';
import type {
  MyAttempt,
  MyRaceEntry,
  PendingUpload,
  RaceResultStatus,
  RaceResultsPage,
  RaceResultsQuery,
} from '@pokatim/contracts';
import { CLOCK, type Clock } from '@rkarakulov/api-kit/core';
import { z } from 'zod';

import type { DbSession } from '../../db';
import { domainError } from '../../error-messages';
import { decodeCursor, encodeCursor } from '../../page-cursor';
import { RACE_REGISTRY, type RaceForResults, type RaceRegistry } from '../races';
import { ACTIVITY_SOURCE, type ActivitySource } from '../tracks';
import { RESULT_DISPUTE_GATE, type ResultDisputeGate } from './result-dispute-gate.port';
import type {
  AttemptSegmentDoc,
  RaceAttemptDoc,
  RaceEntryDoc,
  RaceProtocolRowDoc,
} from './results.collection';
import {
  attemptHidden,
  disqualifiedBeforePublication,
  entryActions,
  rankRows,
  RESULTS_POLICY,
  resultStatus,
  uploadClosesAt,
} from './results.policy';
import { ResultsRepository } from './results.repository';

const notFound = () => domainError('NOT_FOUND', 404);

/** Статус, время и место участника (без группы) — «моё участие» и место цели спора. */
export type EntryResult = Omit<MyRaceEntry['result'], 'group' | 'status'> & {
  status: RaceResultStatus;
};
const invalidCursor = () =>
  domainError('VALIDATION_FAILED', 400, { fields: [{ path: 'cursor', code: 'INVALID' }] });

/**
 * Курсор таблицы — только `entryId` последней строки (публичный id строки): время старта сегмента наружу не выходит
 * (AC21), позицию сортировки сервер берёт из самой строки.
 */
const RankCursorKey = z.literal('e');
/** Сегмент попытки наружу: без координат и датчиков (приложение и панель). */
export const segmentView = (segment: AttemptSegmentDoc | null) =>
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
 * Чтение участия и результатов приложения (race-results-03): «моё участие» (только свои попытки, без скрытых),
 * публичная таблица (анонимные строки). До публикации протокола места считаются при чтении в snapshot-сессии; после
 * (race-results-05, §7.7) — только из текущей ревизии снимка протокола. Панель — `ResultsPanelReadService`.
 */
@Injectable()
export class ResultsReadService {
  constructor(
    private readonly repository: ResultsRepository,
    @Inject(RACE_REGISTRY) private readonly races: RaceRegistry,
    @Inject(ACTIVITY_SOURCE) private readonly activities: ActivitySource,
    @Inject(RESULT_DISPUTE_GATE) private readonly disputes: ResultDisputeGate,
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
    // заявка, попытки и место — из одного снимка БД (согласованы `best`, `isBest` и место)
    const { entry, attempts, result, openDisputes } = await this.repository.withSnapshot(
      async (session) => {
        const found = (await this.repository.findEntry(raceId, userId, session)) ?? null;
        return {
          entry: found,
          attempts: found ? await this.repository.attemptsOfEntry(found._id, session) : [],
          result: await this.entryResult(race, found, now, session),
          // D-39: открытые споры против своей заявки закрывают отмену участия и новые попытки
          openDisputes: found ? await this.disputes.openAgainst(found._id, session) : 0,
        };
      },
    );
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
      result: { ...result, group: RESULTS_POLICY.groupKey },
      attempts: attempts
        .filter((attempt) => !attemptHidden(attempt))
        .map((attempt) => this.myAttempt(attempt, entry)),
      pendingUploads: entry ? await this.pendingUploads(entry) : [],
      uploadClosesAt: uploadClosesAt(race).toISOString(),
      actions: entryActions(race, this.races.phase(race, now), entry, now, { openDisputes }),
    };
  }

  /**
   * Статус, время и место участника — «моё участие» и место цели спора (race-results-06, порт `ResultsForDisputes`):
   * до публикации — при чтении, после — из текущей ревизии протокола. Сессия — snapshot вызывающего.
   */
  entryResult(
    race: RaceForResults,
    entry: RaceEntryDoc | null,
    now: Date,
    session: DbSession,
  ): Promise<EntryResult> {
    return race.protocolPublishedAt !== null
      ? this.protocolResult(race, entry, now, session)
      : this.liveResult(race, entry, now, session);
  }

  /**
   * До публикации: место своей строки (активная заявка с лучшим) и число строк — в snapshot-сессии вызывающего. DQ по
   * спору (RC-16): `dq` без места, время лучшего результата показывается.
   */
  private async liveResult(
    race: RaceForResults,
    entry: RaceEntryDoc | null,
    now: Date,
    session: DbSession,
  ): Promise<EntryResult> {
    const ranked = await this.repository.countRanked(race.id, session);
    const status = resultStatus(entry, race, now);
    const best = entry?.status === 'active' ? entry.best : null;
    if (!best) return { status, elapsedSec: null, place: null, tied: false, ranked };
    if (entry && disqualifiedBeforePublication(entry, race)) {
      return { status, elapsedSec: best.elapsedSec, place: null, tied: false, ranked };
    }
    const less = await this.repository.countRankedLess(race.id, best.elapsedSec, session);
    const equal = await this.repository.countRankedEqual(race.id, best.elapsedSec, session);
    return { status, elapsedSec: best.elapsedSec, place: less + 1, tied: equal >= 2, ranked };
  }

  /**
   * После публикации (§7.7, RC-5): строка участника в текущей ревизии — её статус, место и время (DQ — без места,
   * время показывается); строки нет — без места и времени, статус по заявке без живого лучшего результата.
   */
  private async protocolResult(
    race: RaceForResults,
    entry: RaceEntryDoc | null,
    now: Date,
    session: DbSession,
  ): Promise<EntryResult> {
    const revision = await this.protocolRevision(race.id, session);
    const { ranked } = await this.repository.countProtocolRows(race.id, revision, session);
    const row = entry
      ? await this.repository.protocolRow(race.id, revision, entry._id, session)
      : undefined;
    if (!row) {
      return {
        status: resultStatus(entry, race, now, { ignoreBest: true }),
        elapsedSec: null,
        place: null,
        tied: false,
        ranked,
      };
    }
    return {
      status: row.status,
      elapsedSec: row.elapsedSec,
      place: row.place,
      tied: row.tied,
      ranked,
    };
  }

  /** Текущая ревизия опубликованного протокола (журнал пересчётов; публикация пишет ревизию 1). */
  private async protocolRevision(raceId: string, session: DbSession): Promise<number> {
    return (await this.repository.currentRevision(raceId, session)) ?? 1;
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
   * коридора — пусто. Страница и счётчики мест — в одной snapshot-сессии. Курсор — строка этой таблицы: выбыла
   * (отмена участия, снятие лучшего) или чужая гонка — `400` на поле `cursor`, клиент начинает сначала.
   */
  async publicResults(raceId: string, query: RaceResultsQuery): Promise<RaceResultsPage> {
    const race = await this.race(raceId);
    const cursorEntryId = query.cursor ? decodeCursor(query.cursor, RankCursorKey).id : null;
    const empty = race.status === 'cancelled' || race.corridor === null;
    if (!empty && race.protocolPublishedAt !== null) {
      return this.protocolResults(raceId, cursorEntryId, query.limit);
    }
    return this.repository.withSnapshot(async (session) => {
      const entries = await this.repository.countActiveEntries(raceId, session);
      const base = {
        group: RESULTS_POLICY.groupKey,
        status: 'provisional' as const,
        entries,
      };
      if (empty) return { ...base, ranked: 0, items: [], nextCursor: null };
      const after = cursorEntryId
        ? await this.repository.rankedPosition(raceId, cursorEntryId, session)
        : null;
      if (cursorEntryId && !after) throw invalidCursor();
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
        nextCursor: rows.length > query.limit ? encodeCursor('e', last._id) : null,
      };
    });
  }

  /**
   * Таблица опубликованного протокола (§7.7): строки текущей ревизии без DQ по `order`, `status: 'final'`. Курсор —
   * `entryId` строки (позиция — её `order`); строка DQ или не из ревизии — `400` на поле `cursor`.
   */
  private protocolResults(
    raceId: string,
    cursorEntryId: string | null,
    limit: number,
  ): Promise<RaceResultsPage> {
    return this.repository.withSnapshot(async (session) => {
      const revision = await this.protocolRevision(raceId, session);
      let afterOrder: number | null = null;
      if (cursorEntryId) {
        const at = await this.repository.protocolRow(raceId, revision, cursorEntryId, session);
        if (!at || at.status === 'dq') throw invalidCursor();
        afterOrder = at.order;
      }
      const entries = await this.repository.countActiveEntries(raceId, session);
      const { ranked } = await this.repository.countProtocolRows(raceId, revision, session);
      const rows = await this.repository.protocolRowsPage(
        raceId,
        revision,
        afterOrder,
        limit + 1,
        session,
      );
      const page = rows.slice(0, limit);
      const last = page.at(-1);
      return {
        group: RESULTS_POLICY.groupKey,
        status: 'final' as const,
        entries,
        ranked,
        items: page.flatMap((row: RaceProtocolRowDoc) =>
          row.place === null
            ? []
            : [
                {
                  entryId: row.entryId,
                  place: row.place,
                  tied: row.tied,
                  elapsedSec: row.elapsedSec,
                },
              ],
        ),
        nextCursor: rows.length > limit && last ? encodeCursor('e', last.entryId) : null,
      };
    });
  }
}
