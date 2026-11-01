import { describe, expect, it } from 'vitest';

import type { PublicRiderCard } from '../profile';
import type { SocialRideFacts } from '../rides';
import { rideParticipantsView } from './ride-participants.view';
import type { AttendanceEntry } from './social.collection';

const START = new Date('2026-10-20T08:00:00.000Z');
const DAY = 86_400_000;
const at = (offsetMs: number) => new Date(START.getTime() + offsetMs);
const HOUR_AFTER = at(3_600_000);

const facts = (overrides: Partial<SocialRideFacts> = {}): SocialRideFacts => ({
  rideId: 'ride-1',
  phase: 'past',
  startsAt: START,
  organizerUserId: 'org',
  participantIds: ['org', 'p1', 'p2', 'p3'],
  preciseStart: null,
  ...overrides,
});

const cards = new Map<string, PublicRiderCard>([
  ['org', { name: 'Организатор', publicId: 'pub-org', avatarId: 'av-org' }],
  ['p2', { name: 'Петя', publicId: null, avatarId: null }],
  ['p3', { name: 'Вера', publicId: 'pub-p3', avatarId: null }],
]);

const entry = (userId: string, declined = false): AttendanceEntry => ({
  userId,
  via: 'manual',
  at: START,
  declinedAt: declined ? START : null,
});

describe('rideParticipantsView — участники (K3, K4)', () => {
  it('организатор первым; публичные строками, непубличные — числом; строки без userId', () => {
    const view = rideParticipantsView(facts(), [], cards, 'outsider', HOUR_AFTER);
    expect(view.riders).toEqual([
      { name: 'Организатор', publicId: 'pub-org', avatar: { id: 'av-org' } },
      { name: 'Петя', publicId: null, avatar: null },
      { name: 'Вера', publicId: 'pub-p3', avatar: null },
    ]);
    expect(view.hiddenCount).toBe(1);
    for (const row of view.riders)
      expect(Object.keys(row).sort()).toEqual(['avatar', 'name', 'publicId']);
    expect(JSON.stringify(view)).not.toContain('userId');
  });

  it('не участник — attendance: null', () => {
    expect(
      rideParticipantsView(facts(), [entry('p1')], cards, 'outsider', HOUR_AFTER).attendance,
    ).toBe(null);
  });
});

describe('rideParticipantsView — явка зрителя (K5, RC-3)', () => {
  it('none — обе кнопки; attended — только «Меня не было»; declined — только «Я был»', () => {
    const none = rideParticipantsView(facts(), [], cards, 'p1', HOUR_AFTER).attendance;
    expect(none).toEqual({
      state: 'none',
      canMark: true,
      canDecline: true,
      attended: null,
      allThanked: false,
    });

    const attended = rideParticipantsView(
      facts(),
      [entry('p1')],
      cards,
      'p1',
      HOUR_AFTER,
    ).attendance;
    expect(attended).toMatchObject({ state: 'attended', canMark: false, canDecline: true });

    const declined = rideParticipantsView(
      facts(),
      [entry('p1', true)],
      cards,
      'p1',
      HOUR_AFTER,
    ).attendance;
    expect(declined).toEqual({
      state: 'declined',
      canMark: true,
      canDecline: false,
      attended: null,
      allThanked: false,
    });
  });

  it('окно: старт −1 мс — false; старт и +7 дн — true; +7 дн +1 мс — false', () => {
    const flags = (now: Date, phase: SocialRideFacts['phase'] = 'past') => {
      const attendance = rideParticipantsView(facts({ phase }), [], cards, 'p1', now).attendance;
      return [attendance?.canMark, attendance?.canDecline];
    };
    expect(flags(at(-1), 'upcoming')).toEqual([false, false]);
    expect(flags(at(0))).toEqual([true, true]);
    expect(flags(at(7 * DAY))).toEqual([true, true]);
    expect(flags(at(7 * DAY + 1))).toEqual([false, false]);
  });

  it('cancelled и hidden — флаги false', () => {
    for (const phase of ['cancelled', 'hidden'] as const) {
      const attendance = rideParticipantsView(
        facts({ phase }),
        [entry('p1')],
        cards,
        'p1',
        HOUR_AFTER,
      ).attendance;
      expect(attendance).toMatchObject({ state: 'attended', canMark: false, canDecline: false });
    }
  });

  it('«Ехали N»: порядок участников, не записей явки; непубличные — числом; «не был» не считается', () => {
    const view = rideParticipantsView(
      facts(),
      [entry('p3'), entry('p1'), entry('org'), entry('p2', true)],
      cards,
      'p1',
      HOUR_AFTER,
    );
    expect(view.attendance?.attended).toEqual({
      riders: [
        {
          name: 'Организатор',
          publicId: 'pub-org',
          avatar: { id: 'av-org' },
          self: false,
          thanked: false,
        },
        { name: 'Вера', publicId: 'pub-p3', avatar: null, self: false, thanked: false },
      ],
      hiddenCount: 1,
    });
  });

  it('«Ехали N» — только при явке зрителя', () => {
    const view = rideParticipantsView(
      facts(),
      [entry('org'), entry('p3')],
      cards,
      'p1',
      HOUR_AFTER,
    );
    expect(view.attendance?.attended).toBe(null);
  });
});

describe('rideParticipantsView — «Спасибо за компанию» (P4, K5, RC-P4-7, RC-P4-8)', () => {
  const present = [entry('org'), entry('p1'), entry('p2'), entry('p3')];

  it('своя строка — `self`; поблагодарённые — `thanked`; список участников без флагов', () => {
    const view = rideParticipantsView(facts(), present, cards, 'org', HOUR_AFTER, new Set(['p3']));
    expect(view.attendance?.attended?.riders).toEqual([
      {
        name: 'Организатор',
        publicId: 'pub-org',
        avatar: { id: 'av-org' },
        self: true,
        thanked: false,
      },
      { name: 'Петя', publicId: null, avatar: null, self: false, thanked: false },
      { name: 'Вера', publicId: 'pub-p3', avatar: null, self: false, thanked: true },
    ]);
    for (const row of view.riders)
      expect(Object.keys(row).sort()).toEqual(['avatar', 'name', 'publicId']);
    expect(JSON.stringify(view)).not.toContain('userId');
  });

  it('allThanked — все явившиеся, кроме себя, включая скрытых; скрытый не поблагодарён — false', () => {
    const notHidden = rideParticipantsView(
      facts(),
      present,
      cards,
      'org',
      HOUR_AFTER,
      new Set(['p2', 'p3']),
    );
    expect(notHidden.attendance?.allThanked).toBe(false);
    const all = rideParticipantsView(
      facts(),
      present,
      cards,
      'org',
      HOUR_AFTER,
      new Set(['p1', 'p2', 'p3']),
    );
    expect(all.attendance?.allThanked).toBe(true);
  });

  it('allThanked — только зритель явился — true; не явился — false', () => {
    const alone = rideParticipantsView(facts(), [entry('p1')], cards, 'p1', HOUR_AFTER);
    expect(alone.attendance).toMatchObject({ state: 'attended', allThanked: true });
    const absent = rideParticipantsView(facts(), [entry('org')], cards, 'p1', HOUR_AFTER);
    expect(absent.attendance?.allThanked).toBe(false);
  });

  it('явка вне списка участников (ушёл из «Иду») не входит в «Ехали» и в allThanked', () => {
    const view = rideParticipantsView(
      facts({ participantIds: ['org', 'p1'] }),
      [entry('org'), entry('p1'), entry('gone')],
      cards,
      'p1',
      HOUR_AFTER,
      new Set(['org']),
    );
    expect(view.attendance?.allThanked).toBe(true);
  });
});
