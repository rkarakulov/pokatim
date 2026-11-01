import { uuidv7 } from '@rkarakulov/api-kit/mongo';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { createHarness, DAY, type Harness } from '../../../test/harness';
import {
  appendEvent,
  eventsOfType,
  notificationsIntake,
  notificationsOf,
  runIntake,
} from '../../../test/notifications';
import { publicRider } from '../../../test/profiles';
import { resultsDb } from '../../../test/results';
import { seedApprovedRiderRoute } from '../../../test/routes';
import { createRide, join, type Rider, rider } from '../../../test/rides';
import { pastRide, socialDb, socialServices } from '../../../test/social';
import { seedProtocolRace, seedSeason } from '../../../test/standings';
import { RIDES_PARTICIPANT_JOINED } from '../rides';
import {
  SOCIAL_INVITE_REGISTERED,
  SOCIAL_REACTION_CREATED,
  type SocialReactionCreated,
} from './social.events';

/**
 * Уведомления «Свои» K10 сквозь outbox (P7, AC3, AC5): действие пишет `social.*` (или `rides.participant-joined`) в
 * транзакции → задача `notifications-intake` (процессор worker напрямую) → документы центра. Повтор задачи с тем же id
 * события — без дублей; накопление лиц — окна P1.
 */
let h: Harness;
beforeAll(async () => {
  h = await createHarness();
});
beforeEach(async () => {
  await h.reset();
});
afterAll(async () => {
  await h.close();
});

const kindsOf = async (who: Rider) => (await notificationsOf(h, who.userId)).map((doc) => doc.kind);

/** Связь `owner → other` прямой вставкой (источник `manual`); `removed` — надгробие. */
async function connect(owner: Rider, other: Rider, { removed = false } = {}) {
  const now = h.clock.now();
  await socialDb(h).connections.insertOne({
    _id: uuidv7(),
    ownerId: owner.userId,
    otherId: other.userId,
    rides: [],
    rideCount: 0,
    lastRideAt: null,
    inviteAt: null,
    manualAt: removed ? null : now,
    removedAt: removed ? now : null,
    createdAt: now,
    updatedAt: now,
  });
}
const mutual = async (a: Rider, b: Rider) => {
  await connect(a, b);
  await connect(b, a);
};

describe('«Свои идут» (AC5)', () => {
  it('аудитория — взаимные «свои» записавшегося без идущих, организатора, убранных и односторонних', async () => {
    const org = await rider(h, 'org@example.by');
    const joiner = await publicRider(h, 'joiner@example.by', 'Катя Л.');
    const friend = await rider(h, 'friend@example.by');
    const going = await rider(h, 'going@example.by');
    const removed = await rider(h, 'removed@example.by');
    const oneWay = await rider(h, 'oneway@example.by');
    await mutual(friend, joiner);
    await mutual(going, joiner);
    await mutual(org, joiner);
    // записавшийся убрал связь к `removed` — не взаимная
    await connect(removed, joiner);
    await connect(joiner, removed, { removed: true });
    // ручное «В свои» без обратной (RC-P7-1a)
    await connect(oneWay, joiner);
    const ride = await createRide(h, org, { limit: null });
    expect((await join(h, going, ride.id)).status).toBe(200);
    expect((await join(h, joiner, ride.id)).status).toBe(200);

    const intake = notificationsIntake(h);
    await intake.drain();
    expect(await kindsOf(friend)).toEqual(['social_riders_going']);
    for (const who of [going, removed, oneWay, joiner]) expect(await kindsOf(who)).toEqual([]);
    // организатор — только «Новый участник» (два входа — одно схлопнутое)
    expect(await kindsOf(org)).toEqual(['ride_joined']);
    const [doc] = await notificationsOf(h, friend.userId);
    expect(doc).toMatchObject({
      group: 'social',
      actors: [joiner.userId],
      target: { type: 'ride', rideId: ride.id },
      collapseKey: `social:going:${ride.id}`,
    });

    // повтор задачи с тем же id события — без дублей
    const [event] = (await eventsOfType(h, RIDES_PARTICIPANT_JOINED)).slice(-1);
    expect(await runIntake(h, RIDES_PARTICIPANT_JOINED, event!._id)).toBe('unchanged');
    expect(await notificationsOf(h, friend.userId)).toHaveLength(1);
  });

  it('записавшийся непубличный — без «Свои идут»', async () => {
    const org = await rider(h, 'org@example.by');
    const quiet = await rider(h, 'quiet@example.by');
    const friend = await rider(h, 'friend@example.by');
    await mutual(friend, quiet);
    const ride = await createRide(h, org, { limit: null });
    expect((await join(h, quiet, ride.id)).status).toBe(200);
    await notificationsIntake(h).drain();
    expect(await kindsOf(friend)).toEqual([]);
    expect(await kindsOf(org)).toEqual(['ride_joined']);
  });
});

describe('реакции (AC3)', () => {
  it('два «спасибо» одному на райде — одно уведомление, два лица; повтор задачи — без дублей', async () => {
    const org = await rider(h, 'org@example.by');
    const [a, b, recipient] = [
      await rider(h, 'a@example.by'),
      await rider(h, 'b@example.by'),
      await rider(h, 'r@example.by'),
    ];
    const ride = await pastRide(h, org, [a, b, recipient]);
    for (const who of [a, b, recipient]) {
      await socialServices(h).attendance.markManual(who.userId, ride.id);
    }
    for (const actor of [a, b]) {
      expect(await socialServices(h).reactions.thank(actor.userId, ride.id, recipient.userId)).toBe(
        true,
      );
    }
    const intake = notificationsIntake(h);
    await intake.drain();
    const docs = await notificationsOf(h, recipient.userId);
    expect(docs).toHaveLength(1);
    expect(docs[0]).toMatchObject({
      kind: 'social_thanks',
      actors: [a.userId, b.userId],
      target: { type: 'ride', rideId: ride.id },
    });
    for (const event of await eventsOfType(h, SOCIAL_REACTION_CREATED)) {
      await runIntake(h, SOCIAL_REACTION_CREATED, event._id);
    }
    expect(await notificationsOf(h, recipient.userId)).toHaveLength(1);
    expect((await notificationsOf(h, recipient.userId))[0]?.actors).toEqual([a.userId, b.userId]);
  });

  it('два «респекта» строке результата в одни сутки — одно; на следующие сутки — новое', async () => {
    const [owner, a, b] = [
      await rider(h, 'owner@example.by'),
      await rider(h, 'a@example.by'),
      await rider(h, 'b@example.by'),
    ];
    const raceId = await seedProtocolRace(h, await seedSeason(h), [], { title: 'Гран-при' });
    const entryId = await seedEntry(raceId, owner);
    const target = {
      targetType: 'race_entry' as const,
      targetId: entryId,
      recipientId: owner.userId,
    };
    await socialServices(h).reactions.setRespect(a.userId, target, true);
    await socialServices(h).reactions.setRespect(b.userId, target, true);
    await notificationsIntake(h).drain();
    const [doc] = await notificationsOf(h, owner.userId);
    expect(await notificationsOf(h, owner.userId)).toHaveLength(1);
    expect(doc).toMatchObject({
      kind: 'social_respect',
      actors: [a.userId, b.userId],
      target: { type: 'race', raceId },
      params: { object: 'Гран-при' },
    });

    // то же событие сутки спустя (окно — по времени id события)
    const [, second] = await eventsOfType(h, SOCIAL_REACTION_CREATED);
    const payload = second!.payload as SocialReactionCreated;
    const nextDay = await appendEvent(
      h,
      SOCIAL_REACTION_CREATED,
      { ...payload },
      new Date(Date.now() + DAY),
    );
    expect(await runIntake(h, SOCIAL_REACTION_CREATED, nextDay)).toBe('written');
    expect(await notificationsOf(h, owner.userId)).toHaveLength(2);
  });

  it('«респект» маршруту — автору, цель — свой маршрут; снятый до приёма — без уведомления', async () => {
    const [author, a, b] = [
      await rider(h, 'author@example.by'),
      await rider(h, 'a@example.by'),
      await rider(h, 'b@example.by'),
    ];
    const routeId = await seedApprovedRiderRoute(h, author.userId, {}, 'Вокруг моря');
    const target = { targetType: 'route' as const, targetId: routeId, recipientId: author.userId };
    await socialServices(h).reactions.setRespect(a.userId, target, true);
    await socialServices(h).reactions.setRespect(b.userId, target, true);
    await socialServices(h).reactions.setRespect(b.userId, target, false);
    const outcomes = await notificationsIntake(h).drain();
    expect(outcomes).toEqual(['written', 'skipped']);
    expect(await notificationsOf(h, author.userId)).toMatchObject([
      {
        kind: 'social_respect',
        actors: [a.userId],
        target: { type: 'my-route', routeId },
        params: { object: 'Вокруг моря' },
      },
    ]);
  });
});

describe('приглашение (AC3, AC4)', () => {
  it('`linked` — пригласившему, лицо — приглашённый; повтор (`already_linked`) — без события', async () => {
    const [inviter, invitee] = [
      await rider(h, 'inviter@example.by'),
      await rider(h, 'invitee@example.by'),
    ];
    expect(await socialServices(h).connections.linkInvite(inviter.userId, invitee.userId)).toBe(
      true,
    );
    expect(await socialServices(h).connections.linkInvite(inviter.userId, invitee.userId)).toBe(
      false,
    );
    expect(await eventsOfType(h, SOCIAL_INVITE_REGISTERED)).toHaveLength(1);
    await notificationsIntake(h).drain();
    expect(await notificationsOf(h, inviter.userId)).toMatchObject([
      { kind: 'social_invite_registered', actors: [invitee.userId], target: null },
    ]);
    expect(await kindsOf(invitee)).toEqual([]);
  });
});

/** Заявка гонки прямой вставкой: `entryRace` читает только `raceId`. */
async function seedEntry(raceId: string, owner: Rider): Promise<string> {
  const entryId = uuidv7();
  await resultsDb(h).entries.insertOne({
    _id: entryId,
    raceId,
    userId: owner.userId,
    status: 'active',
    createdAt: h.clock.now(),
  } as never);
  return entryId;
}
