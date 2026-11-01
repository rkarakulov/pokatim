import { Inject, Injectable } from '@nestjs/common';
import type {
  PanelProtocolRecalculations,
  PanelRaceAttempt,
  PanelRaceAttemptPage,
  PanelRaceAttemptQuery,
  PanelRaceResults,
  PanelRaceStandings,
  PanelRaceStandingsQuery,
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
import { RIDER_NAMES, type RiderNameDirectory } from '../profile';
import { RACE_REGISTRY, type RaceForResults, type RaceRegistry } from '../races';
import { ACTIVITY_SOURCE, type ActivitySource } from '../tracks';
import { RESULT_DISPUTE_GATE, type ResultDisputeGate } from './result-dispute-gate.port';
import type {
  RaceAttemptDoc,
  RaceAttemptReviewDoc,
  RaceEntryDoc,
  RaceProtocolRowDoc,
} from './results.collection';
import {
  attemptHidden,
  buildProtocol,
  type ProtocolBase,
  publishChecklist,
  recheckPending,
  RESULTS_POLICY,
  resultStatus,
  unrankedOf,
  uploadClosesAt,
} from './results.policy';
import { segmentView } from './results-read.service';
import {
  type GroupCount,
  type RankedEntry,
  ResultsRepository,
  type StandingsFilter,
} from './results.repository';

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

/** Строка с местом → база протокола (общая для живых «Участников» и ревизий протокола). */
export const protocolBaseOf = (entry: RankedEntry, dq: boolean): ProtocolBase => ({
  entryId: entry._id,
  userId: entry.userId,
  attemptId: entry.best.attemptId,
  elapsedSec: entry.best.elapsedSec,
  startedAt: entry.best.startedAt,
  dq,
  // race-results-07: группа заявки и флаги датчиков лучшей попытки (DV-9); скорость считает `buildProtocol`
  groupKey: entry.groupKey,
  flags: entry.best.flags ?? [],
});

type StandingItem = Omit<PanelStandingRow, 'riderName'>;

/** Строки «Участников» после фильтров, не больше `standingsMax` (`standingItems`). */
interface StandingItems {
  revision: number | null;
  groups: GroupCount[];
  items: StandingItem[];
  /** отфильтрованных строк больше `standingsMax` */
  overflow: boolean;
}

/** Непустые группы живых строк с местом по порядку строк (`buildProtocol` — порядок справочника). */
const countGroups = (head: readonly { groupKey: GroupCount['key']; place: number | null }[]) => {
  const groups: GroupCount[] = [];
  for (const row of head) {
    if (row.place === null) continue;
    const last = groups.at(-1);
    if (last?.key === row.groupKey) last.ranked += 1;
    else groups.push({ key: row.groupKey, ranked: 1 });
  }
  return groups;
};

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
 * Чек-лист считает только сервер (`publishChecklist`). Публичное имя райдера (profile-02) — порт `RIDER_NAMES` (только
 * с согласием), один вызов на ответ, после snapshot-сессии; в снимок не пишется.
 */
@Injectable()
export class ResultsPanelReadService {
  constructor(
    private readonly repository: ResultsRepository,
    private readonly directory: PanelDirectory,
    @Inject(RACE_REGISTRY) private readonly races: RaceRegistry,
    @Inject(ACTIVITY_SOURCE) private readonly activities: ActivitySource,
    @Inject(RESULT_DISPUTE_GATE) private readonly disputes: ResultDisputeGate,
    @Inject(RIDER_NAMES) private readonly names: RiderNameDirectory,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  /** Гонка в панели: невидимая сотруднику (чужая гонка организатора) — 404. */
  async race(principal: PanelPrincipal, raceId: string): Promise<RaceForResults> {
    const race = await this.races.findForPanel(principal, raceId);
    if (!race) throw notFound();
    return race;
  }

  /**
   * Чек-лист публикации гонки (§7.2): открытые споры (гейт `disputes`), «необработанные треки» (`ActivitySource`),
   * незавершённые проверки и сбои (RC-1), окно загрузки (A5). `session` — транзакция публикации (то же вычисление, что видит панель).
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
        // race-results-06: в транзакции публикации — то же чтение, что видит панель (подача берёт `lockResults`)
        openDisputes: await this.disputes.openInRace(race.id, session),
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
      const rows = await this.repository.countProtocolRows(race.id, revision, null);
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
    const counts = await this.repository.panelCounts(race.id, CORRIDOR_ENGINE_VERSION);
    // race-results-07: «Требует внимания» — строки «Участников» с флагами; финишёры — время без места
    const { attention, finishers } = await this.repository.withSnapshot(async (session) => ({
      attention: await this.attentionCount(race, session),
      finishers: await this.repository.countFinishers(race.id, session),
    }));
    return {
      raceId: race.id,
      lockedAt: race.lockedAt?.toISOString() ?? null,
      groupScheme: race.groupScheme,
      engineVersion: CORRIDOR_ENGINE_VERSION,
      counts: { ...counts, attention, finishers },
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
    const names = await this.names.publicNames(page.map((attempt) => attempt.userId));
    return {
      items: page.map((attempt) =>
        this.attemptView(
          attempt,
          reviews.get(attempt._id) ?? null,
          names.get(attempt.userId) ?? null,
        ),
      ),
      nextCursor: docs.length > query.limit && last ? encodeCursor('a', last._id) : null,
    };
  }

  /** Попытка с именем райдера (ответы действий «Исключить»/«Вернуть»): один вызов порта. */
  async namedAttemptView(
    attempt: RaceAttemptDoc,
    review: RaceAttemptReviewDoc | null,
  ): Promise<PanelRaceAttempt> {
    const names = await this.names.publicNames([attempt.userId]);
    return this.attemptView(attempt, review, names.get(attempt.userId) ?? null);
  }

  /** Попытка в панели: всё, включая скрытые, и последняя причина исключения/возврата (RC-10). */
  private attemptView(
    attempt: RaceAttemptDoc,
    review: RaceAttemptReviewDoc | null,
    riderName: string | null,
  ): PanelRaceAttempt {
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
      riderName,
      // race-results-07: датчики и флаги датчиков попытки (попытки до 07 — `null` / `[]`)
      // источник датчиков — с 07a pass 2; раньше только отсчёты файла (`samples`)
      sensors: attempt.sensors
        ? { ...attempt.sensors, source: attempt.sensors.source ?? 'samples' }
        : null,
      flags: attempt.flags ?? [],
      flagsVersion: attempt.flagsVersion ?? null,
    };
  }

  /**
   * «Участники» (§7.6) в одной snapshot-сессии: до публикации — строки с местами по группам (`buildProtocol` без DQ —
   * те же места и флаги, что даст публикация), затем прочие заявки по времени заявки (финишёры — с временем и
   * причиной); после — строки текущей ревизии протокола, затем прочие заявки без места (RC-5). Фильтры
   * (race-results-07): `group` — строки группы, `attention` — только с флагами, `finishers` — только финишёры без
   * места (блок панели — отдельным запросом, за пределом «Участников» не теряется).
   */
  async standings(
    principal: PanelPrincipal,
    raceId: string,
    query: PanelRaceStandingsQuery = {},
  ): Promise<PanelRaceStandings> {
    const race = await this.race(principal, raceId);
    const now = this.clock.now();
    const filter: StandingsFilter = {
      ...(query.group === undefined ? {} : { group: query.group }),
      ...(query.attention === undefined ? {} : { attention: true }),
      ...(query.finishers === undefined ? {} : { finishers: true }),
    };
    const all = await this.repository.withSnapshot((session) =>
      this.standingItems(race, now, session, filter),
    );
    // имена — после snapshot-сессии, одним вызовом порта (в снимок не пишутся)
    const names = await this.names.publicNames(all.items.map((row) => row.userId));
    return {
      source: all.revision === null ? 'live' : 'protocol',
      revision: all.revision,
      groupScheme: race.groupScheme,
      groups: all.groups,
      truncated: all.overflow,
      items: all.items.map((row) => ({ ...row, riderName: names.get(row.userId) ?? null })),
    };
  }

  /**
   * Строки с местами гонки: до публикации — живые (`buildProtocol` без DQ), после — текущая ревизия протокола. Всегда
   * полный набор: места и `SPEED_CLUSTER_HIGH` считаются по всем ранжированным, а не по странице ответа.
   */
  private async rankedHead(race: RaceForResults, session: DbSession) {
    const revision =
      race.protocolPublishedAt !== null
        ? ((await this.repository.currentRevision(race.id, session)) ?? 1)
        : null;
    const head =
      revision === null
        ? await this.liveHead(race.id, session)
        : (await this.repository.protocolRows(race.id, revision, session)).map((row) =>
            this.protocolHead(row),
          );
    return { revision, head };
  }

  /** «Требует внимания»: строки с местом и флагами + финишёры с флагами — по всей гонке, без предела ответа. */
  private async attentionCount(race: RaceForResults, session: DbSession): Promise<number> {
    const { head } = await this.rankedHead(race, session);
    const headIds = new Set(head.map((row) => row.entryId));
    const rest = await this.repository.attentionEntryIds(race.id, session);
    return (
      head.filter((row) => row.flags.length > 0).length +
      rest.filter((id) => !headIds.has(id)).length
    );
  }

  /**
   * Строки «Участников» с фильтрами (race-results-07) — фильтры до предела `standingsMax`: сначала строки с местами
   * (полный набор), затем прочие заявки по времени заявки; `overflow` — по отфильтрованному набору.
   */
  private async standingItems(
    race: RaceForResults,
    now: Date,
    session: DbSession,
    filter: StandingsFilter,
  ): Promise<StandingItems> {
    const raceId = race.id;
    const max = RESULTS_POLICY.standingsMax;
    const { revision, head } = await this.rankedHead(race, session);
    const groups =
      revision === null
        ? countGroups(head)
        : await this.repository.protocolGroups(raceId, revision, session);
    const matches = (row: Pick<StandingItem, 'groupKey' | 'flags'>) =>
      (filter.group === undefined || row.groupKey === filter.group) &&
      (!filter.attention || row.flags.length > 0);
    // строки с местом — не финишёры
    const headRows = filter.finishers ? [] : head.filter(matches);
    const headEntries = new Map(
      (
        await this.repository.entriesByIds(
          headRows.slice(0, max).map((row) => row.entryId),
          session,
        )
      ).map((entry) => [entry._id, entry]),
    );
    const headIds = new Set(head.map((row) => row.entryId));
    const rest = (
      await this.repository.entriesForStandings(raceId, filter, max + head.length + 1, session)
    ).filter((entry) => !headIds.has(entry._id));
    const items: StandingItem[] = [];
    for (const row of headRows.slice(0, max)) {
      const entry = headEntries.get(row.entryId);
      if (!entry) continue;
      items.push({
        ...row,
        userId: entry.userId,
        entryStatus: entry.status,
        summary: summaryView(entry.summary),
        tier: entry.tier ?? 'verified',
        unranked: null,
      });
    }
    const restRows: StandingItem[] = [];
    for (const entry of rest) {
      // финишёры (START, без пульса) — время лучшей попытки и причина без места
      const unranked = entry.status === 'active' ? unrankedOf(entry) : null;
      const best = unranked ? entry.best : null;
      const row: StandingItem = {
        entryId: entry._id,
        userId: entry.userId,
        entryStatus: entry.status,
        resultStatus: resultStatus(entry, race, now, { ignoreBest: revision !== null }),
        place: null,
        tied: false,
        elapsedSec: best?.elapsedSec ?? null,
        bestAttemptId: best?.attemptId ?? null,
        summary: summaryView(entry.summary),
        tier: entry.tier ?? 'verified',
        groupKey: entry.groupKey,
        unranked,
        flags: best?.flags ?? [],
      };
      if (matches(row) && (!filter.finishers || unranked !== null)) restRows.push(row);
    }
    items.push(...restRows.slice(0, Math.max(0, max - items.length)));
    return { revision, groups, items, overflow: headRows.length + restRows.length > max };
  }

  /**
   * Живые строки с местами: все группы гонки, места внутри группы и флаги (датчики + скорость) — `buildProtocol` над
   * строками с местом без DQ (DQ по спору до публикации в таблицу не входят).
   */
  private async liveHead(raceId: string, session: DbSession) {
    const ranked = await this.repository.rankedEntries(raceId, session);
    return buildProtocol(
      ranked.map((entry) => protocolBaseOf(entry, false)),
      null,
    ).map((row) => ({
      entryId: row.entryId,
      resultStatus: 'provisional' as const,
      place: row.place,
      tied: row.tied,
      elapsedSec: row.elapsedSec,
      bestAttemptId: row.attemptId,
      groupKey: row.groupKey ?? 'overall',
      flags: row.flags ?? [],
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
      // ревизии до race-results-07 — `overall` без флагов (RC-8)
      groupKey: row.groupKey ?? 'overall',
      flags: row.flags ?? [],
    };
  }

  /**
   * История пересчётов (новые сверху, ≤ 100): имя сотрудника — порт `PanelDirectory`; имя райдера заявки — порт
   * `RIDER_NAMES` (Q2 profile.md, один вызов на ответ), в журнал не пишется.
   */
  async recalculations(
    principal: PanelPrincipal,
    raceId: string,
  ): Promise<PanelProtocolRecalculations> {
    await this.race(principal, raceId);
    const docs = await this.repository.listRecalculations(raceId, RESULTS_POLICY.recalculationsMax);
    const entryIds = [...new Set(docs.flatMap((doc) => (doc.entryId ? [doc.entryId] : [])))];
    const [names, entries] = await Promise.all([
      this.directory.displayNames(docs.map((doc) => doc.actorUserId)),
      this.repository.entriesByIds(entryIds),
    ]);
    const users = new Map(entries.map((entry) => [entry._id, entry.userId]));
    const riders = await this.names.publicNames([...new Set(users.values())]);
    const riderName = (entryId: string | null) => {
      const userId = entryId ? users.get(entryId) : undefined;
      return userId ? (riders.get(userId) ?? null) : null;
    };
    return {
      items: docs.map((doc) => ({
        id: doc._id,
        kind: doc.kind,
        entryId: doc.entryId,
        riderName: riderName(doc.entryId),
        revision: doc.revision,
        reason: doc.reason,
        actor: { userId: doc.actorUserId, displayName: names.get(doc.actorUserId) ?? '' },
        at: doc.at.toISOString(),
      })),
    };
  }
}
