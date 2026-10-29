import { describe, expect, it } from 'vitest';

import {
  Achievement,
  ACHIEVEMENT_CODES,
  ACHIEVEMENT_OBJECT_KINDS,
  AchievementList,
  MarkAchievementsSeenRequest,
  PublicRiderAchievementList,
} from './achievement.schema.ts';

const ID = '01890a5d-ac96-774b-bcce-b302099a8057';
const item = {
  code: 'race_win',
  object: { kind: 'race', id: ID, title: 'Гонка' },
  factDate: '2026-06-01',
  seen: false,
};

describe('достижения (achievements)', () => {
  it('каталог v1 — 9 кодов в установленном порядке (только в конец); виды объекта', () => {
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
    ]);
    expect(ACHIEVEMENT_OBJECT_KINDS).toEqual(['race', 'route', 'ride']);
  });

  it('Achievement: известные значения как есть; незнакомый код и вид — `unknown` (RC-8)', () => {
    expect(AchievementList.parse({ items: [item] })).toEqual({ items: [item] });
    expect(
      Achievement.parse({ ...item, code: 'season_win', object: { ...item.object, kind: 'club' } }),
    ).toEqual({ ...item, code: 'unknown', object: { ...item.object, kind: 'unknown' } });
  });

  it('Achievement: дата — только `YYYY-MM-DD` (без времени суток, RC-7)', () => {
    expect(Achievement.safeParse({ ...item, factDate: '2026-06-01T08:00:00Z' }).success).toBe(
      false,
    );
  });

  it('PublicRiderAchievementList: без `seen`', () => {
    const publicItem = { code: item.code, object: item.object, factDate: item.factDate };
    expect(PublicRiderAchievementList.parse({ items: [{ ...publicItem, seen: true }] })).toEqual({
      items: [publicItem],
    });
  });

  it('MarkAchievementsSeenRequest: 1–9 известных кодов без повторов; иначе — ошибка', () => {
    expect(MarkAchievementsSeenRequest.parse({ codes: ['race_win'] })).toEqual({
      codes: ['race_win'],
    });
    expect(MarkAchievementsSeenRequest.parse({ codes: [...ACHIEVEMENT_CODES] }).codes).toHaveLength(
      9,
    );
    const invalid = [
      { codes: [] },
      { codes: [...ACHIEVEMENT_CODES, 'race_win'] },
      { codes: ['race_win', 'race_win'] },
      { codes: ['season_win'] },
      { codes: ['race_win'], extra: 1 },
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
