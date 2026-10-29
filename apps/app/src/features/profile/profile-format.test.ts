/// <reference types="jest" />
import type { RiderRaceHistoryItem } from '@pokatim/contracts';

import {
  ownRaceRow,
  ownStatItems,
  publicRaceRow,
  publicStatItems,
  rideRow,
} from './profile-format';

const RACE_ID = '0190a6f4-0000-7000-8000-000000000001';
const race = (overrides: Partial<RiderRaceHistoryItem> = {}): RiderRaceHistoryItem => ({
  race: {
    id: RACE_ID,
    title: 'Гонка у озера',
    windowStartsAt: '2026-05-01T06:00:00.000Z',
    windowEndsAt: '2026-05-03T18:00:00.000Z',
    status: 'published',
  },
  result: { status: 'final', place: 6, tied: true, elapsedSec: 3725, unranked: null },
  groupKey: 'm_u40',
  tier: 'verified',
  ...overrides,
});

describe('подписи профиля райдера (rider-profile)', () => {
  it('статистика: заезды, км с десятой, набор, гонки, подиумы, лучшее место «=6»; нет мест — «—»', () => {
    const items = ownStatItems({
      activities: 12,
      distanceM: 345_678,
      elevationGainM: 4200,
      races: 3,
      podiums: 1,
      finishes: 5,
      bestPlaces: [
        {
          race: { id: RACE_ID, title: 'Гонка', windowStartsAt: '2026-05-01T06:00:00.000Z' },
          place: 6,
          tied: true,
          groupKey: 'overall',
        },
      ],
    });
    expect(items.map((item) => [item.label, item.value, item.unit])).toEqual([
      ['Заезды', '12', undefined],
      ['Дистанция', '345,7', 'км'],
      ['Набор', expect.stringMatching(/^4\s200$/), 'м'],
      ['В зачёте', '3', undefined],
      ['Финиши', '5', undefined],
      ['Подиумы', '1', undefined],
      ['Лучшее место', '=6', undefined],
    ]);
    const publicItems = publicStatItems({ races: 0, podiums: 0, bestPlace: null, finishes: 2 });
    expect(publicItems.map((item) => [item.label, item.value])).toEqual([
      ['В зачёте', '0'],
      ['Финиши', '2'],
      ['Подиумы', '0'],
      ['Лучшее место', '—'],
    ]);
  });

  it('своя гонка: место, дата с годом, плашка, уровень и группа, время; a11y одной строкой', () => {
    const row = ownRaceRow(race());
    expect(row).toMatchObject({
      raceId: RACE_ID,
      place: '=6',
      title: 'Гонка у озера',
      details: 'Verified · Мужчины до 40',
      pill: { label: 'Финальный', tone: 'success' },
      time: '1:02:05',
    });
    expect(row.date).toContain('2026');
    expect(row.a11y).toBe(
      `Гонка у озера, ${row.date}, место 6-е место поровну, Финальный, время 1:02:05`,
    );
  });

  it('своя гонка без места и времени (проверка трека) — «—», без времени; unknown — без подписи', () => {
    const row = ownRaceRow(
      race({
        result: { status: 'pending', place: null, tied: false, elapsedSec: null, unranked: null },
        tier: 'unknown',
        groupKey: 'unknown',
      }),
    );
    expect(row).toMatchObject({ place: '—', time: null, details: '' });
    // без места — без части «место …» в метке
    expect(row.a11y).toBe(`Гонка у озера, ${row.date}, Проверка трека`);
  });

  it('публичная гонка — статус протокола и время', () => {
    const row = publicRaceRow({
      race: { id: RACE_ID, title: 'Гонка', windowStartsAt: '2026-05-01T06:00:00.000Z' },
      place: 2,
      tied: false,
      status: 'dq',
      groupKey: 'overall',
      elapsedSec: 60,
      unranked: null,
    });
    expect(row).toMatchObject({
      place: '2',
      pill: { label: 'Дисквалифицирован', tone: 'error' },
      time: '0:01:00',
      details: 'Общий зачёт',
    });
  });

  it('публичный финиш без места (rider-links-in-tables) — «—» и «Финишёр», время', () => {
    const row = publicRaceRow({
      race: { id: RACE_ID, title: 'Гонка', windowStartsAt: '2026-05-01T06:00:00.000Z' },
      place: null,
      tied: false,
      status: 'final',
      groupKey: 'overall',
      elapsedSec: 3600,
      unranked: 'start',
    });
    expect(row).toMatchObject({
      place: '—',
      pill: { label: 'Финишёр', tone: 'neutral' },
      time: '1:00:00',
    });
    expect(row.a11y).toBe(`Гонка, ${row.date}, Финишёр, время 1:00:00`);
  });

  it('райд: дата и время старта, км, роль', () => {
    const row = rideRow({
      id: RACE_ID,
      title: 'Утренний кофе',
      startsAt: '2026-05-02T06:00:00.000Z',
      distanceKm: 42.5,
      role: 'organizer',
    });
    expect(row.details).toMatch(/2026.* · 42,5 км · Организатор$/);
    expect(row.a11y).toBe(`Утренний кофе · ${row.details}`);
  });
});
