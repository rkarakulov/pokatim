import { uuidv7 } from '@rkarakulov/api-kit/mongo';

import {
  calendarCollections,
  type CalendarStartDoc,
} from '../src/modules/calendar/calendar.collection';
import type { RaceDoc } from '../src/modules/races/races.collection';
import type { Harness } from './harness';
import { racesDb } from './races';

/** Владелец гонок и стартов прямой вставкой (поле владельца на картинку не попадает — проверяют тесты OG). */
export const OG_OWNER = '01890a5d-0000-7000-8000-0000000000aa';

/**
 * Гонка прямой вставкой (og-images: подготовка видимости; публикацию через панель проверяют тесты `races`).
 * По умолчанию — опубликованная, без коридора.
 */
export async function seedRace(h: Harness, overrides: Partial<RaceDoc> = {}): Promise<string> {
  const id = overrides._id ?? uuidv7();
  const now = h.clock.now();
  await racesDb(h).races.insertOne({
    _id: id,
    ownerUserId: OG_OWNER,
    status: 'published',
    title: 'Минское кольцо',
    bikeClass: 'road',
    surfaces: ['asphalt'],
    distanceKm: 42.5,
    description: 'Описание организатора',
    windowStartsAt: new Date('2026-10-23T21:00:00Z'),
    windowEndsAt: new Date('2026-10-26T20:59:00Z'),
    protocolPlannedAt: new Date('2026-10-28T20:59:00Z'),
    seasonId: null,
    cancelReason: null,
    corridor: null,
    createdAt: now,
    updatedAt: now,
    publishedAt: now,
    cancelledAt: null,
    lockedAt: null,
    protocolPublishedAt: null,
    disputeFilingClosedAt: null,
    version: 1,
    ...overrides,
  });
  return id;
}

export const startsDb = (h: Harness) => calendarCollections(h.db).starts;

/** Старт календаря прямой вставкой; по умолчанию опубликованный двухдневный в Минске. */
export async function seedStart(
  h: Harness,
  overrides: Partial<CalendarStartDoc> = {},
): Promise<string> {
  const id = overrides._id ?? uuidv7();
  const now = h.clock.now();
  await startsDb(h).insertOne({
    _id: id,
    status: 'published',
    title: 'Гран-фондо Минск',
    startsOn: '2026-11-14',
    endsOn: '2026-11-15',
    startTime: '09:00',
    discipline: 'road',
    city: 'Минск',
    cityKey: 'минск',
    place: 'Парк Победы',
    distancesKm: [60, 120],
    registrationUrl: null,
    description: null,
    createdByUserId: OG_OWNER,
    createdAt: now,
    updatedAt: now,
    unpublishedAt: null,
    version: 1,
    ...overrides,
  });
  return id;
}
