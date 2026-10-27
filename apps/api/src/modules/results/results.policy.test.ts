import { ATTEMPT_REJECTIONS } from '@pokatim/contracts';
import type { Bounds } from '@pokatim/tracks';
import { CORRIDOR_REJECTIONS } from '@pokatim/tracks/parse';
import { describe, expect, it } from 'vitest';

import type { RaceForResults } from '../races';
import type { ActivityRef } from '../tracks';
import type { AttemptSegmentDoc, RaceAttemptDoc, RaceEntryDoc } from './results.collection';
import type { RaceProtocolRowDoc } from './results.collection';
import {
  attemptClosedReason,
  attemptHidden,
  attemptMatched,
  buildProtocol,
  entryActions,
  entryDisputeBlock,
  EXCLUDABLE_STATUSES,
  type ProtocolBase,
  publishChecklist,
  recheckPending,
  mayMatch,
  pickBest,
  raceRepresentative,
  rankRows,
  RESULTS_POLICY,
  resultStatus,
  summarize,
  uploadClosesAt,
  verdictFields,
} from './results.policy';

const MIN = 60_000;
const HOUR = 60 * MIN;
const at = (iso: string) => new Date(iso);

const STARTS = at('2026-10-23T21:00:00Z');
const ENDS = at('2026-10-26T20:59:00Z');
const CLOSES = new Date(ENDS.getTime() + MIN);

const race = (overrides: Partial<RaceForResults> = {}): RaceForResults => ({
  id: 'race',
  ownerUserId: 'owner',
  status: 'published',
  title: 'Коридор',
  windowStartsAt: STARTS,
  windowEndsAt: ENDS,
  closesAt: CLOSES,
  protocolPlannedAt: new Date(ENDS.getTime() + 48 * HOUR),
  corridor: { routeId: 'route', widthM: 50, distanceM: 8000 },
  lockedAt: null,
  groupScheme: null,
  protocolPublishedAt: null,
  disputeFilingClosedAt: null,
  ...overrides,
});

const ROUTE: Bounds = [27.55, 53.9, 27.61, 53.95];
const activity = (overrides: Partial<ActivityRef> = {}): ActivityRef => ({
  id: 'a',
  userId: 'u',
  uploadId: 'up',
  uploadCreatedAt: at('2026-10-25T10:00:00Z'),
  isPrimary: true,
  primaryId: 'a',
  sport: 'cycling',
  source: 'upload',
  startedAt: at('2026-10-25T08:00:00Z'),
  endedAt: at('2026-10-25T09:00:00Z'),
  elapsedSec: 3600,
  distanceM: 30_000,
  bounds: [27.56, 53.91, 27.6, 53.94],
  ...overrides,
});

const segment = (elapsedSec: number, startedAt: string): AttemptSegmentDoc => ({
  startedAt: at(startedAt),
  finishedAt: new Date(at(startedAt).getTime() + elapsedSec * 1000),
  elapsedMs: elapsedSec * 1000,
  elapsedSec,
  distanceM: 8000,
  offCorridorM: 0,
  offCorridorShare: 0,
  maxExcursionM: 0,
  coverage: 1,
  noisePoints: 0,
});

type AttemptState = Pick<
  RaceAttemptDoc,
  '_id' | 'origin' | 'status' | 'matched' | 'reasons' | 'segment'
>;
const attempt = (overrides: Partial<AttemptState> = {}): AttemptState => ({
  _id: 'x',
  origin: 'auto',
  status: 'counted',
  matched: true,
  reasons: [],
  segment: segment(3600, '2026-10-25T08:00:00Z'),
  ...overrides,
});

type EntryState = Pick<RaceEntryDoc, 'status' | 'best' | 'summary' | 'disqualified'>;
const entry = (overrides: Partial<EntryState> = {}): EntryState => ({
  status: 'active',
  best: null,
  summary: { total: 0, pending: 0, counted: 0, rejectedShown: 0, failed: 0, excluded: 0 },
  disqualified: null,
  ...overrides,
});
/** Без открытых споров (race-results-06). */
const NO_DISPUTES = { openDisputes: 0 };

describe('сторож кодов отказа (AC27)', () => {
  it('ATTEMPT_REJECTIONS = CORRIDOR_REJECTIONS движка в том же порядке + implausible', () => {
    expect(ATTEMPT_REJECTIONS.slice(0, -1)).toEqual([...CORRIDOR_REJECTIONS]);
    expect(ATTEMPT_REJECTIONS.at(-1)).toBe('implausible');
  });
});

describe('uploadClosesAt (A5)', () => {
  it('закрытие окна + 24 ч', () => {
    expect(uploadClosesAt(race())).toEqual(new Date(CLOSES.getTime() + 24 * HOUR));
  });
});

describe('mayMatch — предфильтр автоматической попытки', () => {
  it('основная, в окне, в рамке, файл принят вовремя — да', () => {
    expect(mayMatch(activity(), race(), ROUTE)).toBe(true);
  });

  it('границы окна: конец на старте окна — да, старт на closesAt — нет', () => {
    expect(
      mayMatch(activity({ startedAt: at('2026-10-23T20:00:00Z'), endedAt: STARTS }), race(), ROUTE),
    ).toBe(true);
    expect(mayMatch(activity({ endedAt: new Date(STARTS.getTime() - 1) }), race(), ROUTE)).toBe(
      false,
    );
    expect(
      mayMatch(
        activity({
          startedAt: new Date(CLOSES.getTime() - 1),
          endedAt: at('2026-10-27T00:00:00Z'),
        }),
        race(),
        ROUTE,
      ),
    ).toBe(true);
    expect(
      mayMatch(activity({ startedAt: CLOSES, endedAt: at('2026-10-27T00:00:00Z') }), race(), ROUTE),
    ).toBe(false);
  });

  it('представитель группы — первый своевременный по приоритету основной; поздний не идёт в гонку', () => {
    const late = activity({ id: 'late', uploadCreatedAt: uploadClosesAt(race()) });
    const timely = activity({ id: 'timely', isPrimary: false });
    expect(raceRepresentative([late, timely], race())?.id).toBe('timely');
    expect(raceRepresentative([timely, late], race())?.id).toBe('timely');
    expect(raceRepresentative([late], race())).toBeNull();
  });

  it('indoor, далеко от маршрута — нет', () => {
    expect(mayMatch(activity({ sport: 'cycling_indoor' }), race(), ROUTE)).toBe(false);
    expect(mayMatch(activity({ bounds: [28.5, 54.5, 28.6, 54.6] }), race(), ROUTE)).toBe(false);
  });

  it('время приёма файла сервером: до closesAt + 24 ч — да, позже — нет', () => {
    const last = new Date(uploadClosesAt(race()).getTime() - 1);
    expect(mayMatch(activity({ uploadCreatedAt: last }), race(), ROUTE)).toBe(true);
    expect(mayMatch(activity({ uploadCreatedAt: uploadClosesAt(race()) }), race(), ROUTE)).toBe(
      false,
    );
  });
});

describe('видимость и вердикт (A8, §7.4)', () => {
  it('matched: касание коридора, сегмент и не no_start/no_finish', () => {
    const seg = segment(1, '2026-10-25T08:00:00Z');
    expect(attemptMatched({ touchedCorridor: true, segment: seg, reasons: ['off_corridor'] })).toBe(
      true,
    );
    expect(attemptMatched({ touchedCorridor: true, segment: seg, reasons: ['no_finish'] })).toBe(
      false,
    );
    expect(attemptMatched({ touchedCorridor: false, segment: null, reasons: ['no_start'] })).toBe(
      false,
    );
    expect(attemptMatched({ touchedCorridor: true, segment: null, reasons: ['no_start'] })).toBe(
      false,
    );
  });

  it('скрыты: снятые; auto без полного сегмента и implausible; явная — видна', () => {
    expect(attemptHidden(attempt({ status: 'withdrawn' }))).toBe(true);
    expect(
      attemptHidden(attempt({ status: 'rejected', matched: false, reasons: ['no_start'] })),
    ).toBe(true);
    expect(
      attemptHidden(attempt({ status: 'rejected', matched: false, reasons: ['implausible'] })),
    ).toBe(true);
    expect(
      attemptHidden(attempt({ status: 'rejected', matched: true, reasons: ['off_corridor'] })),
    ).toBe(false);
    expect(
      attemptHidden(
        attempt({ origin: 'explicit', status: 'rejected', matched: false, reasons: ['no_start'] }),
      ),
    ).toBe(false);
    expect(attemptHidden(attempt({ status: 'queued', matched: null }))).toBe(false);
  });

  it('исключённая (race-results-05): auto без полного сегмента скрыта, как отказ; совпавшая и явная — видны', () => {
    expect(
      attemptHidden(attempt({ status: 'excluded', matched: false, reasons: ['no_start'] })),
    ).toBe(true);
    expect(attemptHidden(attempt({ status: 'excluded', matched: true }))).toBe(false);
    expect(attemptHidden(attempt({ status: 'excluded', matched: null }))).toBe(false);
    expect(attemptHidden(attempt({ origin: 'explicit', status: 'excluded', matched: false }))).toBe(
      false,
    );
  });

  it('verdictFields: засчитано — без причин; отказ — причины движка', () => {
    const seg = segment(790, '2026-06-14T06:00:14.5Z');
    expect(
      verdictFields({ verdict: 'counted', reasons: [], touchedCorridor: true, segment: seg }),
    ).toEqual({
      status: 'counted',
      reasons: [],
      matched: true,
    });
    expect(
      verdictFields({
        verdict: 'rejected',
        reasons: ['no_start'],
        touchedCorridor: false,
        segment: null,
      }),
    ).toEqual({
      status: 'rejected',
      reasons: ['no_start'],
      matched: false,
    });
  });
});

describe('pickBest и сводка', () => {
  it('лучшая — минимальное время; равенство — раньше старт, затем _id; незасчитанные не участвуют', () => {
    const attempts = [
      attempt({ _id: 'c', segment: segment(3700, '2026-10-25T08:00:00Z') }),
      attempt({ _id: 'b', segment: segment(3600, '2026-10-25T09:00:00Z') }),
      attempt({ _id: 'a', segment: segment(3600, '2026-10-25T09:00:00Z') }),
      attempt({ _id: '0', status: 'rejected', segment: segment(100, '2026-10-25T07:00:00Z') }),
    ];
    expect(pickBest(attempts, 'all')?.attemptId).toBe('a');
    expect(
      pickBest(
        [...attempts, attempt({ _id: 'z', segment: segment(3600, '2026-10-25T08:30:00Z') })],
        'all',
      )?.attemptId,
    ).toBe('z');
    expect(pickBest([attempt({ status: 'failed', segment: null })], 'all')).toBeNull();
  });

  it('summarize: ожидание, засчитанные, видимые отказы, провалы, всего', () => {
    expect(
      summarize([
        attempt({ status: 'queued' }),
        attempt({ status: 'checking' }),
        attempt({ status: 'counted' }),
        attempt({ status: 'rejected', matched: true, reasons: ['off_corridor'] }),
        attempt({ status: 'rejected', matched: false, reasons: ['no_start'] }),
        attempt({ status: 'failed' }),
        attempt({ status: 'withdrawn' }),
        attempt({ status: 'excluded' }),
      ]),
    ).toEqual({ total: 8, pending: 2, counted: 1, rejectedShown: 1, failed: 1, excluded: 1 });
  });
});

describe('resultStatus (§7.4, AC19)', () => {
  const now = at('2026-10-25T12:00:00Z');
  const late = uploadClosesAt(race());
  const best = { attemptId: 'a', elapsedSec: 1, startedAt: now, finishedAt: now };
  it('по порядку: withdrawn → provisional → pending → not_counted → dns → none', () => {
    expect(resultStatus(null, race(), now)).toBe('none');
    expect(resultStatus(entry({ status: 'withdrawn', best }), race(), now)).toBe('withdrawn');
    expect(
      resultStatus(
        entry({
          best,
          summary: { total: 2, pending: 1, counted: 1, rejectedShown: 0, failed: 0, excluded: 0 },
        }),
        race(),
        now,
      ),
    ).toBe('provisional');
    expect(
      resultStatus(
        entry({
          summary: { total: 2, pending: 1, counted: 0, rejectedShown: 1, failed: 0, excluded: 0 },
        }),
        race(),
        now,
      ),
    ).toBe('pending');
    expect(
      resultStatus(
        entry({
          summary: { total: 1, pending: 0, counted: 0, rejectedShown: 0, failed: 1, excluded: 0 },
        }),
        race(),
        late,
      ),
    ).toBe('not_counted');
    expect(resultStatus(entry(), race(), now)).toBe('none');
    expect(resultStatus(entry(), race(), late)).toBe('dns');
    expect(
      resultStatus(
        entry({
          summary: { total: 1, pending: 0, counted: 0, rejectedShown: 0, failed: 0, excluded: 0 },
        }),
        race(),
        late,
      ),
    ).toBe('dns');
  });

  it('исключённые (race-results-05): одни исключённые — not_counted; старая сводка без поля — как 0', () => {
    expect(
      resultStatus(
        entry({
          summary: { total: 1, pending: 0, counted: 0, rejectedShown: 0, failed: 0, excluded: 1 },
        }),
        race(),
        now,
      ),
    ).toBe('not_counted');
    const legacy = { total: 0, pending: 0, counted: 0, rejectedShown: 0, failed: 0 };
    expect(resultStatus(entry({ summary: legacy as never }), race(), late)).toBe('dns');
  });

  it('ignoreBest (RC-5): после публикации живой лучший не даёт provisional', () => {
    const summary = { total: 1, pending: 0, counted: 1, rejectedShown: 0, failed: 0, excluded: 0 };
    expect(resultStatus(entry({ best, summary }), race(), late, { ignoreBest: true })).toBe('dns');
    expect(
      resultStatus(entry({ best, summary: { ...summary, pending: 1 } }), race(), late, {
        ignoreBest: true,
      }),
    ).toBe('pending');
    expect(
      resultStatus(entry({ status: 'withdrawn', best, summary }), race(), late, {
        ignoreBest: true,
      }),
    ).toBe('withdrawn');
  });
});

describe('resultStatus — DQ по спору до публикации (race-results-06, D-43)', () => {
  const now = at('2026-10-25T12:00:00Z');
  const best = { attemptId: 'a', elapsedSec: 1, startedAt: now, finishedAt: now };
  const disqualified = { at: now, disputeId: 'd' };

  it('DQ до публикации — dq вместо provisional; отменённая — withdrawn', () => {
    expect(resultStatus(entry({ best, disqualified }), race(), now)).toBe('dq');
    expect(resultStatus(entry({ best }), race(), now)).toBe('provisional');
    expect(resultStatus(entry({ status: 'withdrawn', best, disqualified }), race(), now)).toBe(
      'withdrawn',
    );
  });

  it('после публикации поле не читается (RC-3); ignoreBest — без dq', () => {
    const published = race({ protocolPublishedAt: now });
    expect(resultStatus(entry({ best, disqualified }), published, now)).toBe('provisional');
    expect(resultStatus(entry({ best, disqualified }), race(), now, { ignoreBest: true })).not.toBe(
      'dq',
    );
  });
});

describe('entryDisputeBlock (D-39, RC-6)', () => {
  const now = at('2026-10-25T12:00:00Z');
  const disqualified = { at: now, disputeId: 'd' };

  it('DQ до публикации важнее открытого спора; после публикации поле не читается', () => {
    expect(entryDisputeBlock(entry(), 0, race())).toBeNull();
    expect(entryDisputeBlock(entry(), 2, race())).toBe('dispute_open');
    expect(entryDisputeBlock(entry({ disqualified }), 1, race())).toBe('disqualified');
    expect(entryDisputeBlock(entry({ disqualified }), 0, race({ protocolPublishedAt: now }))).toBe(
      null,
    );
  });
});

describe('entryActions — споры (D-39, RC-4, RC-6)', () => {
  const open = at('2026-10-25T12:00:00Z');
  const closed = new Date(CLOSES.getTime() + HOUR);
  const late = uploadClosesAt(race());

  it('открытый спор: отмена и попытка закрыты одной причиной dispute_open', () => {
    expect(entryActions(race(), 'open', entry(), open, { openDisputes: 1 })).toEqual({
      canEnter: false,
      canWithdraw: false,
      canAddAttempt: false,
      reasons: ['dispute_open'],
      canUpgrade: false,
    });
  });

  it('DQ: причина disqualified', () => {
    const disqualified = { at: open, disputeId: 'd' };
    expect(
      entryActions(race(), 'open', entry({ disqualified }), open, { openDisputes: 1 }),
    ).toEqual({
      canEnter: false,
      canWithdraw: false,
      canAddAttempt: false,
      reasons: ['disqualified'],
      canUpgrade: false,
    });
  });

  it('закрытое окно объясняется своей причиной; спор — только у ещё доступного действия', () => {
    expect(entryActions(race(), 'closed', entry(), closed, { openDisputes: 1 })).toEqual({
      canEnter: false,
      canWithdraw: false,
      canAddAttempt: false,
      reasons: ['window_closed', 'dispute_open'],
      canUpgrade: false,
    });
    expect(entryActions(race(), 'closed', entry(), late, { openDisputes: 1 }).reasons).toEqual([
      'window_closed',
      'upload_closed',
    ]);
  });
});

describe('entryActions (D-37, C1/H2)', () => {
  const before = new Date(STARTS.getTime() - HOUR);
  const open = at('2026-10-25T12:00:00Z');
  const closed = new Date(CLOSES.getTime() + HOUR);
  const late = uploadClosesAt(race());

  it('без заявки: заявиться можно в upcoming/open; без коридора, отменена, окно закрыто — причина', () => {
    expect(entryActions(race(), 'upcoming', null, before, NO_DISPUTES)).toEqual({
      canEnter: true,
      canWithdraw: false,
      canAddAttempt: false,
      reasons: ['not_entered'],
      canUpgrade: false,
    });
    expect(entryActions(race(), 'open', null, open, NO_DISPUTES).canEnter).toBe(true);
    expect(entryActions(race({ corridor: null }), 'open', null, open, NO_DISPUTES).reasons).toEqual(
      ['no_corridor', 'not_entered'],
    );
    expect(
      entryActions(race({ status: 'cancelled' }), 'cancelled', null, open, NO_DISPUTES).reasons,
    ).toEqual(['cancelled', 'not_entered']);
    expect(entryActions(race(), 'closed', null, closed, NO_DISPUTES)).toMatchObject({
      canEnter: false,
      reasons: ['entries_closed', 'not_entered'],
      canUpgrade: false,
    });
  });

  it('отменённая заявка: ничего нельзя, причина withdrawn', () => {
    expect(entryActions(race(), 'open', entry({ status: 'withdrawn' }), open, NO_DISPUTES)).toEqual(
      {
        canEnter: false,
        canWithdraw: false,
        canAddAttempt: false,
        reasons: ['withdrawn'],
        canUpgrade: false,
      },
    );
  });

  it('активная: отмена до закрытия окна, попытки — с открытия окна до срока загрузки и до предела', () => {
    expect(entryActions(race(), 'upcoming', entry(), before, NO_DISPUTES)).toEqual({
      canEnter: false,
      canWithdraw: true,
      canAddAttempt: false,
      reasons: ['window_not_open'],
      canUpgrade: false,
    });
    expect(entryActions(race(), 'open', entry(), open, NO_DISPUTES)).toEqual({
      canEnter: false,
      canWithdraw: true,
      canAddAttempt: true,
      reasons: [],
      canUpgrade: false,
    });
    expect(entryActions(race(), 'closed', entry(), closed, NO_DISPUTES)).toEqual({
      canEnter: false,
      canWithdraw: false,
      canAddAttempt: true,
      reasons: ['window_closed'],
      canUpgrade: false,
    });
    expect(entryActions(race(), 'closed', entry(), late, NO_DISPUTES).reasons).toEqual([
      'window_closed',
      'upload_closed',
    ]);
    const full = entry({
      summary: {
        total: RESULTS_POLICY.maxAttemptsPerEntry,
        pending: 0,
        counted: 0,
        rejectedShown: 0,
        failed: 0,
        excluded: 0,
      },
    });
    expect(entryActions(race(), 'open', full, open, NO_DISPUTES).reasons).toEqual([
      'attempt_limit',
    ]);
  });

  it('attemptClosedReason: до окна, после срока, отменена', () => {
    expect(attemptClosedReason(race(), 'upcoming', before)).toBe('window_not_open');
    expect(attemptClosedReason(race(), 'open', open)).toBeNull();
    expect(attemptClosedReason(race(), 'closed', closed)).toBeNull();
    expect(attemptClosedReason(race(), 'closed', late)).toBe('upload_closed');
    expect(attemptClosedReason(race({ status: 'cancelled' }), 'cancelled', open)).toBe('cancelled');
  });
});

describe('rankRows — места «1, =2, =2, 4» (A7, AC18)', () => {
  const rows = (...times: number[]) => times.map((elapsedSec) => ({ elapsedSec }));

  it('одна страница', () => {
    expect(
      rankRows(rows(3600, 3700, 3700, 3800), {
        lessThanFirst: 0,
        firstIndex: 0,
        equalCounts: new Map([
          [3600, 1],
          [3800, 1],
        ]),
      }),
    ).toEqual([
      { place: 1, tied: false },
      { place: 2, tied: true },
      { place: 2, tied: true },
      { place: 4, tied: false },
    ]);
  });

  it('ничья на границе страниц сохраняет место и «=»', () => {
    // страница 1 (limit 2): 3600, 3700 — у 3700 ещё одна строка на следующей странице
    expect(
      rankRows(rows(3600, 3700), {
        lessThanFirst: 0,
        firstIndex: 0,
        equalCounts: new Map([
          [3600, 1],
          [3700, 2],
        ]),
      }),
    ).toEqual([
      { place: 1, tied: false },
      { place: 2, tied: true },
    ]);
    // страница 2: 3700, 3800 — перед первой строкой 2 строки, меньше по времени — 1
    expect(
      rankRows(rows(3700, 3800), {
        lessThanFirst: 1,
        firstIndex: 2,
        equalCounts: new Map([
          [3700, 2],
          [3800, 1],
        ]),
      }),
    ).toEqual([
      { place: 2, tied: true },
      { place: 4, tied: false },
    ]);
  });
});

describe('протокол (race-results-05)', () => {
  it('EXCLUDABLE_STATUSES — исключить можно всё, кроме снятых и уже исключённых', () => {
    expect([...EXCLUDABLE_STATUSES]).toEqual([
      'queued',
      'checking',
      'counted',
      'rejected',
      'failed',
    ]);
  });

  describe('publishChecklist (D-22, D-23)', () => {
    const closes = uploadClosesAt(race());
    const input = (overrides: Partial<Parameters<typeof publishChecklist>[0]> = {}) => ({
      race: race(),
      now: closes,
      uploadClosesAt: closes,
      openDisputes: 0,
      unprocessedTracks: 0,
      pendingChecks: 0,
      failedChecks: 0,
      ...overrides,
    });

    it('все 5 строк в порядке; пусто и blockedBy null — можно публиковать', () => {
      expect(publishChecklist(input())).toEqual({
        canPublish: true,
        blockedBy: null,
        checklist: [
          { code: 'open_disputes', count: 0 },
          { code: 'unprocessed_tracks', count: 0 },
          { code: 'checks_queued', count: 0 },
          { code: 'checks_failed', count: 0 },
          { code: 'window_open', count: 0 },
        ],
      });
    });

    it('каждая строка по своей причине; window_open — до uploadClosesAt (граница исключающая)', () => {
      const result = publishChecklist(
        input({
          now: new Date(closes.getTime() - 1),
          openDisputes: 1,
          unprocessedTracks: 2,
          pendingChecks: 3,
          failedChecks: 4,
        }),
      );
      expect(result.canPublish).toBe(false);
      expect(result.checklist.map((row) => row.count)).toEqual([1, 2, 3, 4, 1]);
      expect(publishChecklist(input({ failedChecks: 1 })).canPublish).toBe(false);
    });

    it('blockedBy по приоритету draft > cancelled > no_corridor > published', () => {
      const published = new Date(closes.getTime() + HOUR);
      expect(
        publishChecklist(input({ race: race({ status: 'draft', corridor: null }) })).blockedBy,
      ).toBe('draft');
      expect(
        publishChecklist(
          input({
            race: race({ status: 'cancelled', corridor: null, protocolPublishedAt: published }),
          }),
        ).blockedBy,
      ).toBe('cancelled');
      expect(
        publishChecklist(input({ race: race({ corridor: null, protocolPublishedAt: published }) }))
          .blockedBy,
      ).toBe('no_corridor');
      const done = publishChecklist(input({ race: race({ protocolPublishedAt: published }) }));
      expect(done).toMatchObject({ blockedBy: 'published', canPublish: false });
    });
  });

  describe('buildProtocol (D-27, D-28)', () => {
    const t = (iso: string) => at(`2026-10-25T${iso}:00Z`);
    const base = (
      entryId: string,
      elapsedSec: number,
      startedAt = '08:00',
      dq = false,
    ): ProtocolBase => ({
      entryId,
      userId: `u-${entryId}`,
      attemptId: `a-${entryId}`,
      elapsedSec,
      startedAt: t(startedAt),
      dq,
      groupKey: 'overall',
      flags: [],
    });
    const view = (rows: ReturnType<typeof buildProtocol>) =>
      rows.map((row) => [row.order, row.entryId, row.place, row.tied, row.status]);
    const previousOf = (rows: ReturnType<typeof buildProtocol>) =>
      new Map<string, Pick<RaceProtocolRowDoc, 'place' | 'tied' | 'elapsedSec' | 'status'>>(
        rows.map((row) => [row.entryId, row]),
      );

    it('публикация: «1, =2, =2, 4», статус final; порядок (elapsedSec, startedAt, entryId)', () => {
      const rows = buildProtocol(
        [base('d', 3800), base('c', 3700, '09:00'), base('b', 3700, '08:00'), base('a', 3600)],
        null,
      );
      expect(view(rows)).toEqual([
        [0, 'a', 1, false, 'final'],
        [1, 'b', 2, true, 'final'],
        [2, 'c', 2, true, 'final'],
        [3, 'd', 4, false, 'final'],
      ]);
      expect(rows[0]).toMatchObject({ userId: 'u-a', attemptId: 'a-a', elapsedSec: 3600 });
      // равные время и старт — по entryId
      expect(
        view(buildProtocol([base('y', 3600), base('x', 3600)], null)).map((r) => r[1]),
      ).toEqual(['x', 'y']);
    });

    it('DQ: в конце без места; места остальных пересчитаны — изменившиеся revised, прочие — статус прошлой', () => {
      const published = buildProtocol([base('a', 3600), base('b', 3700), base('c', 3800)], null);
      const dq = buildProtocol(
        [base('a', 3600, '08:00', true), base('b', 3700), base('c', 3800)],
        previousOf(published),
      );
      expect(view(dq)).toEqual([
        [0, 'b', 1, false, 'revised'],
        [1, 'c', 2, false, 'revised'],
        [2, 'a', null, false, 'dq'],
      ]);
      const dqLast = buildProtocol(
        [base('a', 3600), base('b', 3700), base('c', 3800, '08:00', true)],
        previousOf(published),
      );
      expect(view(dqLast)).toEqual([
        [0, 'a', 1, false, 'final'],
        [1, 'b', 2, false, 'final'],
        [2, 'c', null, false, 'dq'],
      ]);
      // отмена DQ — место возвращается со статусом revised
      const revoked = buildProtocol(
        [base('a', 3600), base('b', 3700), base('c', 3800)],
        previousOf(dqLast),
      );
      expect(view(revoked)).toEqual([
        [0, 'a', 1, false, 'final'],
        [1, 'b', 2, false, 'final'],
        [2, 'c', 3, false, 'revised'],
      ]);
    });

    it('ничья появилась или ушла — revised; новое время — revised; новый участник — revised; выпавший — нет строки', () => {
      const published = buildProtocol([base('a', 3600), base('b', 3700), base('c', 3800)], null);
      const next = buildProtocol(
        [base('a', 3600), base('b', 3800), base('c', 3800), base('n', 4000)],
        previousOf(published),
      );
      expect(view(next)).toEqual([
        [0, 'a', 1, false, 'final'],
        [1, 'b', 2, true, 'revised'],
        [2, 'c', 2, true, 'revised'],
        [3, 'n', 4, false, 'revised'],
      ]);
      expect(view(buildProtocol([base('a', 3600)], previousOf(published)))).toEqual([
        [0, 'a', 1, false, 'final'],
      ]);
      expect(buildProtocol([], null)).toEqual([]);
    });
  });

  it('recheckPending: запуск после публикации новее применения', () => {
    const published = at('2026-10-28T10:00:00Z');
    const later = (ms: number) => new Date(published.getTime() + ms);
    expect(recheckPending({ startedAt: null, appliedAt: null }, published)).toBe(false);
    expect(recheckPending({ startedAt: later(-1), appliedAt: null }, published)).toBe(false);
    expect(recheckPending({ startedAt: later(1), appliedAt: null }, published)).toBe(true);
    expect(recheckPending({ startedAt: later(1), appliedAt: later(2) }, published)).toBe(false);
    expect(recheckPending({ startedAt: later(3), appliedAt: later(2) }, published)).toBe(true);
    expect(recheckPending({ startedAt: later(1), appliedAt: null }, null)).toBe(false);
  });
});
