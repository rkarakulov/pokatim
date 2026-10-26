/// <reference types="jest" />
import type { RideCard } from '@pokatim/contracts';

import { groupByDay, sortCitiesByLabel, toggleCity, withinAvailable } from './filters';

const ride = (id: string, startsAt: string) => ({ id, startsAt }) as RideCard;

describe('фильтр «Город» и группы дней', () => {
  it('чипы — по алфавиту подписи, не кода', () => {
    expect(sortCitiesByLabel(['minsk', 'brest', 'gomel', 'baranovichi'])).toEqual([
      'baranovichi',
      'brest',
      'gomel',
      'minsk',
    ]);
  });

  it('toggle отсортирован, предел — 12 городов', () => {
    expect(toggleCity(['minsk'], 'brest')).toEqual(['brest', 'minsk']);
    expect(toggleCity(['brest', 'minsk'], 'brest')).toEqual(['minsk']);
    const twelve = sortCitiesByLabel([
      'minsk',
      'brest',
      'vitebsk',
      'gomel',
      'grodno',
      'mogilev',
      'baranovichi',
      'bobruisk',
      'borisov',
      'pinsk',
      'orsha',
      'mozyr',
    ]);
    expect(toggleCity(twelve, 'lida')).toHaveLength(12);
  });

  it('исчезнувший город снимается; до загрузки — без изменений', () => {
    expect(withinAvailable({ city: ['brest', 'minsk'] }, ['minsk'])).toEqual({ city: ['minsk'] });
    expect(withinAvailable({ city: ['brest'] }, undefined)).toEqual({ city: ['brest'] });
  });

  it('подпись дня — по Минску, при смене дня; полночь UTC+3 — уже следующий день', () => {
    const rows = groupByDay([
      ride('a', '2026-10-04T07:00:00Z'),
      ride('b', '2026-10-04T15:00:00Z'),
      // 21:30 UTC 4 октября — 00:30 5 октября по Минску
      ride('c', '2026-10-04T21:30:00Z'),
    ]);
    expect(rows.map((row) => (row.kind === 'day' ? `day:${row.day}` : row.ride.id))).toEqual([
      'day:2026-10-04',
      'a',
      'b',
      'day:2026-10-05',
      'c',
    ]);
  });
});
