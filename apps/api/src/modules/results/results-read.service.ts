import { Inject, Injectable } from '@nestjs/common';
import type {
  MyAttempt,
  MyAttemptTrack,
  MyRaceEntry,
  PendingUpload,
  RaceFinishersPage,
  RaceFinishersQuery,
  RaceResultRow,
  RaceResultStatus,
  RaceResultsPage,
  RaceResultsQuery,
  ResultGroupKey,
} from '@pokatim/contracts';
import { CLOCK, type Clock } from '@rkarakulov/api-kit/core';
import { z } from 'zod';

import type { DbSession } from '../../db';
import { domainError } from '../../error-messages';
import { decodeCursor, encodeCursor } from '../../page-cursor';
import {
  RIDER_NAMES,
  type PublicRiderCard,
  riderRowFields,
  type RiderNameDirectory,
  VERIFIED_PROFILES,
  type VerifiedProfiles,
} from '../profile';
import { RACE_REGISTRY, type RaceForResults, type RaceRegistry } from '../races';
import { ACTIVITY_SOURCE, type ActivitySource } from '../tracks';
import { RESULT_DISPUTE_GATE, type ResultDisputeGate } from './result-dispute-gate.port';
import type { SocialRaceResult } from './results-for-social.port';
import type {
  AttemptSegmentDoc,
  RaceAttemptDoc,
  RaceEntryDoc,
  RaceProtocolRowDoc,
} from './results.collection';
import {
  allowedGroups,
  attemptHidden,
  disqualifiedBeforePublication,
  entryActions,
  isPublicProtocolRow,
  ownGroup,
  publicTableMode,
  rankRows,
  resultStatus,
  storyCardEligible,
  unrankedOf,
  uploadClosesAt,
} from './results.policy';
import { type GroupCount, ResultsRepository } from './results.repository';

const notFound = () => domainError('NOT_FOUND', 404);

/** Статус, время и место участника (без группы) — «моё участие» и место цели спора. */
export type EntryResult = Omit<MyRaceEntry['result'], 'group' | 'status' | 'unranked'> & {
  status: RaceResultStatus;
  unranked: ReturnType<typeof unrankedOf>;
};

/** Группа строк участника: заявки нет — `overall`. */
const groupOfEntry = (entry: Pick<RaceEntryDoc, 'groupKey'> | null): ResultGroupKey =>
  entry?.groupKey ?? 'overall';

/**
 * Группа публичной таблицы по умолчанию (RC-10): `overall` в схеме `overall`, иначе первая непустая, иначе `m_u40`.
 */
/** Гонок с протоколом за окно Главной «Свои» — не больше (social-p7, RC-P7-16). */
const RECENT_PROTOCOL_RACES = 20;

const defaultGroup = (race: RaceForResults, groups: readonly GroupCount[]): ResultGroupKey =>
  race.groupScheme === 'overall' ? 'overall' : (groups[0]?.key ?? 'm_u40');
const invalidCursor = () =>
  domainError('VALIDATION_FAILED', 400, { fields: [{ path: 'cursor', code: 'INVALID' }] });

/**
 * Курсор таблицы — только `entryId` последней строки (публичный id строки): время старта сегмента наружу не выходит
 * (AC21), позицию сортировки сервер берёт из самой строки.
 */
const RankCursorKey = z.literal('e');
/** Курсор финишёров — `entryId` последней строки (race-results-07). */
const FinisherCursorKey = z.literal('f');
/** Строка таблицы до подстановки имени: `userId` — только для порта имён, наружу не выходит. */
interface UnnamedRow {
  userId: string;
  /** номер заявки в гонке (N7); наружу — только `riderNo` строки без имени */
  entryNo: number | null;
  row: Omit<RaceResultRow, 'riderName' | 'riderNo' | 'riderPublicId' | 'riderAvatar'>;
}

/**
 * Поля райдера публичной строки: имя, ссылка и фото — по согласию (порт `RIDER_NAMES`); без имени — номер заявки в
 * гонке `riderNo` («Райдер #N», name-consent-prompt N7), с именем номер не уходит.
 */
const raceRiderFields = (card: PublicRiderCard | undefined, entryNo: number | null) => {
  const fields = riderRowFields(card);
  return { ...fields, riderNo: fields.riderName === null ? entryNo : null };
};
type UnnamedPage = Omit<RaceResultsPage, 'items'> & { items: UnnamedRow[] };
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
 * публичная таблица (имя — только с согласием, порт `RIDER_NAMES`). До публикации протокола места считаются при чтении в snapshot-сессии; после
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
    @Inject(RIDER_NAMES) private readonly names: RiderNameDirectory,
    @Inject(VERIFIED_PROFILES) private readonly profiles: VerifiedProfiles,
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
    // схема гонки без заявок — `gender_age`: её получит первая заявка (`admitEntry`)
    const groupScheme = race.groupScheme ?? 'gender_age';
    return {
      raceId,
      groupScheme,
      entry: entry
        ? {
            id: entry._id,
            status: entry.status,
            createdAt: entry.createdAt.toISOString(),
            withdrawnAt: entry.withdrawnAt?.toISOString() ?? null,
            tier: entry.tier ?? 'verified',
            groupKey: entry.groupKey,
          }
        : null,
      result: { ...result, group: groupOfEntry(entry) },
      verified: groupScheme === 'overall' ? null : await this.verifiedState(userId, race),
      attempts: attempts
        .filter((attempt) => !attemptHidden(attempt))
        .map((attempt) => this.myAttempt(attempt, entry)),
      pendingUploads: entry ? await this.pendingUploads(entry) : [],
      uploadClosesAt: uploadClosesAt(race).toISOString(),
      actions: {
        ...entryActions(race, this.races.phase(race, now), entry, now, { openDisputes }),
        canShareStory: storyCardEligible(entry, result),
      },
    };
  }

  /**
   * Блок «Verified» участия (race-results-07): своя группа и разрешённые группы — по анкете (пол, год) и году гонки;
   * анкеты нет — `null`. Вес, рост и FTP через порт не читаются.
   */
  private async verifiedState(
    userId: string,
    race: RaceForResults,
  ): Promise<NonNullable<MyRaceEntry['verified']>> {
    const profile = await this.profiles.demographicsOf(userId);
    if (!profile) return { profileReady: false, ownGroup: null, groupOptions: null };
    const own = ownGroup(profile.gender, profile.birthYear, race);
    return { profileReady: true, ownGroup: own, groupOptions: allowedGroups(own) };
  }

  /**
   * Свой трек попытки (maps-02): попытка этой гонки, своя и видимая в «моём участии» (фильтр `attemptHidden`, как
   * `myEntry`); иначе, и если линии активности нет, — один `404` (не раскрываем существование). Разметка — из
   * `trackMap`, посчитанной worker при сверке: `queued`/`checking` — `pending`; разметка есть и число точек линии
   * совпало — `ready`; иначе — `unavailable`. Ответ собирается по полям: без id активности, времени и датчиков.
   */
  async myAttemptTrack(userId: string, raceId: string, attemptId: string): Promise<MyAttemptTrack> {
    await this.race(raceId);
    const attempt = await this.repository.findAttempt(attemptId);
    if (
      !attempt ||
      attempt.raceId !== raceId ||
      attempt.userId !== userId ||
      attemptHidden(attempt)
    ) {
      throw notFound();
    }
    const line = await this.activities.trackLine(userId, attempt.activityId);
    if (!line || line.length < 2) throw notFound();
    const trackMap = attempt.trackMap ?? null;
    const pending = attempt.status === 'queued' || attempt.status === 'checking';
    const ready = !pending && trackMap !== null && trackMap.linePoints === line.length;
    return {
      attemptId: attempt._id,
      line,
      segment:
        ready && trackMap.segment ? { from: trackMap.segment[0], to: trackMap.segment[1] } : null,
      offRuns: ready ? trackMap.offRuns.map(([from, to]) => ({ from, to })) : [],
      marks: pending ? 'pending' : ready ? 'ready' : 'unavailable',
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
    const group = groupOfEntry(entry);
    const ranked = await this.repository.countRanked(race.id, group, session);
    const status = resultStatus(entry, race, now);
    const best = entry?.status === 'active' ? entry.best : null;
    const none = { place: null, tied: false, ranked, unranked: null };
    if (!entry || !best) return { status, elapsedSec: null, ...none };
    if (disqualifiedBeforePublication(entry, race)) {
      return { status, elapsedSec: best.elapsedSec, ...none };
    }
    // race-results-07: START и Verified без пульса — время без места (таблица финишёров)
    const unranked = unrankedOf(entry);
    if (unranked) return { status, elapsedSec: best.elapsedSec, ...none, unranked };
    const less = await this.repository.countRankedLess(race.id, group, best.elapsedSec, session);
    const equal = await this.repository.countRankedEqual(race.id, group, best.elapsedSec, session);
    return {
      status,
      elapsedSec: best.elapsedSec,
      place: less + 1,
      tied: equal >= 2,
      ranked,
      unranked: null,
    };
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
    const row = entry
      ? await this.repository.protocolRow(race.id, revision, entry._id, session)
      : undefined;
    const group = row ? (row.groupKey ?? 'overall') : groupOfEntry(entry);
    const { ranked } = await this.repository.countProtocolRows(race.id, revision, group, session);
    if (!row) {
      // race-results-07: START и Verified без пульса в снимок не входят — время без места из заявки (DV-10)
      const unranked = entry?.status === 'active' ? unrankedOf(entry) : null;
      return {
        status: resultStatus(entry, race, now, { ignoreBest: true }),
        elapsedSec: unranked && entry?.best ? entry.best.elapsedSec : null,
        place: null,
        tied: false,
        ranked,
        unranked,
      };
    }
    return {
      status: row.status,
      elapsedSec: row.elapsedSec,
      place: row.place,
      tied: row.tied,
      ranked,
      unranked: null,
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
   * Публичная предварительная таблица (`entryId`, место, ничья, время сегмента; имя — только с согласием, порт
   * `RIDER_NAMES`). Отменённая или без
   * коридора — пусто. Страница и счётчики мест — в одной snapshot-сессии. Курсор — строка этой таблицы: выбыла
   * (отмена участия, снятие лучшего) или чужая гонка — `400` на поле `cursor`, клиент начинает сначала.
   */
  async publicResults(raceId: string, query: RaceResultsQuery): Promise<RaceResultsPage> {
    const race = await this.race(raceId);
    const cursorEntryId = query.cursor ? decodeCursor(query.cursor, RankCursorKey).id : null;
    const mode = publicTableMode(race);
    if (mode === 'protocol') {
      return this.protocolResults(race, query.group, cursorEntryId, query.limit);
    }
    const empty = mode === 'empty';
    const unnamed = await this.repository.withSnapshot(async (session): Promise<UnnamedPage> => {
      const entries = await this.repository.countActiveEntries(raceId, session);
      const groups = empty ? [] : await this.repository.rankedGroups(raceId, session);
      // курсор без `group` (старый клиент) — группа строки курсора: умолчание могло смениться между страницами
      const cursorGroup =
        !empty && cursorEntryId && query.group === undefined
          ? await this.repository.entryGroupKey(raceId, cursorEntryId, session)
          : null;
      const group = query.group ?? cursorGroup ?? defaultGroup(race, groups);
      const base = {
        group,
        status: 'provisional' as const,
        entries,
        groups,
        finishers: empty ? 0 : await this.repository.countFinishers(raceId, session),
      };
      if (empty) return { ...base, ranked: 0, items: [], nextCursor: null };
      const after = cursorEntryId
        ? await this.repository.rankedPosition(raceId, group, cursorEntryId, session)
        : null;
      if (cursorEntryId && !after) throw invalidCursor();
      const ranked = await this.repository.countRanked(raceId, group, session);
      const rows = await this.repository.rankedPage(raceId, group, after, query.limit + 1, session);
      const page = rows.slice(0, query.limit);
      const first = page[0];
      const last = page.at(-1);
      if (!first || !last) return { ...base, ranked, items: [], nextCursor: null };
      const lessThanFirst = await this.repository.countRankedLess(
        raceId,
        group,
        first.best.elapsedSec,
        session,
      );
      const firstIndex = after
        ? await this.repository.countRankedUpTo(raceId, group, after, session)
        : 0;
      const equalCounts = new Map<number, number>();
      for (const elapsedSec of new Set([first.best.elapsedSec, last.best.elapsedSec])) {
        equalCounts.set(
          elapsedSec,
          await this.repository.countRankedEqual(raceId, group, elapsedSec, session),
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
          userId: row.userId,
          entryNo: row.entryNo ?? null,
          row: {
            entryId: row._id,
            place: places[index]!.place,
            tied: places[index]!.tied,
            elapsedSec: row.best.elapsedSec,
          },
        })),
        nextCursor: rows.length > query.limit ? encodeCursor('e', last._id) : null,
      };
    });
    return this.withRiderNames(unnamed);
  }

  /**
   * Строка публичной таблицы гонки по `entryId` — цель «Респекта» (P4, RC-P4-1, порт `RESULTS_FOR_SOCIAL`): та же
   * видимость, что у `publicResults` (`publicTableMode`). До публикации — заявка со строкой с местом своей группы
   * (активная, Verified, `best.ranked`, без DQ: снятые, финишёры и DQ отпадают); после — строка текущей ревизии
   * (`isPublicProtocolRow`) в одной snapshot-сессии. Черновик, неизвестная гонка или заявка — `null`.
   */
  async publicRow(
    entryId: string,
  ): Promise<{ entryId: string; raceId: string; userId: string } | null> {
    const entry = await this.repository.findEntryById(entryId);
    if (!entry) return null;
    const race = await this.races.get(entry.raceId);
    if (!race) return null;
    const mode = publicTableMode(race);
    if (mode === 'empty') return null;
    const target = { entryId, raceId: race.id, userId: entry.userId };
    if (mode === 'provisional') {
      const position = await this.repository.rankedPosition(race.id, entry.groupKey, entryId);
      return position ? target : null;
    }
    return this.repository.withSnapshot(async (session) => {
      const revision = await this.protocolRevision(race.id, session);
      const row = await this.repository.protocolRow(race.id, revision, entryId, session);
      return row && isPublicProtocolRow(row) ? { ...target, userId: row.userId } : null;
    });
  }

  /**
   * Строки опубликованных протоколов «своих» за окно (Главная «Свои», social-p7, порт `RESULTS_FOR_SOCIAL`): гонки с
   * протоколом не раньше `since` (`RACE_REGISTRY.protocolsPublishedSince`, ≤ `RECENT_PROTOCOL_RACES`) и видимостью
   * `protocol` (`publicTableMode`) → в одной snapshot-сессии текущая ревизия каждой и строки `userIds` ∪ зрителя
   * этой ревизии, видимые в публичной таблице (`isPublicProtocolRow`). `viewerElapsedSec` — видимая строка зрителя той
   * же гонки и группы (`groupKey ?? 'overall'`). Порядок: протокол ↓, гонка ↑, место ↑, заявка ↑; ≤ `limit`.
   */
  async recentPublicRows(
    userIds: readonly string[],
    viewerId: string,
    since: Date,
    limit: number,
  ): Promise<SocialRaceResult[]> {
    if (userIds.length === 0) return [];
    const races = (await this.races.protocolsPublishedSince(since, RECENT_PROTOCOL_RACES)).filter(
      (race) => publicTableMode(race) === 'protocol',
    );
    if (races.length === 0) return [];
    const rows = await this.repository.withSnapshot(async (session) => {
      const revisions = new Map(
        await Promise.all(
          races.map(
            async (race) => [race.id, await this.protocolRevision(race.id, session)] as const,
          ),
        ),
      );
      const all = await this.repository.protocolRowsOfUsers(
        [...new Set([...userIds, viewerId])],
        races.map((race) => race.id),
        session,
      );
      return all.filter(
        (row) => row.revision === revisions.get(row.raceId) && isPublicProtocolRow(row),
      );
    });
    const groupOf = (row: { raceId: string; groupKey?: ResultGroupKey }) =>
      `${row.raceId}\u0000${row.groupKey ?? 'overall'}`;
    const viewer = new Map(
      rows.filter((row) => row.userId === viewerId).map((row) => [groupOf(row), row.elapsedSec]),
    );
    const byId = new Map(races.map((race) => [race.id, race]));
    return rows
      .filter((row) => row.userId !== viewerId)
      .map((row): SocialRaceResult => {
        const race = byId.get(row.raceId)!;
        return {
          raceId: race.id,
          raceTitle: race.title,
          publishedAt: race.protocolPublishedAt!,
          entryId: row.entryId,
          userId: row.userId,
          place: row.place!,
          tied: row.tied,
          elapsedSec: row.elapsedSec,
          viewerElapsedSec: viewer.get(groupOf(row)) ?? null,
        };
      })
      .sort(
        (a, b) =>
          b.publishedAt.getTime() - a.publishedAt.getTime() ||
          a.raceId.localeCompare(b.raceId) ||
          a.place - b.place ||
          a.entryId.localeCompare(b.entryId),
      )
      .slice(0, limit);
  }

  /**
   * Финишёры гонки (race-results-07, DV-10): START и Verified без пульса — время без места, по `(время, старт, id)`;
   * читаются из заявок и после публикации (в снимок протокола не входят). Имя — по правилам таблицы (P1). Курсор —
   * `entryId` строки финишёров; выбыла или чужая — `400` на поле `cursor`.
   */
  async finishers(raceId: string, query: RaceFinishersQuery): Promise<RaceFinishersPage> {
    const race = await this.race(raceId);
    const cursorEntryId = query.cursor ? decodeCursor(query.cursor, FinisherCursorKey).id : null;
    if (race.status === 'cancelled' || race.corridor === null) {
      if (cursorEntryId) throw invalidCursor();
      return { total: 0, items: [], nextCursor: null };
    }
    const page = await this.repository.withSnapshot(async (session) => {
      const after = cursorEntryId
        ? await this.repository.finisherPosition(raceId, cursorEntryId, session)
        : null;
      if (cursorEntryId && !after) throw invalidCursor();
      const total = await this.repository.countFinishers(raceId, session);
      const rows = await this.repository.finishersPage(raceId, after, query.limit + 1, session);
      return { total, rows };
    });
    const rows = page.rows.slice(0, query.limit);
    const last = rows.at(-1);
    const riders = await this.names.publicRiders(rows.map((row) => row.userId));
    return {
      total: page.total,
      items: rows.map((row) => ({
        entryId: row._id,
        elapsedSec: row.best.elapsedSec,
        ...raceRiderFields(riders.get(row.userId), row.entryNo ?? null),
        unranked: unrankedOf(row) ?? 'no_heart_rate',
      })),
      nextCursor: page.rows.length > query.limit && last ? encodeCursor('f', last._id) : null,
    };
  }

  /**
   * Имена строк страницы (profile-rider-name, P1/P3): один вызов порта после snapshot-сессии — имя не участвует в
   * согласованности мест и в снимок протокола не пишется. Строка — явным списком полей: `userId` наружу не выходит.
   */
  private async withRiderNames(page: UnnamedPage): Promise<RaceResultsPage> {
    const riders = await this.names.publicRiders(page.items.map((item) => item.userId));
    return {
      group: page.group,
      status: page.status,
      ranked: page.ranked,
      entries: page.entries,
      nextCursor: page.nextCursor,
      groups: page.groups.map((group) => ({ key: group.key, ranked: group.ranked })),
      finishers: page.finishers,
      items: page.items.map(({ userId, entryNo, row }) => ({
        entryId: row.entryId,
        place: row.place,
        tied: row.tied,
        elapsedSec: row.elapsedSec,
        ...raceRiderFields(riders.get(userId), entryNo),
      })),
    };
  }

  /**
   * Таблица опубликованного протокола (§7.7): строки текущей ревизии без DQ по `order`, `status: 'final'`. Курсор —
   * `entryId` строки (позиция — её `order`); строка DQ или не из ревизии — `400` на поле `cursor`.
   */
  private async protocolResults(
    race: RaceForResults,
    requested: ResultGroupKey | undefined,
    cursorEntryId: string | null,
    limit: number,
  ): Promise<RaceResultsPage> {
    const raceId = race.id;
    const unnamed = await this.repository.withSnapshot(async (session): Promise<UnnamedPage> => {
      const revision = await this.protocolRevision(raceId, session);
      const groups = await this.repository.protocolGroups(raceId, revision, session);
      const at = cursorEntryId
        ? await this.repository.protocolRow(raceId, revision, cursorEntryId, session)
        : null;
      // курсор без `group` — группа строки курсора (умолчание могло смениться с новой ревизией)
      const group =
        requested ?? (at ? (at.groupKey ?? 'overall') : null) ?? defaultGroup(race, groups);
      let afterOrder: number | null = null;
      if (cursorEntryId) {
        if (!at || at.status === 'dq' || (at.groupKey ?? 'overall') !== group) {
          throw invalidCursor();
        }
        afterOrder = at.order;
      }
      const entries = await this.repository.countActiveEntries(raceId, session);
      const finishers = await this.repository.countFinishers(raceId, session);
      const { ranked } = await this.repository.countProtocolRows(raceId, revision, group, session);
      const rows = await this.repository.protocolRowsPage(
        raceId,
        revision,
        group,
        afterOrder,
        limit + 1,
        session,
      );
      const page = rows.slice(0, limit);
      const last = page.at(-1);
      const numbers = await this.repository.entryNumbers(
        raceId,
        page.map((row) => row.entryId),
        session,
      );
      return {
        group,
        status: 'final' as const,
        entries,
        ranked,
        groups,
        finishers,
        items: page.flatMap((row: RaceProtocolRowDoc) =>
          isPublicProtocolRow(row)
            ? [
                {
                  userId: row.userId,
                  entryNo: numbers.get(row.entryId) ?? null,
                  row: {
                    entryId: row.entryId,
                    place: row.place,
                    tied: row.tied,
                    elapsedSec: row.elapsedSec,
                  },
                },
              ]
            : [],
        ),
        nextCursor: rows.length > limit && last ? encodeCursor('e', last.entryId) : null,
      };
    });
    return this.withRiderNames(unnamed);
  }
}
