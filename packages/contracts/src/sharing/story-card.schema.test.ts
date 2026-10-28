import { describe, expect, it } from 'vitest';

import { MyRaceEntry } from '../results/results.schema.ts';
import { StoryCardQuery, StoryCardStatus } from './story-card.schema.ts';

const TOKEN = 'AbCdEfGhIjKlMnOpQrSt_-';

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
