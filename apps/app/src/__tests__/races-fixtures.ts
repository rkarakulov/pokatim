import type {
  AttemptCandidates,
  MyAttempt,
  MyRaceEntry,
  RaceDetail,
  RaceResultRow,
  RaceResultsPage,
} from '@pokatim/contracts';

/** Фикстуры участия и результатов гонки (race-results-04) в форме ответов API (контракты слайса 03). */
export const RACE_ID = '0190a6f4-0000-7000-8000-000000000001';
export const ENTRY_ID = '0199d000-0000-7000-8000-0000000000e1';
export const ACTIVITY_ID = '0199d000-0000-7000-8000-0000000000a1';
export const UPLOAD_ID = '0199c000-0000-7000-8000-000000000001';

/** Гонка с коридором ±50 м; окно 4–12 октября 2026 по Минску, протокол 14 октября. */
export const corridorRace = (overrides: Partial<RaceDetail> = {}): RaceDetail => ({
  id: RACE_ID,
  title: 'Гравийный коридор Логойск',
  bikeClass: 'gravel',
  surfaces: ['gravel', 'asphalt'],
  distanceKm: 62,
  windowStartsAt: '2026-10-03T21:00:00Z',
  windowEndsAt: '2026-10-12T20:59:00Z',
  protocolPlannedAt: '2026-10-14T09:00:00Z',
  phase: 'open',
  cancelReason: null,
  season: null,
  description: null,
  corridor: { widthM: 50 },
  ...overrides,
});

type Actions = MyRaceEntry['actions'];
type Result = MyRaceEntry['result'];

export const actions = (overrides: Partial<Actions> = {}): Actions => ({
  canEnter: false,
  canWithdraw: false,
  canAddAttempt: false,
  reasons: [],
  ...overrides,
});

export const result = (overrides: Partial<Result> = {}): Result => ({
  status: 'none',
  elapsedSec: null,
  place: null,
  tied: false,
  ranked: 0,
  group: 'overall',
  ...overrides,
});

/** Не заявлен: можно «Участвовать». */
export const noEntry = (overrides: Partial<MyRaceEntry> = {}): MyRaceEntry => ({
  raceId: RACE_ID,
  entry: null,
  result: result(),
  attempts: [],
  pendingUploads: [],
  // 12 октября 23:59 по Минску
  uploadClosesAt: '2026-10-12T20:59:00Z',
  actions: actions({ canEnter: true, reasons: ['not_entered'] }),
  ...overrides,
});

/** Активная заявка без попыток: можно загрузить и отменить. */
export const myEntry = (overrides: Partial<MyRaceEntry> = {}): MyRaceEntry => ({
  ...noEntry(),
  entry: {
    id: ENTRY_ID,
    status: 'active',
    createdAt: '2026-10-05T08:00:00Z',
    withdrawnAt: null,
  },
  actions: actions({ canWithdraw: true, canAddAttempt: true }),
  ...overrides,
});

export const attempt = (overrides: Partial<MyAttempt> = {}): MyAttempt => ({
  id: '0199d000-0000-7000-8000-0000000000b1',
  origin: 'explicit',
  status: 'counted',
  reasons: [],
  segment: {
    startedAt: '2026-10-08T16:45:00Z',
    finishedAt: '2026-10-08T18:27:05Z',
    elapsedSec: 6125,
    distanceM: 61_800,
    offCorridorM: 0,
    offCorridorShare: 0,
    maxExcursionM: 0,
    coverage: 1,
  },
  isBest: true,
  activity: {
    id: ACTIVITY_ID,
    // 8 октября, 19:42 по Минску
    startedAt: '2026-10-08T16:42:00Z',
    source: 'upload',
    elapsedSec: 6400,
    distanceM: 62_300,
  },
  createdAt: '2026-10-08T19:00:00Z',
  checkedAt: '2026-10-08T19:01:00Z',
  ...overrides,
});

export const row = (overrides: Partial<RaceResultRow> = {}): RaceResultRow => ({
  entryId: '0199d000-0000-7000-8000-0000000000f1',
  place: 1,
  tied: false,
  elapsedSec: 5400,
  ...overrides,
});

export const resultsPage = (
  items: RaceResultRow[] = [],
  overrides: Partial<RaceResultsPage> = {},
): RaceResultsPage => ({
  group: 'overall',
  status: 'provisional',
  ranked: items.length,
  entries: items.length,
  items,
  nextCursor: null,
  ...overrides,
});

export const candidate = (
  overrides: Partial<AttemptCandidates['items'][number]> = {},
): AttemptCandidates['items'][number] => ({
  activityId: ACTIVITY_ID,
  // 8 октября, 19:42 по Минску
  startedAt: '2026-10-08T16:42:00Z',
  source: 'garmin',
  elapsedSec: 6400,
  distanceM: 62_300,
  attempted: false,
  ...overrides,
});

export const candidates = (...items: AttemptCandidates['items']): AttemptCandidates => ({ items });
