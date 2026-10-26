import type { DisputeAgainstMe, MyDispute, MyRaceDisputes } from '@pokatim/contracts';

import { RACE_ID } from './races-fixtures';

/** Фикстуры споров (race-results-06) в форме ответов API; гонка — `corridorRace` (протокол 14 октября 12:00). */
export const DISPUTE_ID = '0199e000-0000-7000-8000-0000000000d1';
export const RIVAL_ENTRY_ID = '0199d000-0000-7000-8000-0000000000f1';

type Filing = MyRaceDisputes['filing'];

/** Мой спор как заявителя: открыт, по строке соперника. */
export const filed = (overrides: Partial<MyDispute> = {}): MyDispute => ({
  id: DISPUTE_ID,
  raceId: RACE_ID,
  targetEntryId: RIVAL_ENTRY_ID,
  category: 'vehicle_assistance',
  description: null,
  status: 'open',
  filedAt: '2026-10-09T08:00:00Z',
  closedAt: null,
  decision: null,
  ...overrides,
});

/** Спор по моему результату: открыт, ответить можно. */
export const against = (overrides: Partial<DisputeAgainstMe> = {}): DisputeAgainstMe => ({
  id: '0199e000-0000-7000-8000-0000000000d2',
  raceId: RACE_ID,
  category: 'speed_vs_heart_rate',
  status: 'open',
  filedAt: '2026-10-09T08:00:00Z',
  decidableBy: '2026-10-14T09:00:00Z',
  response: null,
  canRespond: true,
  decision: null,
  ...overrides,
});

/** «Мои споры в гонке»: приём открыт до 13 октября 12:00 по Минску (за 24 ч до протокола). */
export const myDisputes = (
  filing: Partial<Filing> = {},
  overrides: Partial<Omit<MyRaceDisputes, 'filing'>> = {},
): MyRaceDisputes => ({
  raceId: RACE_ID,
  filing: {
    status: 'open',
    closesAt: '2026-10-13T09:00:00Z',
    protocolPlannedAt: '2026-10-14T09:00:00Z',
    reason: null,
    ...filing,
  },
  filed: [],
  against: [],
  ...overrides,
});
