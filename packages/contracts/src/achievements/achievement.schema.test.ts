import { describe, expect, it } from 'vitest';

import {
  Achievement,
  ACHIEVEMENT_CODES,
  ACHIEVEMENT_LEVEL_TARGETS,
  ACHIEVEMENT_LEVELS,
  ACHIEVEMENT_OBJECT_KINDS,
  AchievementList,
  isLeveledCode,
  isSeasonalCode,
  MarkAchievementsSeenRequest,
  PublicRiderAchievementList,
  SEASON_REGULAR_MIN_RACES,
  SEASONAL_ACHIEVEMENT_CODES,
  SEASONAL_SEEN_MAX,
} from './achievement.schema.ts';

const ID = '01890a5d-ac96-774b-bcce-b302099a8057';
const v1 = {
  code: 'race_win',
  object: { kind: 'race', id: ID, title: 'Гонка' },
  factDate: '2026-06-01',
  seen: false,
};
const item = {
  code: 'race_win',
  object: { kind: 'race', id: ID, title: 'Гонка' },
  factDate: '2026-06-01',
  level: null,
  seen: false,
};

describe('достижения (achievements)', () => {
  it('каталог — коды v1 и сезонные в установленном порядке (только в конец, RC-S4); виды объекта', () => {
    expect(ACHIEVEMENT_CODES).toEqual([
      'race_first_finish',
      'race_podium',
      'race_win',
      'races_5',
      'route_first',
      'routes_5',
      'ride_first',
      'ride_organizer',
      'rides_10',
      'season_regular',
      'season_podium',
      'season_champion',
    ]);
    expect(ACHIEVEMENT_OBJECT_KINDS).toEqual(['race', 'route', 'ride', 'season']);
    expect(SEASONAL_ACHIEVEMENT_CODES).toEqual([
      'season_regular',
      'season_podium',
      'season_champion',
    ]);
    expect(ACHIEVEMENT_CODES.filter(isSeasonalCode)).toEqual([...SEASONAL_ACHIEVEMENT_CODES]);
    expect(SEASON_REGULAR_MIN_RACES).toBe(3);
  });

  it('Achievement: объект-сезон разбирается; незнакомый вид (`planet`) — `unknown`', () => {
    const seasonal = {
      ...item,
      code: 'season_champion',
      object: { kind: 'season', id: ID, title: 'Сезон 2026' },
    };
    expect(Achievement.parse(seasonal)).toEqual(seasonal);
    expect(
      Achievement.parse({ ...seasonal, object: { ...seasonal.object, kind: 'planet' } }).object
        .kind,
    ).toBe('unknown');
  });

  it('Achievement: известные значения как есть; незнакомый код и вид — `unknown` (RC-8)', () => {
    expect(AchievementList.parse({ items: [item], progress: [] })).toEqual({
      items: [item],
      progress: [],
    });
    expect(
      Achievement.parse({ ...item, code: 'season_win', object: { ...item.object, kind: 'club' } }),
    ).toEqual({ ...item, code: 'unknown', object: { ...item.object, kind: 'unknown' } });
  });

  it('Achievement: дата — только `YYYY-MM-DD` (без времени суток, RC-7)', () => {
    expect(Achievement.safeParse({ ...item, factDate: '2026-06-01T08:00:00Z' }).success).toBe(
      false,
    );
  });

  it('уровни (L1): три уровня; пороги — у трёх счётных кодов, только они «счётные»', () => {
    expect(ACHIEVEMENT_LEVELS).toEqual(['bronze', 'silver', 'gold']);
    expect(ACHIEVEMENT_LEVEL_TARGETS).toEqual({
      races_5: [5, 15, 30],
      routes_5: [5, 15, 30],
      rides_10: [10, 25, 50],
    });
    expect(ACHIEVEMENT_CODES.filter(isLeveledCode)).toEqual(['races_5', 'routes_5', 'rides_10']);
  });

  it('Achievement.level: уровень как есть; без поля — `null` (старый API); незнакомый — `unknown`', () => {
    expect(Achievement.parse({ ...item, code: 'races_5', level: 'silver' }).level).toBe('silver');
    expect(Achievement.parse(v1).level).toBeNull();
    expect(Achievement.parse({ ...item, level: 'platinum' }).level).toBe('unknown');
  });

  it('AchievementList: ответ v1 без `level`/`progress` разбирается; прогресс — с tolerant кодом и уровнем', () => {
    expect(AchievementList.parse({ items: [v1] })).toEqual({ items: [item], progress: [] });
    const progress = [
      { code: 'races_5', level: 'silver', current: 7, target: 15 },
      { code: 'season_10', level: 'platinum', current: 1, target: 3 },
    ];
    expect(AchievementList.parse({ items: [], progress }).progress).toEqual([
      progress[0],
      { code: 'unknown', level: 'unknown', current: 1, target: 3 },
    ]);
    for (const bad of [
      { code: 'races_5', level: 'silver', current: -1, target: 15 },
      { code: 'races_5', level: 'silver', current: 1, target: 0 },
      { code: 'races_5', level: 'silver', current: 1.5, target: 15 },
    ]) {
      expect(AchievementList.safeParse({ items: [], progress: [bad] }).success).toBe(false);
    }
  });

  it('PublicRiderAchievementList: с `level`, без `seen` и без прогресса', () => {
    const publicItem = {
      code: item.code,
      object: item.object,
      factDate: item.factDate,
      level: null,
    };
    expect(
      PublicRiderAchievementList.parse({
        items: [{ ...publicItem, seen: true }],
        progress: [{ code: 'races_5', level: 'silver', current: 7, target: 15 }],
      }),
    ).toEqual({ items: [publicItem] });
  });

  it('MarkAchievementsSeenRequest: `{ codes }` v1 валиден; `seasonal` — по `(code, seasonId)`; иначе — ошибка', () => {
    expect(MarkAchievementsSeenRequest.parse({ codes: ['race_win'] })).toEqual({
      codes: ['race_win'],
      seasonal: [],
    });
    expect(MarkAchievementsSeenRequest.parse({ codes: [...ACHIEVEMENT_CODES] }).codes).toHaveLength(
      ACHIEVEMENT_CODES.length,
    );
    const ref = { code: 'season_podium', seasonId: ID };
    const other = { code: 'season_podium', seasonId: '01890a5d-ac96-774b-bcce-b302099a8058' };
    expect(MarkAchievementsSeenRequest.parse({ seasonal: [ref, other] })).toEqual({
      codes: [],
      seasonal: [ref, other],
    });
    const many = Array.from({ length: SEASONAL_SEEN_MAX + 1 }, (_, i) => ({
      code: 'season_regular',
      seasonId: `01890a5d-ac96-774b-bcce-${String(i).padStart(12, '0')}`,
    }));
    expect(MarkAchievementsSeenRequest.safeParse({ seasonal: many.slice(1) }).success).toBe(true);
    const invalid = [
      { codes: [] },
      { codes: [], seasonal: [] },
      { seasonal: [] },
      { codes: [...ACHIEVEMENT_CODES, 'race_win'] },
      { codes: ['race_win', 'race_win'] },
      { codes: ['season_win'] },
      { codes: ['race_win'], extra: 1 },
      { seasonal: [{ code: 'race_win', seasonId: ID }] },
      { seasonal: [ref, ref] },
      { seasonal: [{ ...ref, extra: 1 }] },
      { seasonal: [{ ...ref, seasonId: 'x' }] },
      { seasonal: many },
      {},
    ];
    for (const body of invalid) {
      expect(MarkAchievementsSeenRequest.safeParse(body).success, JSON.stringify(body)).toBe(false);
    }
    const duplicate = MarkAchievementsSeenRequest.safeParse({ codes: ['race_win', 'race_win'] });
    expect(duplicate.error?.issues.map((issue) => [issue.path, issue.message])).toEqual([
      [['codes'], 'INVALID'],
    ]);
  });
});
