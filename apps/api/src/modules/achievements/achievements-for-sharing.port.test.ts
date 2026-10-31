import { describe, expect, it } from 'vitest';

import { cardRef } from './achievements-for-sharing.port';

const SEASON = '0190a6f4-0000-7000-8000-000000000301';

describe('cardRef (адрес карточки, C2)', () => {
  it('сезонный с сезоном и несезонный без сезона — адрес', () => {
    expect(cardRef('season_champion', SEASON)).toEqual({
      code: 'season_champion',
      seasonId: SEASON,
    });
    expect(cardRef('race_win', null)).toEqual({ code: 'race_win', seasonId: null });
  });

  it('сезонный без сезона и несезонный с сезоном — `null`', () => {
    expect(cardRef('season_regular', null)).toBeNull();
    expect(cardRef('race_win', SEASON)).toBeNull();
  });
});
