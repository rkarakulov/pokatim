import { describe, expect, it } from 'vitest';

import { MyRaceEntry } from '../results/results.schema.ts';
import { AchievementStoryCardQuery, StoryCardQuery, StoryCardStatus } from './story-card.schema.ts';

const TOKEN = 'AbCdEfGhIjKlMnOpQrSt_-';
const SEASON = '0190a6f4-0000-7000-8000-000000000301';

describe('StoryCardQuery', () => {
  it('шаблон line / night', () => {
    expect(StoryCardQuery.parse({ template: 'line' })).toEqual({ template: 'line' });
    expect(StoryCardQuery.parse({ template: 'night' })).toEqual({ template: 'night' });
  });

  it('нет шаблона, незнакомый, лишний ключ — ошибка', () => {
    expect(StoryCardQuery.safeParse({}).success).toBe(false);
    expect(StoryCardQuery.safeParse({ template: 'foo' }).success).toBe(false);
    expect(StoryCardQuery.safeParse({ template: 'line', theme: 'chrono' }).success).toBe(false);
  });

  it('`seasonId` — только у карточки достижения', () => {
    expect(StoryCardQuery.safeParse({ template: 'line', seasonId: SEASON }).success).toBe(false);
  });
});

describe('AchievementStoryCardQuery', () => {
  it('шаблон; шаблон и сезон', () => {
    expect(AchievementStoryCardQuery.parse({ template: 'night' })).toEqual({ template: 'night' });
    expect(AchievementStoryCardQuery.parse({ template: 'line', seasonId: SEASON })).toEqual({
      template: 'line',
      seasonId: SEASON,
    });
  });

  it('кривой UUID, лишний ключ, без шаблона — ошибка', () => {
    expect(AchievementStoryCardQuery.safeParse({ template: 'line', seasonId: 'x' }).success).toBe(
      false,
    );
    expect(
      AchievementStoryCardQuery.safeParse({ template: 'line', seasonId: SEASON, userId: 'x' })
        .success,
    ).toBe(false);
    expect(AchievementStoryCardQuery.safeParse({ seasonId: SEASON }).success).toBe(false);
  });
});

describe('StoryCardStatus', () => {
  it('pending, ready с токеном, failed', () => {
    expect(StoryCardStatus.parse({ status: 'pending' })).toEqual({ status: 'pending' });
    expect(StoryCardStatus.parse({ status: 'ready', token: TOKEN })).toEqual({
      status: 'ready',
      token: TOKEN,
    });
    expect(StoryCardStatus.parse({ status: 'failed' })).toEqual({ status: 'failed' });
  });

  it('ready без токена, кривой токен, незнакомый статус — ошибка', () => {
    expect(StoryCardStatus.safeParse({ status: 'ready' }).success).toBe(false);
    expect(StoryCardStatus.safeParse({ status: 'ready', token: 'short' }).success).toBe(false);
    expect(
      StoryCardStatus.safeParse({ status: 'ready', token: `${TOKEN.slice(1)}=` }).success,
    ).toBe(false);
    expect(StoryCardStatus.safeParse({ status: 'gone' }).success).toBe(false);
  });
});

describe('MyRaceEntry.actions.canShareStory', () => {
  it('старый сервер без поля — false', () => {
    const entry = MyRaceEntry.parse({
      raceId: '01890a5d-ac96-774b-bcce-b302099a8057',
      entry: null,
      result: {
        status: 'none',
        elapsedSec: null,
        place: null,
        tied: false,
        ranked: 0,
        group: 'overall',
      },
      attempts: [],
      pendingUploads: [],
      uploadClosesAt: '2026-10-27T10:00:00.000Z',
      actions: { canEnter: true, canWithdraw: false, canAddAttempt: false, reasons: [] },
    });
    expect(entry.actions.canShareStory).toBe(false);
  });
});
