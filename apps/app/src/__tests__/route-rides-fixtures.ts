import type {
  RouteRideCandidate,
  RouteRideCandidates,
  RouteRideDetail,
  RouteRidePage,
  RouteRideRow,
  RouteRideTrack,
  TrackUpload,
} from '@pokatim/contracts';

/** Фикстуры заезда по маршруту (route-rides-02) в форме ответов API (контракты route-rides-01). */
export const ROUTE_ID = '0190a6f4-0000-7000-8000-000000000001';
export const RIDE_ID = '0199e000-0000-7000-8000-0000000000d1';
export const BEST_ID = '0199e000-0000-7000-8000-0000000000b1';
export const PREVIOUS_ID = '0199e000-0000-7000-8000-0000000000c1';
export const ACTIVITY_ID = '0199d000-0000-7000-8000-0000000000a1';
export const UPLOAD_ID = '0199c000-0000-7000-8000-000000000001';

/** 12 октября 2026, 09:30 по Минску. */
const STARTED_AT = '2026-10-12T06:30:00.000Z';
const AT = '2026-10-27T10:00:00.000Z';

export const routeRef = { id: ROUTE_ID, title: 'Минское кольцо', distanceM: 86_012 };
export const activity = {
  startedAt: STARTED_AT,
  source: 'garmin' as const,
  elapsedSec: 7_600,
  distanceM: 88_400,
};

let seq = 0;
const nextId = () => `0199e000-0000-7000-8000-${String((seq += 1) + 500).padStart(12, '0')}`;

export const rideRow = (overrides: Partial<RouteRideRow> = {}): RouteRideRow => ({
  id: nextId(),
  status: 'passed',
  reason: null,
  elapsedSec: 7_477,
  isBest: false,
  activity,
  createdAt: AT,
  ...overrides,
});

export const ridesPage = (
  items: RouteRideRow[] = [],
  summary: Partial<RouteRidePage['summary']> = {},
): RouteRidePage => ({
  route: routeRef,
  summary: { count: items.length, passedCount: 0, best: null, ...summary },
  items,
});

export const rideDetail = (overrides: Partial<RouteRideDetail> = {}): RouteRideDetail => ({
  id: RIDE_ID,
  route: routeRef,
  activityId: ACTIVITY_ID,
  origin: 'manual',
  status: 'passed',
  reason: null,
  failure: null,
  elapsedSec: 7_477,
  routeDistanceM: 86_100,
  activity,
  comparison: {
    best: { id: RIDE_ID, elapsedSec: 7_477, rideStartedAt: STARTED_AT },
    isBest: true,
    deltaToBestSec: 0,
    previous: null,
    deltaToPreviousSec: null,
  },
  createdAt: AT,
  checkedAt: AT,
  ...overrides,
});

export const rideCandidate = (overrides: Partial<RouteRideCandidate> = {}): RouteRideCandidate => ({
  activityId: ACTIVITY_ID,
  startedAt: STARTED_AT,
  source: 'garmin',
  elapsedSec: 7_600,
  distanceM: 88_400,
  rideId: null,
  ...overrides,
});

export const rideCandidates = (...items: RouteRideCandidate[]): RouteRideCandidates => ({ items });

export const rideTrack = (overrides: Partial<RouteRideTrack> = {}): RouteRideTrack => ({
  rideId: RIDE_ID,
  line: [
    [27.5, 53.8],
    [27.55, 53.9],
    [27.6, 54.0],
  ],
  segment: { from: 0, to: 2 },
  offRuns: [],
  marks: 'ready',
  ...overrides,
});

export const trackUpload = (overrides: Partial<TrackUpload> = {}): TrackUpload => ({
  id: UPLOAD_ID,
  source: 'upload',
  format: 'gpx',
  fileName: 'ride.gpx',
  status: 'ready',
  failure: null,
  activity: null,
  createdAt: AT,
  ...overrides,
});
