/// <reference types="jest" />
import type { Achievement } from '@pokatim/contracts';

import { flashKey, flashQueue } from './achievement-catalog';
import { closePresented, hiddenKeys, markShown, openPresented, resetShown } from './flash-session';

const item = (level: Achievement['level'], seen = false): Achievement => ({
  code: 'races_5',
  object: { kind: 'race', id: '0190a6f4-0000-7000-8000-000000000201', title: 'Гонка' },
  factDate: '2026-05-02',
  level,
  seen,
});

afterEach(() => resetShown());

describe('flash-session по ключу `code:level` (RC-L4)', () => {
  it('бронза показана в этом запуске — серебро того же кода всё равно вспыхивает', () => {
    markShown(flashKey(item('bronze')));
    expect(flashQueue([item('silver')], hiddenKeys(1)).map(flashKey)).toEqual(['races_5:silver']);
    expect(flashQueue([item('bronze')], hiddenKeys(1))).toEqual([]);
  });

  it('открытая очередь скрывает свой уровень до нового ответа; повышение — нет', () => {
    openPresented([flashKey(item('silver'))]);
    expect(flashQueue([item('silver')], hiddenKeys(5))).toEqual([]);
    expect(flashQueue([item('gold')], hiddenKeys(5)).map(flashKey)).toEqual(['races_5:gold']);
    closePresented(5);
    expect(flashQueue([item('silver')], hiddenKeys(5))).toEqual([]);
    expect(flashQueue([item('silver')], hiddenKeys(6)).map(flashKey)).toEqual(['races_5:silver']);
  });
});

describe('flash-session — сезонные по ключу `code:seasonId` (achievements-seasonal)', () => {
  const season = (seasonId: string): Achievement => ({
    code: 'season_podium',
    object: { kind: 'season', id: seasonId, title: 'Сезон' },
    factDate: '2025-10-31',
    level: null,
    seen: false,
  });
  const A = '0190a6f4-0000-7000-8000-000000000401';
  const B = '0190a6f4-0000-7000-8000-000000000402';

  it('показан «Призёр» сезона A — «Призёр» сезона B всё равно вспыхивает', () => {
    markShown(flashKey(season(A)));
    expect(flashQueue([season(A), season(B)], hiddenKeys(1)).map(flashKey)).toEqual([
      `season_podium:${B}:`,
    ]);
  });
});
