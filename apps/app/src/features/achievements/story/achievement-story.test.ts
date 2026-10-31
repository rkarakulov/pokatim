/// <reference types="jest" />
import { api } from '@/lib/api';

import {
  achievementStoryKey,
  achievementStoryPath,
  achievementStorySource,
} from './achievement-story';

jest.mock('@/lib/api');

const SEASON = '0190a6f4-0000-7000-8000-000000000401';

afterEach(() => {
  jest.clearAllMocks();
});

describe('адрес карточки достижения (C2)', () => {
  it('несезонное — без сезона; сезонное — `?season=` (encode)', () => {
    expect(achievementStoryPath('race_win', null)).toBe('/achievements/story/race_win');
    expect(achievementStoryPath('season_champion', SEASON)).toBe(
      `/achievements/story/season_champion?season=${SEASON}`,
    );
    expect(achievementStoryPath('season_champion', 'a b&c')).toBe(
      '/achievements/story/season_champion?season=a%20b%26c',
    );
  });
});

describe('ключ и источник статуса', () => {
  it('ключ содержит сезон — карточки двух сезонов не делят кэш', () => {
    expect(achievementStoryKey('race_win', null, 'line')).toEqual([
      'achievements',
      'story',
      'race_win',
      null,
      'line',
    ]);
    expect(achievementStoryKey('season_podium', SEASON, 'night')).toEqual([
      'achievements',
      'story',
      'season_podium',
      SEASON,
      'night',
    ]);
    expect(achievementStorySource('season_podium', SEASON).key('night')).toEqual(
      achievementStoryKey('season_podium', SEASON, 'night'),
    );
  });

  it('`seasonId` уходит в запрос только у сезонного', async () => {
    jest.mocked(api.getAchievementCard).mockResolvedValue({ status: 'pending' });
    await achievementStorySource('race_win', null).fetch('jwt', 'line');
    expect(api.getAchievementCard).toHaveBeenLastCalledWith('jwt', 'race_win', {
      template: 'line',
    });
    await achievementStorySource('season_champion', SEASON).fetch('jwt', 'night');
    expect(api.getAchievementCard).toHaveBeenLastCalledWith('jwt', 'season_champion', {
      template: 'night',
      seasonId: SEASON,
    });
  });
});
