import { describe, expect, it } from 'vitest';

import type { AchievementNotice, AchievementNotices } from '../achievements';
import type { DisputeNotices } from '../disputes';
import type { RaceRegistry } from '../races';
import type { ResultsNotices } from '../results';
import type { RideNotice, RideNotices } from '../rides';
import type { RiderNameDirectory } from '../profile';
import type { RouteNotices, RoutePublicationNotice } from '../routes';
import type { SocialNotices, SocialReactionNotice } from '../social';
import type { TicketNotices, TicketReminderNotice } from '../tickets';
import { NotificationIntake } from './notification-intake';

const ROUTE = '0190a6f4-0000-7000-8000-000000000001';
const AUTHOR = '0190a6f4-0000-7000-8000-000000000002';
const DECIDED_AT = new Date('2026-10-28T07:00:00.000Z');
const DECIDED = 'routes.publication-decided';

const event = (decision: 'approved' | 'rejected', decidedAt = DECIDED_AT) => ({
  routeId: ROUTE,
  authorUserId: AUTHOR,
  decision,
  decidedAt: decidedAt.toISOString(),
});

/** Intake с портом маршрутов, отдающим `notice`; прочие порты в этих сценариях не вызываются. */
function intakeWith(notice: Partial<RoutePublicationNotice> | null) {
  const routes: RouteNotices = {
    publication: async () =>
      notice && {
        id: ROUTE,
        title: 'Вокруг моря',
        ownerUserId: AUTHOR,
        status: 'approved',
        decidedAt: DECIDED_AT,
        rejectionReason: null,
        ...notice,
      },
  };
  const unused = {} as never;
  return new NotificationIntake(
    unused as ResultsNotices,
    unused as DisputeNotices,
    unused as RideNotices,
    routes,
    unused as RaceRegistry,
    unused as TicketNotices,
    unused as AchievementNotices,
    unused as SocialNotices,
    unused as RiderNameDirectory,
  );
}

const NOW = new Date('2026-10-28T08:00:00.000Z');
/** Id события outbox (uuidv7) на момент `at`: окно «Своих» считается по нему. */
const eventIdAt = (at: Date, tail = '000000000001') =>
  `${at
    .getTime()
    .toString(16)
    .padStart(12, '0')
    .replace(/^(.{8})(.{4})$/, '$1-$2')}-7000-8000-${tail}`;
const EVENT_ID = eventIdAt(NOW);

describe('NotificationIntake: решение по заявке маршрута (routes-06 A6)', () => {
  it('маршрута нет (удалён, не райдера, не подавался) — gone', async () => {
    expect(await intakeWith(null).drafts(DECIDED, event('approved'), NOW, EVENT_ID)).toBe('gone');
  });

  it.each(['pending', 'hidden', 'withdrawn', 'rejected'] as const)(
    'одобрение, а заявка уже %s — state',
    async (status) => {
      expect(await intakeWith({ status }).drafts(DECIDED, event('approved'), NOW, EVENT_ID)).toBe(
        'state',
      );
    },
  );

  it('статус совпал, но решение другое (decidedAt не тот) — state', async () => {
    const later = new Date(DECIDED_AT.getTime() + 1);
    expect(
      await intakeWith({ decidedAt: later }).drafts(DECIDED, event('approved'), NOW, EVENT_ID),
    ).toBe('state');
  });

  it('отклонение без кода причины — state', async () => {
    expect(
      await intakeWith({ status: 'rejected', rejectionReason: null }).drafts(
        DECIDED,
        event('rejected'),
        NOW,
        EVENT_ID,
      ),
    ).toBe('state');
  });

  it('актуальное отклонение — автору, причина кодом, цель — свой маршрут', async () => {
    expect(
      await intakeWith({ status: 'rejected', rejectionReason: 'duplicate' }).drafts(
        DECIDED,
        event('rejected'),
        NOW,
        EVENT_ID,
      ),
    ).toEqual([
      {
        text: { kind: 'route_rejected', route: 'Вокруг моря', reason: 'duplicate' },
        target: { type: 'my-route', routeId: ROUTE },
        collapse: { key: `route:${ROUTE}:publication`, seq: DECIDED_AT.getTime() },
        recipients: [AUTHOR],
      },
    ]);
  });
});

describe('NotificationIntake: напоминание о событии (PR D)', () => {
  const REMINDER = 'tickets.reminder-due';
  const ID = '0190a6f4-0000-7000-8000-000000000003';
  const payload = { kind: 'race', eventId: ID, reminderId: ID, dispatchId: ID };
  const STARTS = new Date('2026-10-29T07:00:00.000Z');

  function intakeWithTickets(result: TicketReminderNotice | 'gone' | 'state') {
    const calls: unknown[][] = [];
    const tickets: TicketNotices = {
      reminder: async (...args) => {
        calls.push(args);
        return result;
      },
    };
    const unused = {} as never;
    const intake = new NotificationIntake(
      unused,
      unused,
      unused,
      unused,
      unused,
      tickets,
      unused,
      unused,
      unused,
    );
    return { intake, calls };
  }

  it('битый payload — invalid_payload; gone/state порта — как есть', async () => {
    expect(
      await intakeWithTickets('gone').intake.drafts(REMINDER, { kind: 'ride' }, NOW, EVENT_ID),
    ).toBe('invalid_payload');
    expect(await intakeWithTickets('gone').intake.drafts(REMINDER, payload, NOW, EVENT_ID)).toBe(
      'gone',
    );
    expect(await intakeWithTickets('state').intake.drafts(REMINDER, payload, NOW, EVENT_ID)).toBe(
      'state',
    );
  });

  it('один черновик: текст правила, цель — свой билет у каждого получателя', async () => {
    const { intake, calls } = intakeWithTickets({
      event: { title: 'Гонка', startsAt: STARTS, place: 'Парк' },
      text: 'Паспорт',
      recipients: [
        { userId: AUTHOR, code: '7XK2M9PQRT' },
        { userId: ROUTE, code: 'ABCDE12345' },
      ],
    });
    expect(await intake.drafts(REMINDER, payload, NOW, EVENT_ID)).toEqual([
      {
        text: {
          kind: 'event_reminder',
          event: 'Гонка',
          startsAt: STARTS,
          place: 'Парк',
          text: 'Паспорт',
        },
        target: null,
        targets: new Map([
          [AUTHOR, { type: 'ticket', code: '7XK2M9PQRT' }],
          [ROUTE, { type: 'ticket', code: 'ABCDE12345' }],
        ]),
        recipients: [AUTHOR, ROUTE],
      },
    ]);
    expect(calls).toEqual([[payload, NOW]]);
  });
});

describe('NotificationIntake: сброс поля профиля (profile-moderation-followups, RC-F3 — без порта)', () => {
  const RESET = 'profile.field-reset';
  const USER = '0190a6f4-0000-7000-8000-000000000003';
  const AT = '2026-10-30T09:00:00.000Z';
  const payload = (field: string, avatarBlockedUntil: string | null = null) => ({
    userId: USER,
    field,
    resetAt: AT,
    seq: 7,
    avatarBlockedUntil,
  });

  it.each([
    ['name', { kind: 'profile_name_reset' }],
    ['club', { kind: 'profile_club_reset' }],
    ['avatar', { kind: 'profile_avatar_reset', blockedUntil: null }],
  ] as const)(
    '%s — самому райдеру, цель — свой профиль, схлопывание по полю',
    async (field, text) => {
      expect(await intakeWith(null).drafts(RESET, payload(field), NOW, EVENT_ID)).toEqual([
        {
          text,
          target: { type: 'profile-edit' },
          collapse: { key: `profile:${USER}:${field}`, seq: 7 },
          recipients: [USER],
        },
      ]);
    },
  );

  it('фото с запретом — срок в тексте', async () => {
    const until = '2026-11-29T09:00:00.000Z';
    const drafts = await intakeWith(null).drafts(RESET, payload('avatar', until), NOW, EVENT_ID);
    expect(drafts).toMatchObject([
      { text: { kind: 'profile_avatar_reset', blockedUntil: new Date(until) } },
    ]);
  });

  it.each([
    ['поле вне справочника', payload('theme')],
    ['лишний ключ (причина модератора)', { ...payload('name'), reason: 'мат' }],
    ['нет avatarBlockedUntil', { userId: USER, field: 'name', resetAt: AT, seq: 7 }],
    // ревью pass 2: порядок — только ревизия сбросов профиля; событие без неё не схлопывается «по времени»
    ['нет seq', { userId: USER, field: 'name', resetAt: AT, avatarBlockedUntil: null }],
    ['seq не положительный', { ...payload('name'), seq: 0 }],
    ['битый userId', { ...payload('name'), userId: 'x' }],
  ])('%s — invalid_payload', async (_name, bad) => {
    expect(await intakeWith(null).drafts(RESET, bad, NOW, EVENT_ID)).toBe('invalid_payload');
  });
});

describe('NotificationIntake: новое достижение (achievements-push, 5.B)', () => {
  const GRANTED = 'achievements.grant-noticed';
  const GRANT = '0190a6f4-0000-7000-8000-000000000011';
  const RIDER = '0190a6f4-0000-7000-8000-000000000012';
  const SEASON = '0190a6f4-0000-7000-8000-000000000013';
  const payload = (overrides: Record<string, unknown> = {}) => ({
    grant: 'fact',
    grantId: GRANT,
    level: 2,
    origin: 'server',
    ...overrides,
  });

  function intakeWithAchievements(result: AchievementNotice | 'gone' | 'state') {
    const achievements: AchievementNotices = { notice: async () => result };
    const unused = {} as never;
    return new NotificationIntake(
      unused,
      unused,
      unused,
      unused,
      unused,
      unused,
      achievements,
      unused,
      unused,
    );
  }
  const notice: AchievementNotice = {
    userId: RIDER,
    code: 'races_5',
    level: 2,
    object: { kind: 'race', title: 'Гран-при' },
    seasonId: null,
  };

  it('битый payload — invalid_payload; gone/state порта — как есть', async () => {
    const intake = intakeWithAchievements(notice);
    for (const bad of [
      {},
      payload({ origin: 'panel' }),
      payload({ level: 4 }),
      payload({ grantId: 'x' }),
    ]) {
      expect(await intake.drafts(GRANTED, bad, NOW, EVENT_ID)).toBe('invalid_payload');
    }
    expect(await intakeWithAchievements('gone').drafts(GRANTED, payload(), NOW, EVENT_ID)).toBe(
      'gone',
    );
    expect(await intakeWithAchievements('state').drafts(GRANTED, payload(), NOW, EVENT_ID)).toBe(
      'state',
    );
  });

  it('владельцу выдачи: текст, цель achievement, схлопывание по выдаче и рангу; server — с push', async () => {
    expect(await intakeWithAchievements(notice).drafts(GRANTED, payload(), NOW, EVENT_ID)).toEqual([
      {
        text: {
          kind: 'achievement_granted',
          code: 'races_5',
          level: 2,
          objectKind: 'race',
          objectTitle: 'Гран-при',
        },
        target: { type: 'achievement', code: 'races_5' },
        collapse: { key: `achievement:${GRANT}`, seq: 2 },
        recipients: [RIDER],
        inApp: false,
      },
    ]);
  });

  it('read — в центр без push (inApp); сезонное — цель с seasonId, ранг схлопывания 1', async () => {
    const seasonal: AchievementNotice = {
      userId: RIDER,
      code: 'season_champion',
      level: null,
      object: { kind: 'season', title: 'Сезон 2026' },
      seasonId: SEASON,
    };
    const [draft] = (await intakeWithAchievements(seasonal).drafts(
      GRANTED,
      payload({ grant: 'season', level: null, origin: 'read' }),
      NOW,
      EVENT_ID,
    )) as Exclude<Awaited<ReturnType<NotificationIntake['drafts']>>, string>;
    expect(draft).toMatchObject({
      target: { type: 'achievement', code: 'season_champion', seasonId: SEASON },
      collapse: { key: `achievement:${GRANT}`, seq: 1 },
      inApp: true,
    });
  });
});

describe('NotificationIntake: фото райда удалено модератором (ride-photo-followups AC4)', () => {
  const RESET = 'rides.photo-reset';
  const RIDE_ID = '0190a6f4-0000-7000-8000-000000000010';
  const ORGANIZER = '0190a6f4-0000-7000-8000-000000000011';
  const PARTICIPANT = '0190a6f4-0000-7000-8000-000000000012';
  const notice = (overrides: Partial<RideNotice> = {}): RideNotice => ({
    id: RIDE_ID,
    title: 'Кофе-райд',
    startsAt: new Date(NOW.getTime() + 86_400_000),
    status: 'published',
    organizerUserId: ORGANIZER,
    goingCount: 2,
    participants: [{ userId: PARTICIPANT, seq: 1 }],
    ...overrides,
  });
  function intakeWithRide(ride: RideNotice | null) {
    const rides: RideNotices = {
      ride: async (id) => (id === RIDE_ID ? ride : null),
      resolvedReporters: async () => [],
    };
    const unused = {} as never;
    return new NotificationIntake(
      unused,
      unused,
      rides,
      unused,
      unused,
      unused,
      unused,
      unused,
      unused,
    );
  }

  it('организатору (не участникам): цель — райд, схлопывание по райду и seq; будущий опубликованный — canReplace', async () => {
    expect(
      await intakeWithRide(notice()).drafts(RESET, { rideId: RIDE_ID, seq: 5 }, NOW, EVENT_ID),
    ).toEqual([
      {
        text: { kind: 'ride_photo_reset', ride: 'Кофе-райд', canReplace: true },
        target: { type: 'ride', rideId: RIDE_ID },
        collapse: { key: `ride:${RIDE_ID}:photo-reset`, seq: 5 },
        recipients: [ORGANIZER],
      },
    ]);
  });

  it.each([
    ['начался', notice({ startsAt: NOW })],
    ['прошёл', notice({ startsAt: new Date(NOW.getTime() - 3_600_000) })],
    ['отменён', notice({ status: 'cancelled' })],
    ['скрыт', notice({ status: 'hidden' })],
  ])('%s — без призыва (canReplace false), статус не фильтрует', async (_name, ride) => {
    expect(
      await intakeWithRide(ride).drafts(RESET, { rideId: RIDE_ID, seq: 2 }, NOW, EVENT_ID),
    ).toMatchObject([
      {
        text: { kind: 'ride_photo_reset', canReplace: false },
        target: { type: 'ride', rideId: RIDE_ID },
        recipients: [ORGANIZER],
      },
    ]);
  });

  it('райда нет — gone', async () => {
    expect(
      await intakeWithRide(null).drafts(RESET, { rideId: RIDE_ID, seq: 1 }, NOW, EVENT_ID),
    ).toBe('gone');
  });

  it.each([
    ['нет seq', { rideId: RIDE_ID }],
    ['seq 0', { rideId: RIDE_ID, seq: 0 }],
    ['битый rideId', { rideId: 'x', seq: 1 }],
    ['лишний ключ', { rideId: RIDE_ID, seq: 1, photoId: 'a'.repeat(43) }],
  ])('%s — invalid_payload', async (_name, bad) => {
    expect(await intakeWithRide(notice()).drafts(RESET, bad, NOW, EVENT_ID)).toBe(
      'invalid_payload',
    );
  });
});

describe('NotificationIntake: «Свои» K10 (social-p7)', () => {
  const RIDE = '0190a6f4-0000-7000-8000-000000000021';
  const ORG = '0190a6f4-0000-7000-8000-000000000022';
  const JOINER = '0190a6f4-0000-7000-8000-000000000023';
  const GOING = '0190a6f4-0000-7000-8000-000000000024';
  const FRIEND = '0190a6f4-0000-7000-8000-000000000025';
  const OTHER = '0190a6f4-0000-7000-8000-000000000026';
  const REACTION = '0190a6f4-0000-7000-8000-000000000027';
  const ENTRY = '0190a6f4-0000-7000-8000-000000000028';
  const RACE = '0190a6f4-0000-7000-8000-000000000029';
  const ROUTE_ID = '0190a6f4-0000-7000-8000-00000000002a';

  const rideNotice = (overrides: Partial<RideNotice> = {}): RideNotice => ({
    id: RIDE,
    title: 'Кофе-райд',
    startsAt: NOW,
    status: 'published',
    organizerUserId: ORG,
    goingCount: 3,
    participants: [
      { userId: GOING, seq: 1 },
      { userId: JOINER, seq: 2 },
    ],
    ...overrides,
  });

  interface Setup {
    ride?: RideNotice | null;
    reaction?: SocialReactionNotice | null;
    audience?: readonly string[];
    connected?: boolean;
    publicIds?: readonly string[];
    entryRace?: string | null;
    raceTitle?: string | null;
    route?: RoutePublicationNotice | null;
  }

  function socialIntake(setup: Setup = {}) {
    const rides = {
      ride: async () => (setup.ride === undefined ? rideNotice() : setup.ride),
    } as unknown as RideNotices;
    const results = { entryRace: async () => setup.entryRace ?? null } as unknown as ResultsNotices;
    const races = {
      get: async () => (setup.raceTitle ? { title: setup.raceTitle } : null),
    } as unknown as RaceRegistry;
    const routes = { publication: async () => setup.route ?? null } as unknown as RouteNotices;
    const social: SocialNotices = {
      reaction: async () => setup.reaction ?? null,
      goingAudience: async () => [...(setup.audience ?? [])],
      connected: async () => setup.connected ?? true,
    };
    const names = {
      publicRiders: async (ids: readonly string[]) =>
        new Map(
          ids
            .filter((id) => (setup.publicIds ?? [JOINER]).includes(id))
            .map((id) => [id, { name: 'Катя', publicId: null, avatarId: null }]),
        ),
    } as unknown as RiderNameDirectory;
    const unused = {} as never;
    return new NotificationIntake(
      results,
      unused,
      rides,
      routes,
      races,
      unused,
      unused,
      social,
      names,
    );
  }

  describe('«Свои идут» в rides.participant-joined', () => {
    const JOINED = 'rides.participant-joined';
    const going = (drafts: unknown) =>
      (drafts as { text: { kind: string } }[]).filter(
        (draft) => draft.text.kind === 'social_riders_going',
      );

    it('аудитория без организатора, участников и самого записавшегося; лицо — записавшийся, окно — райд', async () => {
      const drafts = await socialIntake({
        audience: [FRIEND, ORG, GOING, JOINER, OTHER],
      }).drafts(JOINED, { rideId: RIDE, seq: 2 }, NOW, EVENT_ID);
      expect(drafts).toHaveLength(2);
      expect(going(drafts)).toEqual([
        {
          text: { kind: 'social_riders_going', object: 'Кофе-райд' },
          target: { type: 'ride', rideId: RIDE },
          collapse: { key: `social:going:${RIDE}` },
          actor: JOINER,
          recipients: [FRIEND, OTHER],
        },
      ]);
    });

    it.each([
      ['событие без seq', { rideId: RIDE }, {}],
      ['участник уже вышел (seq не найден)', { rideId: RIDE, seq: 9 }, {}],
      ['записавшийся непубличный', { rideId: RIDE, seq: 2 }, { publicIds: [] }],
      ['аудитория пуста после исключений', { rideId: RIDE, seq: 2 }, { audience: [ORG, GOING] }],
    ] as const)('%s — только «Новый участник»', async (_name, payload, setup) => {
      const drafts = await socialIntake({ audience: [FRIEND], ...setup }).drafts(
        JOINED,
        payload,
        NOW,
        EVENT_ID,
      );
      expect(going(drafts)).toEqual([]);
      expect(drafts).toMatchObject([{ text: { kind: 'ride_joined' }, recipients: [ORG] }]);
    });
  });

  describe('social.reaction-created', () => {
    const CREATED = 'social.reaction-created';
    const payload = { reactionId: REACTION };
    const thanks: SocialReactionNotice = {
      kind: 'thanks',
      actorId: FRIEND,
      recipientId: OTHER,
      targetType: 'ride_rider',
      targetId: RIDE,
    };

    it('битый payload — invalid_payload; реакция снята — gone', async () => {
      expect(await socialIntake().drafts(CREATED, { reactionId: 'x' }, NOW, EVENT_ID)).toBe(
        'invalid_payload',
      );
      expect(await socialIntake({ reaction: null }).drafts(CREATED, payload, NOW, EVENT_ID)).toBe(
        'gone',
      );
    });

    it('«Спасибо»: получателю, окно — райд; райда нет — gone, не опубликован — state', async () => {
      expect(
        await socialIntake({ reaction: thanks }).drafts(CREATED, payload, NOW, EVENT_ID),
      ).toEqual([
        {
          text: { kind: 'social_thanks', object: 'Кофе-райд' },
          target: { type: 'ride', rideId: RIDE },
          collapse: { key: `social:thanks:${RIDE}` },
          actor: FRIEND,
          recipients: [OTHER],
        },
      ]);
      expect(
        await socialIntake({ reaction: thanks, ride: null }).drafts(
          CREATED,
          payload,
          NOW,
          EVENT_ID,
        ),
      ).toBe('gone');
      for (const status of ['hidden', 'cancelled'] as const) {
        expect(
          await socialIntake({ reaction: thanks, ride: rideNotice({ status }) }).drafts(
            CREATED,
            payload,
            NOW,
            EVENT_ID,
          ),
        ).toBe('state');
      }
    });

    it('«Респект» строке результата: гонка заявки, окно — гонка в сутки; гонки нет — gone', async () => {
      const respect: SocialReactionNotice = {
        kind: 'respect',
        actorId: FRIEND,
        recipientId: OTHER,
        targetType: 'race_entry',
        targetId: ENTRY,
      };
      expect(
        await socialIntake({ reaction: respect, entryRace: RACE, raceTitle: 'Гран-при' }).drafts(
          CREATED,
          payload,
          NOW,
          EVENT_ID,
        ),
      ).toEqual([
        {
          text: { kind: 'social_respect', object: 'Гран-при' },
          target: { type: 'race', raceId: RACE },
          collapse: { key: `social:respect:race:${RACE}:2026-10-28` },
          actor: FRIEND,
          recipients: [OTHER],
        },
      ]);
      expect(
        await socialIntake({ reaction: respect, entryRace: null }).drafts(
          CREATED,
          payload,
          NOW,
          EVENT_ID,
        ),
      ).toBe('gone');
    });

    it('«Респект» маршруту: автору, цель — свой маршрут; маршрута нет — gone', async () => {
      const respect: SocialReactionNotice = {
        kind: 'respect',
        actorId: FRIEND,
        recipientId: OTHER,
        targetType: 'route',
        targetId: ROUTE_ID,
      };
      const route: RoutePublicationNotice = {
        id: ROUTE_ID,
        title: 'Вокруг моря',
        ownerUserId: OTHER,
        status: 'approved',
        decidedAt: NOW,
        rejectionReason: null,
      };
      expect(
        await socialIntake({ reaction: respect, route }).drafts(CREATED, payload, NOW, EVENT_ID),
      ).toMatchObject([
        {
          text: { kind: 'social_respect', object: 'Вокруг моря' },
          target: { type: 'my-route', routeId: ROUTE_ID },
          recipients: [OTHER],
        },
      ]);
      expect(
        await socialIntake({ reaction: respect }).drafts(CREATED, payload, NOW, EVENT_ID),
      ).toBe('gone');
    });
  });

  it('social.connection-added: добавленному, окно — сутки; связь убрана к приёму — state', async () => {
    const ADDED = 'social.connection-added';
    const payload = { ownerId: FRIEND, otherId: OTHER };
    expect(await socialIntake().drafts(ADDED, payload, NOW, EVENT_ID)).toEqual([
      {
        text: { kind: 'social_added' },
        target: null,
        collapse: { key: 'social:added:2026-10-28' },
        actor: FRIEND,
        recipients: [OTHER],
      },
    ]);
    expect(await socialIntake({ connected: false }).drafts(ADDED, payload, NOW, EVENT_ID)).toBe(
      'state',
    );
    expect(await socialIntake().drafts(ADDED, { ownerId: FRIEND }, NOW, EVENT_ID)).toBe(
      'invalid_payload',
    );
  });

  it('social.invite-registered: пригласившему, лицо — приглашённый', async () => {
    const INVITE = 'social.invite-registered';
    expect(
      await socialIntake().drafts(INVITE, { inviterId: FRIEND, inviteeId: OTHER }, NOW, EVENT_ID),
    ).toEqual([
      {
        text: { kind: 'social_invite_registered' },
        target: null,
        collapse: { key: 'social:invite:2026-10-28' },
        actor: OTHER,
        recipients: [FRIEND],
      },
    ]);
    expect(await socialIntake().drafts(INVITE, { inviterId: FRIEND }, NOW, EVENT_ID)).toBe(
      'invalid_payload',
    );
  });

  it('social.ride-ask-due: адресаты из payload, без лица; райд не опубликован — state, нет — gone', async () => {
    const ASK = 'social.ride-ask-due';
    const payload = { rideId: RIDE, userIds: [GOING, JOINER] };
    expect(await socialIntake().drafts(ASK, payload, NOW, EVENT_ID)).toEqual([
      {
        text: { kind: 'social_ride_ask', object: 'Кофе-райд' },
        target: { type: 'ride', rideId: RIDE },
        collapse: { key: `social:ask:${RIDE}`, seq: 1 },
        recipients: [GOING, JOINER],
      },
    ]);
    expect(
      await socialIntake({ ride: rideNotice({ status: 'cancelled' }) }).drafts(
        ASK,
        payload,
        NOW,
        EVENT_ID,
      ),
    ).toBe('state');
    expect(await socialIntake({ ride: null }).drafts(ASK, payload, NOW, EVENT_ID)).toBe('gone');
    expect(await socialIntake().drafts(ASK, { rideId: RIDE, userIds: [] }, NOW, EVENT_ID)).toBe(
      'invalid_payload',
    );
  });
});
