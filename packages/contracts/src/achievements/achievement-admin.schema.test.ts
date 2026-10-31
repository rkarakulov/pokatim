import { describe, expect, it } from 'vitest';

import {
  AchievementInvalidStateDetails,
  ClearRiderAchievementOverrideRequest,
  ClearRiderAchievementOverrideResult,
  GrantRiderAchievementRequest,
  RevokeRiderAchievementRequest,
  RiderAchievementsAdmin,
} from './achievement-admin.schema.ts';
import {
  ACHIEVEMENT_CODES,
  ACHIEVEMENT_OBJECT_KIND_BY_CODE,
  ACHIEVEMENT_OBJECT_KINDS,
} from './achievement.schema.ts';

const ID = '01890a5d-ac96-774b-bcce-b302099a8057';
const REASON = 'Заезд не засчитался из-за сбоя';

const issues = (result: {
  success: boolean;
  error?: { issues: { path: PropertyKey[]; message: string }[] };
}) =>
  result.success ? [] : result.error!.issues.map((issue) => [issue.path.join('.'), issue.message]);

describe('ACHIEVEMENT_OBJECT_KIND_BY_CODE (achievements-panel)', () => {
  it('полна по каталогу: вид каждого кода — из ACHIEVEMENT_OBJECT_KINDS', () => {
    expect(Object.keys(ACHIEVEMENT_OBJECT_KIND_BY_CODE)).toEqual([...ACHIEVEMENT_CODES]);
    for (const kind of Object.values(ACHIEVEMENT_OBJECT_KIND_BY_CODE)) {
      expect(ACHIEVEMENT_OBJECT_KINDS).toContain(kind);
    }
    expect(ACHIEVEMENT_OBJECT_KIND_BY_CODE.routes_5).toBe('route');
    expect(ACHIEVEMENT_OBJECT_KIND_BY_CODE.season_champion).toBe('season');
  });
});

describe('GrantRiderAchievementRequest', () => {
  it('разовый без уровня, счётный с уровнем и без — валидны', () => {
    expect(
      GrantRiderAchievementRequest.parse({ code: 'race_win', objectId: ID, reason: REASON }),
    ).toEqual({ code: 'race_win', objectId: ID, reason: REASON });
    expect(
      GrantRiderAchievementRequest.parse({
        code: 'rides_10',
        objectId: ID,
        level: 'gold',
        reason: REASON,
      }).level,
    ).toBe('gold');
    expect(
      GrantRiderAchievementRequest.parse({ code: 'season_podium', objectId: ID, reason: REASON }),
    ).toMatchObject({ code: 'season_podium' });
  });

  it('уровень у разового и сезонного — INVALID на level; причина обязательна (3–500); лишние ключи и мусор — ошибка', () => {
    expect(
      issues(
        GrantRiderAchievementRequest.safeParse({
          code: 'race_win',
          objectId: ID,
          level: 'bronze',
          reason: REASON,
        }),
      ),
    ).toEqual([['level', 'INVALID']]);
    expect(
      issues(
        GrantRiderAchievementRequest.safeParse({
          code: 'season_regular',
          objectId: ID,
          level: 'bronze',
          reason: REASON,
        }),
      ),
    ).toEqual([['level', 'INVALID']]);
    expect(
      issues(GrantRiderAchievementRequest.safeParse({ code: 'race_win', objectId: ID })),
    ).toEqual([['reason', 'REQUIRED']]);
    for (const body of [
      { code: 'race_win', objectId: ID, reason: 'ab' },
      { code: 'race_win', objectId: ID, reason: 'x'.repeat(501) },
      { code: 'race_lose', objectId: ID, reason: REASON },
      { code: 'race_win', objectId: 'nope', reason: REASON },
      { code: 'races_5', objectId: ID, level: 'platinum', reason: REASON },
      { code: 'race_win', objectId: ID, reason: REASON, objectKind: 'race' },
      { code: { $ne: null }, objectId: ID, reason: REASON },
    ]) {
      expect(GrantRiderAchievementRequest.safeParse(body).success, JSON.stringify(body)).toBe(
        false,
      );
    }
  });
});

describe('RevokeRiderAchievementRequest / ClearRiderAchievementOverrideRequest', () => {
  it.each([
    ['revoke', RevokeRiderAchievementRequest],
    ['clear', ClearRiderAchievementOverrideRequest],
  ] as const)('%s: seasonId ⇔ сезонный код', (_name, schema) => {
    expect(schema.parse({ code: 'race_win', reason: REASON })).toEqual({
      code: 'race_win',
      reason: REASON,
    });
    expect(schema.parse({ code: 'season_podium', seasonId: ID, reason: REASON }).seasonId).toBe(ID);
    expect(issues(schema.safeParse({ code: 'season_podium', reason: REASON }))).toEqual([
      ['seasonId', 'REQUIRED'],
    ]);
    expect(issues(schema.safeParse({ code: 'race_win', seasonId: ID, reason: REASON }))).toEqual([
      ['seasonId', 'INVALID'],
    ]);
    expect(issues(schema.safeParse({ code: 'race_win' }))).toEqual([['reason', 'REQUIRED']]);
    expect(schema.safeParse({ code: 'race_win', reason: REASON, extra: 1 }).success).toBe(false);
  });

  it('итог снятия и детали 409', () => {
    expect(ClearRiderAchievementOverrideResult.parse({ cleared: true, reconciled: false })).toEqual(
      { cleared: true, reconciled: false },
    );
    expect(AchievementInvalidStateDetails.parse({ reason: 'already_granted' }).reason).toBe(
      'already_granted',
    );
    expect(AchievementInvalidStateDetails.safeParse({ reason: 'other' }).success).toBe(false);
  });
});

describe('RiderAchievementsAdmin', () => {
  const item = {
    code: 'races_5',
    object: { kind: 'race', id: ID, title: null },
    level: 'bronze',
    factDate: '2026-10-01',
    status: 'granted_manually',
    grantedAt: '2026-10-31T10:00:00.000Z',
    revokedAt: null,
    override: {
      decision: 'granted',
      at: '2026-10-31T10:00:00.000Z',
      by: { userId: ID, displayName: 'Ольга' },
    },
    byFacts: { state: 'not_earned', level: null },
  };

  it('строгие enum-ы панели: незнакомый статус, вид, решение — ошибка', () => {
    expect(RiderAchievementsAdmin.parse({ items: [item], seasonsAvailable: true }).items).toEqual([
      item,
    ]);
    for (const patch of [
      { status: 'lost' },
      { object: { kind: 'planet', id: ID, title: null } },
      { override: { ...item.override, decision: 'maybe' } },
      { byFacts: { state: 'maybe', level: null } },
      { factDate: '2026-10-31T10:00:00.000Z' },
    ]) {
      expect(
        RiderAchievementsAdmin.safeParse({ items: [{ ...item, ...patch }], seasonsAvailable: true })
          .success,
        JSON.stringify(patch),
      ).toBe(false);
    }
  });
});
