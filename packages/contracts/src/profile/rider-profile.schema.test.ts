import { describe, expect, it } from 'vitest';

import {
  PublicRiderProfile,
  PublicRiderRacePage,
  RIDER_HISTORY_MAX_LIMIT,
  RiderHistoryQuery,
  RiderRaceHistoryPage,
  RiderRideHistoryPage,
  RiderStats,
} from './rider-profile.schema.ts';

const ID = '0192f3a0-0000-7000-8000-000000000001';
const TOKEN = 'a'.repeat(43);
const AT = '2026-06-01T08:00:00.000Z';

describe('RiderHistoryQuery', () => {
  it('limit по умолчанию 10, 1–20; курсор необязателен', () => {
    expect(RiderHistoryQuery.parse({})).toEqual({ limit: 10 });
    expect(RiderHistoryQuery.parse({ limit: '20', cursor: 'abc' })).toEqual({
      limit: 20,
      cursor: 'abc',
    });
    expect(RIDER_HISTORY_MAX_LIMIT).toBe(20);
    expect(RiderHistoryQuery.safeParse({ limit: '21' }).success).toBe(false);
    expect(RiderHistoryQuery.safeParse({ limit: '0' }).success).toBe(false);
    expect(RiderHistoryQuery.safeParse({ userId: ID }).success).toBe(false);
  });
});

describe('RiderStats', () => {
  it('целые суммы и до трёх лучших мест; незнакомая группа — unknown', () => {
    const best = {
      race: { id: ID, title: 'Гонка', windowStartsAt: AT },
      place: 1,
      tied: false,
      groupKey: 'x_new',
    };
    const parsed = RiderStats.parse({
      activities: 3,
      distanceM: 120_000,
      elevationGainM: 900,
      races: 2,
      podiums: 1,
      bestPlaces: [best],
    });
    expect(parsed.bestPlaces[0]?.groupKey).toBe('unknown');
    expect(RiderStats.safeParse({ ...parsed, bestPlaces: [best, best, best, best] }).success).toBe(
      false,
    );
    expect(RiderStats.safeParse({ ...parsed, distanceM: 1.5 }).success).toBe(false);
  });
});

describe('RiderRaceHistoryPage', () => {
  it('статусы — tolerantEnum, курсор nullable', () => {
    const page = RiderRaceHistoryPage.parse({
      items: [
        {
          race: {
            id: ID,
            title: 'Гонка',
            windowStartsAt: AT,
            windowEndsAt: AT,
            status: 'published',
          },
          result: { status: 'brand_new', place: null, tied: false, elapsedSec: null },
          groupKey: 'overall',
          tier: 'start',
        },
      ],
      nextCursor: null,
    });
    expect(page.items[0]?.result.status).toBe('unknown');
    expect(page.items[0]?.result.unranked).toBeNull();
  });
});

describe('RiderRideHistoryPage', () => {
  it('роль — tolerantEnum', () => {
    const page = RiderRideHistoryPage.parse({
      items: [{ id: ID, title: 'Кофе', startsAt: AT, distanceKm: 42.5, role: 'guide' }],
      nextCursor: 'c',
    });
    expect(page.items[0]?.role).toBe('unknown');
  });
});

describe('PublicRiderProfile / PublicRiderRacePage', () => {
  it('публичный профиль: имя, клуб, аватар, статистика без км', () => {
    const profile = PublicRiderProfile.parse({
      publicId: TOKEN,
      name: 'Анна К.',
      club: null,
      avatar: { id: TOKEN },
      stats: { races: 1, podiums: 0, bestPlace: 4 },
    });
    expect(profile.stats).toEqual({ races: 1, podiums: 0, bestPlace: 4 });
    expect(PublicRiderProfile.safeParse({ ...profile, publicId: 'x' }).success).toBe(false);
  });

  it('строка истории — статус протокола tolerantEnum', () => {
    const page = PublicRiderRacePage.parse({
      items: [
        {
          race: { id: ID, title: 'Гонка', windowStartsAt: AT },
          place: null,
          tied: false,
          status: 'dq',
          groupKey: 'm_u40',
          elapsedSec: 3600,
        },
      ],
      nextCursor: null,
    });
    expect(page.items[0]?.status).toBe('dq');
  });
});
