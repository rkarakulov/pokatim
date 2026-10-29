/// <reference types="jest" />
import type { Achievement } from '@pokatim/contracts';

import {
  achievementA11y,
  achievementObjectText,
  achievementTitle,
  factDateText,
  flashQueue,
  knownItems,
  publicItems,
  shareRaceId,
} from './achievement-catalog';

const RACE = '0190a6f4-0000-7000-8000-000000000201';
const ROUTE = '0190a6f4-0000-7000-8000-000000000301';

const item = (overrides: Partial<Achievement> = {}): Achievement => ({
  code: 'race_first_finish',
  object: { kind: 'race', id: RACE, title: 'Гонка у озера' },
  factDate: '2026-05-02',
  seen: true,
  ...overrides,
});

describe('knownItems (RC-8)', () => {
  it('отбрасывает незнакомые коды старой сборки, порядок сервера сохраняется', () => {
    const items = [
      item({ code: 'race_win' }),
      item({ code: 'unknown' }),
      item({ code: 'route_first' }),
    ];
    expect(knownItems(items).map((a) => a.code)).toEqual(['race_win', 'route_first']);
  });
});

describe('flashQueue (A5)', () => {
  it('только неувиденные известные — от старых к новым (обратный порядок ответа)', () => {
    // ответ сервера — от новых фактов к старым
    const items = [
      item({ code: 'races_5', seen: false }),
      item({ code: 'unknown', seen: false }),
      item({ code: 'race_win', seen: true }),
      item({ code: 'race_podium', seen: false }),
      item({ code: 'race_first_finish', seen: false }),
    ];
    expect(flashQueue(items).map((a) => a.code)).toEqual([
      'race_first_finish',
      'race_podium',
      'races_5',
    ]);
  });

  it('исключает уже показанные в этом запуске (сбой `seen` не зацикливает вспышку)', () => {
    const items = [
      item({ code: 'race_win', seen: false }),
      item({ code: 'ride_first', seen: false }),
    ];
    expect(flashQueue(items, new Set(['race_win'])).map((a) => a.code)).toEqual(['ride_first']);
  });

  it('всё просмотрено или пусто — очереди нет', () => {
    expect(flashQueue([item()])).toEqual([]);
    expect(flashQueue([])).toEqual([]);
  });
});

describe('shareRaceId (A6, AC11)', () => {
  it.each(['race_first_finish', 'race_podium', 'race_win', 'races_5'] as const)(
    '%s — гонка объекта',
    (code) => {
      const [known] = knownItems([item({ code })]);
      expect(shareRaceId(known!)).toBe(RACE);
    },
  );

  it.each(['route_first', 'routes_5', 'ride_first', 'ride_organizer', 'rides_10'] as const)(
    '%s — без шеринга',
    (code) => {
      const [known] = knownItems([
        item({ code, object: { kind: 'route', id: ROUTE, title: 'Петля' } }),
      ]);
      expect(shareRaceId(known!)).toBeNull();
    },
  );

  it('незнакомый вид объекта — без шеринга', () => {
    const [known] = knownItems([item({ object: { kind: 'unknown', id: RACE, title: 'Что-то' } })]);
    expect(shareRaceId(known!)).toBeNull();
  });
});

describe('подписи', () => {
  it('название, объект по виду, дата факта с годом', () => {
    expect(achievementTitle('race_podium')).toBe('Подиум');
    expect(achievementObjectText(item().object)).toBe('Гонка «Гонка у озера»');
    expect(achievementObjectText({ kind: 'route', id: ROUTE, title: 'Петля' })).toBe(
      'Маршрут «Петля»',
    );
    expect(achievementObjectText({ kind: 'ride', id: ROUTE, title: 'Кофе' })).toBe(
      'Кофе-райд «Кофе»',
    );
    expect(achievementObjectText({ kind: 'unknown', id: ROUTE, title: 'X' })).toBe('X');
    expect(factDateText('2026-05-02')).toBe('2 мая 2026');
  });

  it('подпись a11y: название, объект и дата', () => {
    const [known] = knownItems([item({ code: 'race_win' })]);
    expect(achievementA11y(known!)).toBe('Достижение «Победа»: Гонка «Гонка у озера», 2 мая 2026');
  });
});

describe('publicItems (A7, LOW-2 ревью)', () => {
  it('в публичном профиле — только гоночные коды', () => {
    const items = knownItems([
      item({ code: 'race_podium' }),
      item({ code: 'route_first' }),
      item({ code: 'ride_organizer' }),
      item({ code: 'races_5' }),
    ]);
    expect(publicItems(items).map((a) => a.code)).toEqual(['race_podium', 'races_5']);
  });
});
