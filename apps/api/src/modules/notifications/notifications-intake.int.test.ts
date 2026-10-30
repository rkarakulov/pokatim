import { Logger } from '@nestjs/common';
import { uuidv7 } from '@rkarakulov/api-kit/mongo';
import type { Job } from 'bullmq';
import { Collection } from 'mongodb';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { seedDispute } from '../../../test/disputes';
import { createHarness, DAY, HOUR, type Harness, MINUTE } from '../../../test/harness';
import { bearer, call, collections } from '../../../test/identity';
import {
  appendEvent,
  completeIntakeJobs,
  deliveryJobs,
  deliveryQueue,
  eventsOfType,
  fanoutJobs,
  notificationsDb,
  notificationsIntake,
  notificationsOf,
  runFanout,
  runIntake,
  seedLiveUsers,
  uuidv7At,
} from '../../../test/notifications';
import { createSeason, publishedRace, staff } from '../../../test/races';
import { resultsDb } from '../../../test/results';
import {
  moderationCall,
  MY_ROUTES,
  publicationDoc,
  riderCall,
  seedRiderRoute,
  submitPublication,
} from '../../../test/routes';
import {
  authed,
  createRide,
  join,
  report,
  RIDES,
  rider,
  ridesDb,
  type Rider,
  startsIn,
} from '../../../test/rides';
import { FanoutJobs } from './fanout-jobs';
import { type NoticeDraft, NotificationIntake } from './notification-intake';
import type { NotificationDoc } from './notifications.collection';
import { type FanoutJobData, NOTIFICATIONS_FANOUT_JOB, pushJobId } from './notifications.events';
import { NOTIFICATIONS_POLICY } from './notifications.policy';
import { NotificationsRepository } from './notifications.repository';
import { RIDES_PARTICIPANT_JOINED, RIDES_RIDE_RESCHEDULED } from '../rides';

/**
 * Приём событий для уведомлений (шаг B, AC1, AC2, AC5 — центр, AC7): каждое событие N3 — нужным получателям с текстом
 * таблицы, посторонним и удалённым — нет; повтор задачи и повторная публикация — одно уведомление; схлопывание по
 * объекту; событие старше 72 ч, исчезнувший объект и невалидный payload — skip. `PUSH_ENABLED=true`: состояние push
 * зависит от настроек (выключенная группа не мешает записи в центр).
 */
let h: Harness;
let organizer: Rider;
let a: Rider;
let b: Rider;
let stranger: Rider;
beforeAll(async () => {
  h = await createHarness({ PUSH_ENABLED: 'true' });
});
beforeEach(async () => {
  await h.reset();
  organizer = await rider(h, 'org@example.by');
  a = await rider(h, 'a@example.by');
  b = await rider(h, 'b@example.by');
  stranger = await rider(h, 'c@example.by');
});
afterEach(() => {
  vi.restoreAllMocks();
});
afterAll(async () => {
  await h.close();
});

const RACE_TITLE = 'Минское кольцо';
const total = () => notificationsDb(h).notifications.countDocuments();
const texts = async (who: Rider) =>
  (await notificationsOf(h, who.userId)).map((doc) => [doc.kind, doc.title, doc.body]);

async function race(): Promise<string> {
  const admin = await staff(h, 'admin@example.by', 'admin');
  await createSeason(h, admin.token);
  return (await publishedRace(h, admin.token, { title: RACE_TITLE })).id;
}

/** Райд организатора с участниками «Иду» `a` и `b`. */
async function rideWithParticipants() {
  const ride = await createRide(h, organizer, { title: 'Кофе на море' });
  expect((await join(h, a, ride.id)).status).toBe(200);
  expect((await join(h, b, ride.id)).status).toBe(200);
  return ride;
}

describe('райды: получатели, тексты, цели', () => {
  it('отмена — участникам «Иду» без организатора; посторонним — нет; письмо N2 — pending', async () => {
    const ride = await rideWithParticipants();
    const worker = notificationsIntake(h);
    await worker.drain();
    await authed(h, organizer, 'POST', `${RIDES}/${ride.id}/cancel`, { reason: 'weather' });
    expect(await worker.drain()).toEqual(['written']);

    const [cancelled] = await notificationsOf(h, a.userId);
    expect(cancelled).toMatchObject({
      kind: 'ride_cancelled',
      group: 'rides',
      title: 'Райд отменён',
      target: { type: 'ride', rideId: ride.id },
      readAt: null,
      createdAt: h.clock.now(),
      expireAt: new Date(h.clock.now().getTime() + NOTIFICATIONS_POLICY.ttlDays * DAY),
      email: { state: 'pending', claimedUntil: null, sentAt: null },
    });
    expect(cancelled?.body).toMatch(/^«Кофе на море» \d+ [а-я]+, \d\d:\d\d отменён\.$/);
    expect((await notificationsOf(h, b.userId)).map((doc) => doc.kind)).toContain('ride_cancelled');
    expect((await notificationsOf(h, organizer.userId)).map((doc) => doc.kind)).not.toContain(
      'ride_cancelled',
    );
    expect(await notificationsOf(h, stranger.userId)).toEqual([]);
  });

  it('«Новый участник» — организатору; второй участник схлопывает в одно, снова непрочитано и наверху', async () => {
    const ride = await createRide(h, organizer, { title: 'Кофе на море' });
    const worker = notificationsIntake(h);
    await join(h, a, ride.id);
    await worker.drain();
    const [first] = await notificationsOf(h, organizer.userId);
    expect(first).toMatchObject({
      kind: 'ride_joined',
      body: '«Кофе на море»: участников — 2.',
      collapseKey: `ride:${ride.id}:joined`,
    });
    await notificationsDb(h).notifications.updateOne(
      { _id: first!._id },
      { $set: { readAt: h.clock.now() } },
    );
    h.clock.advance(MINUTE);
    await join(h, b, ride.id);
    await worker.drain();
    const docs = await notificationsOf(h, organizer.userId);
    expect(docs).toHaveLength(1);
    expect(docs[0]).toMatchObject({
      _id: first!._id,
      body: '«Кофе на море»: участников — 3.',
      readAt: null,
      createdAt: h.clock.now(),
    });
    expect(await notificationsOf(h, a.userId)).toEqual([]);
    expect(await notificationsOf(h, b.userId)).toEqual([]);
  });

  it('два события райда в одну миллисекунду, у позднего меньший id — побеждает позднее по seq (N7)', async () => {
    const ride = await createRide(h, organizer, { title: 'Кофе на море' });
    const seqOf = async () => (await ridesDb(h).findOne({ _id: ride.id }))!.noticeSeq;
    // uuidv7 внутри миллисекунды не упорядочен: позднее событие может получить меньший id
    const prefix = uuidv7At(h.clock.now()).slice(0, 19);
    const first = `${prefix}bfff-ffffffffffff`;
    const second = `${prefix}8000-000000000000`;
    await join(h, a, ride.id);
    await appendEvent(h, RIDES_PARTICIPANT_JOINED, { rideId: ride.id, seq: await seqOf() }, first);
    expect(await runIntake(h, RIDES_PARTICIPANT_JOINED, first)).toBe('written');
    await notificationsDb(h).notifications.updateMany({}, { $set: { readAt: h.clock.now() } });
    await join(h, b, ride.id);
    await appendEvent(h, RIDES_PARTICIPANT_JOINED, { rideId: ride.id, seq: await seqOf() }, second);
    expect(await runIntake(h, RIDES_PARTICIPANT_JOINED, second)).toBe('written');
    const docs = await notificationsOf(h, organizer.userId);
    expect(docs).toHaveLength(1);
    expect(docs[0]).toMatchObject({
      body: '«Кофе на море»: участников — 3.',
      readAt: null,
      sourceEventId: second,
    });
    // повтор обеих задач — без изменений
    expect(await runIntake(h, RIDES_PARTICIPANT_JOINED, first)).toBe('unchanged');
    expect(await runIntake(h, RIDES_PARTICIPANT_JOINED, second)).toBe('unchanged');
    expect(await notificationsOf(h, organizer.userId)).toEqual(docs);
  });

  it('уведомление без collapseSeq (до номера): повтор его события не трогает, новое событие заменяет', async () => {
    const ride = await rideWithParticipants();
    await authed(h, organizer, 'POST', `${RIDES}/${ride.id}`, {
      version: 0,
      startsAt: startsIn(h, 2 * DAY),
    });
    const [rescheduled] = await eventsOfType(h, RIDES_RIDE_RESCHEDULED);
    expect(await runIntake(h, RIDES_RIDE_RESCHEDULED, rescheduled!._id)).toBe('written');
    // документ, записанный прежней версией: без номера, прочитан
    await notificationsDb(h).notifications.updateMany(
      { kind: 'ride_rescheduled' },
      { $unset: { collapseSeq: '' }, $set: { readAt: h.clock.now() } },
    );
    const before = await notificationsOf(h, a.userId);
    h.clock.advance(MINUTE);
    expect(await runIntake(h, RIDES_RIDE_RESCHEDULED, rescheduled!._id)).toBe('unchanged');
    expect(await notificationsOf(h, a.userId)).toEqual(before);
    await authed(h, organizer, 'POST', `${RIDES}/${ride.id}`, {
      version: 1,
      startsAt: startsIn(h, 3 * DAY),
    });
    const [, next] = await eventsOfType(h, RIDES_RIDE_RESCHEDULED);
    expect(await runIntake(h, RIDES_RIDE_RESCHEDULED, next!._id)).toBe('written');
    expect(
      (await notificationsOf(h, a.userId)).find((doc) => doc.kind === 'ride_rescheduled'),
    ).toMatchObject({ sourceEventId: next!._id, readAt: null, collapseSeq: expect.any(Number) });
  });

  it('события старого формата без seq — прежнее правило sourceEventId: позднее заменяет, повтор не трогает', async () => {
    const ride = await createRide(h, organizer, { title: 'Кофе на море' });
    await join(h, a, ride.id);
    const first = await appendEvent(h, RIDES_PARTICIPANT_JOINED, { rideId: ride.id });
    expect(await runIntake(h, RIDES_PARTICIPANT_JOINED, first)).toBe('written');
    const [initial] = await notificationsOf(h, organizer.userId);
    expect(initial).not.toHaveProperty('collapseSeq');
    await join(h, b, ride.id);
    const second = await appendEvent(h, RIDES_PARTICIPANT_JOINED, { rideId: ride.id });
    expect(await runIntake(h, RIDES_PARTICIPANT_JOINED, second)).toBe('written');
    const docs = await notificationsOf(h, organizer.userId);
    expect(docs).toHaveLength(1);
    expect(docs[0]).toMatchObject({
      sourceEventId: second,
      body: '«Кофе на море»: участников — 3.',
    });
    expect(await runIntake(h, RIDES_PARTICIPANT_JOINED, first)).toBe('unchanged');
    expect(await runIntake(h, RIDES_PARTICIPANT_JOINED, second)).toBe('unchanged');
    expect(await notificationsOf(h, organizer.userId)).toEqual(docs);
  });

  it('повтор задачи переноса после «Я иду» — прочитанное уведомление не открывается заново (N7)', async () => {
    const ride = await rideWithParticipants();
    await authed(h, organizer, 'POST', `${RIDES}/${ride.id}`, {
      version: 0,
      startsAt: startsIn(h, 2 * DAY),
    });
    const [rescheduled] = await eventsOfType(h, RIDES_RIDE_RESCHEDULED);
    expect(rescheduled!.payload).toMatchObject({ rideId: ride.id, seq: expect.any(Number) });
    expect(await runIntake(h, RIDES_RIDE_RESCHEDULED, rescheduled!._id)).toBe('written');
    await notificationsDb(h).notifications.updateMany({}, { $set: { readAt: h.clock.now() } });
    const before = [await notificationsOf(h, a.userId), await notificationsOf(h, b.userId)];
    h.clock.advance(MINUTE);
    expect((await join(h, stranger, ride.id)).status).toBe(200);
    // объект изменился, но повтор несёт номер своего события (получатели — на момент приёма, как и раньше)
    await runIntake(h, RIDES_RIDE_RESCHEDULED, rescheduled!._id);
    expect([await notificationsOf(h, a.userId), await notificationsOf(h, b.userId)]).toEqual(
      before,
    );
  });

  it('перенос дважды — один документ с новым временем; старое событие после нового не перетирает', async () => {
    const ride = await rideWithParticipants();
    await notificationsIntake(h).drain();
    await authed(h, organizer, 'POST', `${RIDES}/${ride.id}`, {
      version: 0,
      startsAt: startsIn(h, 2 * DAY),
    });
    h.clock.advance(MINUTE);
    await authed(h, organizer, 'POST', `${RIDES}/${ride.id}`, {
      version: 1,
      startsAt: startsIn(h, 3 * DAY),
    });
    const [older, newer] = await eventsOfType(h, 'rides.ride-rescheduled');
    // новое событие обработано раньше старого (задачи в очереди не упорядочены)
    expect(await runIntake(h, newer!.type, newer!._id)).toBe('written');
    const afterNewer = await notificationsOf(h, a.userId);
    expect(await runIntake(h, older!.type, older!._id)).toBe('unchanged');
    const docs = await notificationsOf(h, a.userId);
    expect(docs.filter((doc) => doc.kind === 'ride_rescheduled')).toHaveLength(1);
    expect(docs).toEqual(afterNewer);
    expect(docs.find((doc) => doc.kind === 'ride_rescheduled')).toMatchObject({
      sourceEventId: newer!._id,
      title: 'Райд перенесён',
      email: null,
    });
    expect(await notificationsOf(h, organizer.userId)).toEqual(
      expect.not.arrayContaining([expect.objectContaining({ kind: 'ride_rescheduled' })]),
    );
  });

  it('райд не в ожидаемом статусе к приёму (перенос, а райд уже отменён) — skip', async () => {
    const ride = await rideWithParticipants();
    await notificationsIntake(h).drain();
    await authed(h, organizer, 'POST', `${RIDES}/${ride.id}`, {
      version: 0,
      place: 'Новое место',
    });
    await authed(h, organizer, 'POST', `${RIDES}/${ride.id}/cancel`, { reason: 'weather' });
    const [rescheduled] = await eventsOfType(h, 'rides.ride-rescheduled');
    expect(await runIntake(h, rescheduled!.type, rescheduled!._id)).toBe('skipped');
    expect(
      await notificationsDb(h).notifications.countDocuments({ kind: 'ride_rescheduled' }),
    ).toBe(0);
  });

  it('жалоба рассмотрена — авторам жалоб, закрытых этим действием; прочим — нет', async () => {
    const ride = await createRide(h, organizer, { title: 'Кофе на море' });
    for (const who of [a, b, stranger]) {
      expect((await report(h, who, ride.id)).status).toBe(200);
    }
    const resolvedAt = h.clock.now();
    const reports = h.db.collection('ride_reports');
    await reports.updateMany(
      { rideId: ride.id, reporterUserId: { $in: [a.userId, b.userId] } },
      { $set: { resolvedAt, resolution: 'dismissed', resolvedBy: organizer.userId } },
    );
    const eventId = await appendEvent(h, 'rides.reports-resolved', {
      rideId: ride.id,
      resolvedAt: resolvedAt.toISOString(),
    });
    expect(await runIntake(h, 'rides.reports-resolved', eventId)).toBe('written');
    for (const who of [a, b]) {
      expect(await texts(who)).toEqual([
        [
          'ride_report_resolved',
          'Жалоба рассмотрена',
          'Модератор рассмотрел вашу жалобу на райд «Кофе на море». Спасибо.',
        ],
      ]);
    }
    expect(await notificationsOf(h, stranger.userId)).toEqual([]);
    expect(await notificationsOf(h, organizer.userId)).toEqual([]);
  });
});

describe('маршруты райдеров: решение по заявке (routes-06 A6)', () => {
  const ROUTE_TITLE = 'Вокруг Минского моря';
  const DECIDED = 'routes.publication-decided';
  let moderator: { userId: string; token: string };
  beforeEach(async () => {
    moderator = await staff(h, 'moderator@example.by', 'moderator');
  });

  /** Маршрут `a`, поданный через API; версия заявки после подачи — 0. */
  async function submittedRoute(): Promise<string> {
    const id = await seedRiderRoute(h, a.userId, { title: ROUTE_TITLE });
    expect((await submitPublication(h, a.token, id)).status).toBe(200);
    return id;
  }
  const decide = async (id: string, path: 'approve' | 'reject', body: object) => {
    const res = await moderationCall(h, moderator.token, 'POST', `/${id}/${path}`, body);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
  };
  const approve = (id: string, version = 0) =>
    decide(id, 'approve', { version, city: 'minsk', surfaces: ['asphalt'] });
  const reject = (id: string, reason: string, version = 0) =>
    decide(id, 'reject', { version, reason, comment: 'Мост закрыт на ремонт' });

  it('одобрение — автору «Маршрут опубликован», цель — свой маршрут, группа «Маршруты»; прочим — нет', async () => {
    const id = await submittedRoute();
    await approve(id);
    expect(await notificationsIntake(h).drain()).toEqual(['written']);

    const [published] = await notificationsOf(h, a.userId);
    expect(published).toMatchObject({
      kind: 'route_published',
      group: 'routes',
      title: 'Маршрут опубликован',
      body: `«${ROUTE_TITLE}» теперь в каталоге маршрутов.`,
      target: { type: 'my-route', routeId: id },
      collapseKey: `route:${id}:publication`,
      readAt: null,
      push: { state: 'pending' },
      email: null,
    });
    for (const who of [b, organizer, stranger])
      expect(await notificationsOf(h, who.userId)).toEqual([]);
    expect(await notificationsOf(h, moderator.userId)).toEqual([]);
  });

  it.each([
    ['push.routes: false', { routes: false }, 'skipped'],
    ['push.rides: false без push.routes', { rides: false }, 'skipped'],
    ['push.routes: true, push.rides: false', { routes: true, rides: false }, 'pending'],
  ] as const)('тумблер группы «Маршруты» при приёме: %s — push %s', async (_, push, state) => {
    await notificationsDb(h).settings.insertOne({
      _id: a.userId,
      push: { races: true, disputes: true, ...{ rides: true, ...push } },
      email: { disputes: true, rides: true },
      quietHours: { enabled: false, startHour: 22, endHour: 8 },
      updatedAt: h.clock.now(),
    });
    const id = await submittedRoute();
    await approve(id);
    expect(await notificationsIntake(h).drain()).toEqual(['written']);
    const [published] = await notificationsOf(h, a.userId);
    expect(published?.push).toMatchObject({
      state,
      reason: state === 'skipped' ? 'disabled' : null,
    });
  });

  it('отклонение — «Маршрут отклонён» с причиной без комментария модератора; новая подача и одобрение заменяют его', async () => {
    const id = await submittedRoute();
    await reject(id, 'impassable');
    const worker = notificationsIntake(h);
    expect(await worker.drain()).toEqual(['written']);
    expect(await texts(a)).toEqual([
      [
        'route_rejected',
        'Маршрут отклонён',
        `«${ROUTE_TITLE}» не опубликован. Причина — непроезжий или неточный.`,
      ],
    ]);
    expect(JSON.stringify(await notificationsOf(h, a.userId))).not.toContain('Мост');

    h.clock.advance(MINUTE);
    expect((await submitPublication(h, a.token, id)).status).toBe(200);
    await approve(id, 2);
    expect(await worker.drain()).toEqual(['written']);
    const docs = await notificationsOf(h, a.userId);
    expect(docs.map((doc) => [doc.kind, doc.title])).toEqual([
      ['route_published', 'Маршрут опубликован'],
    ]);
    // повтор задачи — без дублей
    const [event] = (await eventsOfType(h, DECIDED)).slice(-1);
    expect(await runIntake(h, DECIDED, event!._id)).toBe('unchanged');
    expect(await notificationsDb(h).notifications.countDocuments()).toBe(1);
  });

  it('причина «Другое» — без подписи, подробности на карточке маршрута', async () => {
    const id = await submittedRoute();
    await reject(id, 'other');
    await notificationsIntake(h).drain();
    expect((await notificationsOf(h, a.userId))[0]?.body).toBe(
      `«${ROUTE_TITLE}» не опубликован. Подробности — в карточке маршрута.`,
    );
  });

  it('решение пересмотрено до приёма (новая подача) или маршрут удалён — skipped без уведомлений', async () => {
    const resubmitted = await submittedRoute();
    await reject(resubmitted, 'dangerous');
    h.clock.advance(MINUTE);
    expect((await submitPublication(h, a.token, resubmitted)).status).toBe(200);

    const deleted = await seedRiderRoute(h, a.userId, { title: 'Удалённый' });
    expect((await submitPublication(h, a.token, deleted)).status).toBe(200);
    await approve(deleted);
    expect((await riderCall(h, a.token, 'POST', `${MY_ROUTES}/${deleted}/delete`)).status).toBe(
      204,
    );

    expect(await notificationsIntake(h).drain()).toEqual(['skipped', 'skipped']);
    expect(await total()).toBe(0);
  });

  it('хвост накопленных решений: событие старше 72 ч — stale, ровно 72 ч — принимается', async () => {
    const now = h.clock.now().getTime();
    const tail = async (ageMs: number) => {
      const decidedAt = new Date(now - ageMs);
      const id = await seedRiderRoute(h, a.userId, {
        title: ROUTE_TITLE,
        publication: publicationDoc(h, 'rejected', { decidedAt }),
      });
      return appendEvent(
        h,
        DECIDED,
        {
          routeId: id,
          authorUserId: a.userId,
          decision: 'rejected',
          decidedAt: decidedAt.toISOString(),
        },
        decidedAt,
      );
    };
    expect(await runIntake(h, DECIDED, await tail(30 * DAY))).toBe('stale');
    expect(await runIntake(h, DECIDED, await tail(72 * HOUR + 1))).toBe('stale');
    expect(await total()).toBe(0);
    expect(await runIntake(h, DECIDED, await tail(72 * HOUR))).toBe('written');
  });

  it('payload без кодов решения или с чужими ключами — skipped', async () => {
    const id = await seedRiderRoute(h, a.userId, { publication: publicationDoc(h, 'approved') });
    for (const payload of [
      {
        routeId: id,
        authorUserId: a.userId,
        decision: 'maybe',
        decidedAt: new Date().toISOString(),
      },
      {
        routeId: id,
        authorUserId: a.userId,
        decision: 'approved',
        decidedAt: h.clock.now().toISOString(),
        title: 'x',
      },
    ]) {
      expect(await runIntake(h, DECIDED, await appendEvent(h, DECIDED, payload))).toBe('skipped');
    }
    expect(await total()).toBe(0);
  });
});

describe('гонки и протокол', () => {
  it('вердикт попытки — райдеру попытки с датой заезда по Минску; цель — гонка', async () => {
    const raceId = await race();
    const attemptId = uuidv7();
    await h.db.collection(resultsDb(h).attempts.collectionName).insertOne({
      _id: attemptId as never,
      raceId,
      activityId: uuidv7(),
      userId: a.userId,
      activity: { startedAt: new Date('2026-10-24T21:30:00Z') },
    });
    const counted = await appendEvent(h, 'results.attempt-verdict-changed', {
      attemptId,
      raceId,
      userId: a.userId,
      status: 'counted',
    });
    const rejected = await appendEvent(h, 'results.attempt-verdict-changed', {
      attemptId,
      raceId,
      userId: a.userId,
      status: 'rejected',
    });
    expect(await runIntake(h, 'results.attempt-verdict-changed', counted)).toBe('written');
    expect(await runIntake(h, 'results.attempt-verdict-changed', rejected)).toBe('written');
    expect(await texts(a)).toEqual(
      expect.arrayContaining([
        ['result_counted', 'Результат засчитан', `«${RACE_TITLE}»: заезд 25 октября засчитан.`],
        [
          'result_rejected',
          'Результат не засчитан',
          `«${RACE_TITLE}»: заезд 25 октября не засчитан. Причина — на карточке гонки.`,
        ],
      ]),
    );
    expect((await notificationsOf(h, a.userId))[0]?.target).toEqual({ type: 'race', raceId });
    expect(await total()).toBe(2);
  });

  it('протокол опубликован — активным заявкам (и без результата); снятым и посторонним — нет', async () => {
    const raceId = await race();
    await h.db.collection(resultsDb(h).entries.collectionName).insertMany([
      { _id: uuidv7() as never, raceId, userId: a.userId, status: 'active' },
      { _id: uuidv7() as never, raceId, userId: b.userId, status: 'withdrawn' },
    ]);
    const eventId = await appendEvent(h, 'results.protocol-published', { raceId, revision: 1 });
    expect(await runIntake(h, 'results.protocol-published', eventId)).toBe('written');
    expect(await texts(a)).toEqual([
      ['protocol_published', 'Протокол опубликован', `«${RACE_TITLE}»: итоговый протокол готов.`],
    ]);
    expect(await notificationsOf(h, b.userId)).toEqual([]);
    expect(await notificationsOf(h, stranger.userId)).toEqual([]);
  });

  it('ревизия: дисквалификация и её отмена — владельцу заявки; перепроверка — строкам ревизии', async () => {
    const raceId = await race();
    const entryA = uuidv7();
    await h.db
      .collection(resultsDb(h).entries.collectionName)
      .insertOne({ _id: entryA as never, raceId, userId: a.userId, status: 'active' });
    await h.db.collection(resultsDb(h).protocolRows.collectionName).insertMany(
      [a, b].map((who, order) => ({
        _id: uuidv7() as never,
        raceId,
        revision: 3,
        order,
        entryId: uuidv7(),
        userId: who.userId,
      })),
    );
    const dq = await appendEvent(h, 'results.result-revised', {
      raceId,
      revision: 2,
      kind: 'disqualified',
      entryId: entryA,
    });
    const restored = await appendEvent(h, 'results.result-revised', {
      raceId,
      revision: 3,
      kind: 'disqualification_revoked',
      entryId: entryA,
    });
    const recheck = await appendEvent(h, 'results.result-revised', {
      raceId,
      revision: 3,
      kind: 'recheck_applied',
      entryId: null,
    });
    for (const id of [dq, restored, recheck]) {
      expect(await runIntake(h, 'results.result-revised', id)).toBe('written');
    }
    expect(new Set(await texts(a))).toEqual(
      new Set([
        [
          'protocol_disqualified',
          'Протокол изменён',
          `«${RACE_TITLE}»: ваш результат снят с протокола.`,
        ],
        [
          'protocol_restored',
          'Протокол изменён',
          `«${RACE_TITLE}»: ваш результат восстановлен в протоколе.`,
        ],
        [
          'protocol_rechecked',
          'Протокол пересчитан',
          `«${RACE_TITLE}»: протокол пересчитан после перепроверки треков.`,
        ],
      ]),
    );
    expect(await texts(b)).toEqual([
      [
        'protocol_rechecked',
        'Протокол пересчитан',
        `«${RACE_TITLE}»: протокол пересчитан после перепроверки треков.`,
      ],
    ]);
    expect(await notificationsOf(h, stranger.userId)).toEqual([]);
  });
});

describe('споры', () => {
  it('подан и отозван — цели спора; ответ — заявителю; решение — обоим; цели — экран ответа и гонка', async () => {
    const raceId = await race();
    const dispute = await seedDispute(h, {
      raceId,
      targetEntryId: uuidv7(),
      complainantUserId: a.userId,
      targetUserId: b.userId,
    });
    const payload = { disputeId: dispute._id, raceId };
    for (const type of ['filed', 'withdrawn', 'responded'] as const) {
      const id = await appendEvent(h, `disputes.dispute-${type}`, payload);
      expect(await runIntake(h, `disputes.dispute-${type}`, id)).toBe('written');
    }
    const decided = await appendEvent(h, 'disputes.dispute-decided', {
      ...payload,
      outcome: 'upheld',
    });
    expect(await runIntake(h, 'disputes.dispute-decided', decided)).toBe('written');

    const decidedRow = [
      'dispute_decided',
      'Решение по спору',
      `«${RACE_TITLE}»: спор рассмотрен — удовлетворён.`,
    ];
    expect(new Set(await texts(b))).toEqual(
      new Set([
        [
          'dispute_filed',
          'На ваш результат подан спор',
          `«${RACE_TITLE}»: вы можете ответить до решения модератора.`,
        ],
        ['dispute_withdrawn', 'Спор отозван', `«${RACE_TITLE}»: спор на ваш результат отозван.`],
        decidedRow,
      ]),
    );
    expect(new Set(await texts(a))).toEqual(
      new Set([
        [
          'dispute_responded',
          'Ответ на ваш спор',
          `«${RACE_TITLE}»: райдер ответил. Решение примет модератор.`,
        ],
        decidedRow,
      ]),
    );
    const targetOf = async (who: Rider, kind: string) =>
      (await notificationsOf(h, who.userId)).find((doc) => doc.kind === kind)?.target;
    expect(await targetOf(b, 'dispute_filed')).toEqual({
      type: 'dispute-response',
      raceId,
      disputeId: dispute._id,
    });
    expect(await targetOf(a, 'dispute_decided')).toEqual({ type: 'race', raceId });
    // письмо N2 — решение по спору
    expect(
      (await notificationsOf(h, a.userId)).find((d) => d.kind === 'dispute_decided')?.email,
    ).toMatchObject({ state: 'pending' });
    expect(await notificationsOf(h, stranger.userId)).toEqual([]);
  });

  it('решение «отклонён» — текст исхода без повтора слова «спор»', async () => {
    const raceId = await race();
    const dispute = await seedDispute(h, {
      raceId,
      targetEntryId: uuidv7(),
      complainantUserId: a.userId,
      targetUserId: b.userId,
    });
    const id = await appendEvent(h, 'disputes.dispute-decided', {
      disputeId: dispute._id,
      raceId,
      outcome: 'rejected',
    });
    await runIntake(h, 'disputes.dispute-decided', id);
    expect((await notificationsOf(h, a.userId))[0]?.body).toBe(
      `«${RACE_TITLE}»: спор рассмотрен — отклонён.`,
    );
  });
});

describe('идемпотентность и отсечки (AC2, AC7)', () => {
  it('повтор той же задачи и повторная публикация — одно уведомление на получателя', async () => {
    const ride = await rideWithParticipants();
    await notificationsIntake(h).drain();
    await authed(h, organizer, 'POST', `${RIDES}/${ride.id}/cancel`, { reason: 'weather' });
    const [event] = await eventsOfType(h, 'rides.ride-cancelled');
    expect(await runIntake(h, event!.type, event!._id)).toBe('written');
    const before = await notificationsDb(h).notifications.find().sort({ _id: 1 }).toArray();
    expect(await runIntake(h, event!.type, event!._id)).toBe('unchanged');
    // повторная публикация всех событий (новый обработчик): «Новый участник» отменённого райда — skip по статусу,
    // отмена — без изменений
    expect(await notificationsIntake(h).drain()).toEqual(['skipped', 'skipped', 'unchanged']);
    expect(await notificationsDb(h).notifications.find().sort({ _id: 1 }).toArray()).toEqual(
      before,
    );
    expect(await notificationsDb(h).notifications.countDocuments({ kind: 'ride_cancelled' })).toBe(
      2,
    );
  });

  it('параллельные задачи одного события — одно уведомление на получателя', async () => {
    const ride = await rideWithParticipants();
    await notificationsIntake(h).drain();
    await authed(h, organizer, 'POST', `${RIDES}/${ride.id}/cancel`, { reason: 'weather' });
    const [event] = await eventsOfType(h, 'rides.ride-cancelled');
    await Promise.all(Array.from({ length: 4 }, () => runIntake(h, event!.type, event!._id)));
    expect(await notificationsDb(h).notifications.countDocuments({ kind: 'ride_cancelled' })).toBe(
      2,
    );
  });

  it('гонка первой записи по collapseKey: старшее событие вставилось первым — итог новое (N7)', async () => {
    const repository = h.worker.get(NotificationsRepository);
    const at = h.clock.now();
    const notice = (sourceEventId: string, collapseSeq: number, body: string): NotificationDoc => ({
      _id: uuidv7(),
      userId: organizer.userId,
      kind: 'ride_joined',
      group: 'rides',
      title: 'Новый участник',
      body,
      target: { type: 'ride', rideId: 'r1' },
      sourceEventId,
      collapseKey: 'ride:r1:joined',
      collapseSeq,
      createdAt: at,
      readAt: null,
      expireAt: new Date(at.getTime() + NOTIFICATIONS_POLICY.ttlDays * DAY),
      push: {
        state: 'skipped',
        notBefore: at,
        claimId: null,
        claimedUntil: null,
        sentAt: null,
        reason: 'disabled',
      },
      email: null,
    });
    const older = notice(uuidv7At(new Date(at.getTime() - MINUTE)), 1, 'участников — 2.');
    const newer = notice(uuidv7At(at), 2, 'участников — 3.');
    // upsert нового события не нашёл документ, а старшее вставилось раньше: вставка нового — дубль collapse-индекса
    const original = Collection.prototype.bulkWrite;
    vi.spyOn(Collection.prototype, 'bulkWrite').mockImplementationOnce(async function (
      this: Collection<NotificationDoc>,
    ) {
      await this.insertOne(older);
      return original.call(this, [{ insertOne: { document: newer } }], { ordered: false });
    });

    expect(await repository.writeNotices([newer])).toBe(1);
    const docs = await notificationsOf(h, organizer.userId);
    expect(docs).toHaveLength(1);
    expect(docs[0]).toMatchObject({
      _id: older._id,
      sourceEventId: newer.sourceEventId,
      body: 'участников — 3.',
    });
  });

  it('удалённый аккаунт — уведомление не создаётся (RC-4)', async () => {
    const ride = await rideWithParticipants();
    await notificationsIntake(h).drain();
    await collections(h).users.updateOne({ _id: b.userId }, { $set: { deletedAt: h.clock.now() } });
    await authed(h, organizer, 'POST', `${RIDES}/${ride.id}/cancel`, { reason: 'weather' });
    await notificationsIntake(h).drain();
    expect((await notificationsOf(h, a.userId)).map((doc) => doc.kind)).toContain('ride_cancelled');
    expect(await notificationsOf(h, b.userId)).toEqual([]);
  });

  it('событие старше 72 ч — stale, без уведомлений; ровно 72 ч — принимается', async () => {
    const ride = await rideWithParticipants();
    await notificationsIntake(h).drain();
    await ridesDb(h).updateOne({ _id: ride.id }, { $set: { status: 'cancelled' } });
    const now = h.clock.now().getTime();
    const old = await appendEvent(
      h,
      'rides.ride-cancelled',
      { rideId: ride.id },
      new Date(now - 72 * HOUR - 1),
    );
    expect(await runIntake(h, 'rides.ride-cancelled', old)).toBe('stale');
    expect(await total()).toBe(1);
    const edge = await appendEvent(
      h,
      'rides.ride-cancelled',
      { rideId: ride.id },
      new Date(now - 72 * HOUR),
    );
    expect(await runIntake(h, 'rides.ride-cancelled', edge)).toBe('written');
  });

  it('объект исчез и невалидный payload — skipped без уведомлений; незнакомое имя задачи — ошибка', async () => {
    const gone = await appendEvent(h, 'rides.ride-cancelled', { rideId: uuidv7() });
    expect(await runIntake(h, 'rides.ride-cancelled', gone)).toBe('skipped');
    const invalid = await appendEvent(h, 'disputes.dispute-decided', {
      disputeId: uuidv7(),
      raceId: uuidv7(),
      outcome: 'maybe',
    });
    expect(await runIntake(h, 'disputes.dispute-decided', invalid)).toBe('skipped');
    const userIdInPayload = await appendEvent(h, 'results.protocol-published', {
      raceId: 'не-uuid',
      revision: 1,
    });
    expect(await runIntake(h, 'results.protocol-published', userIdInPayload)).toBe('skipped');
    await expect(runIntake(h, 'rides.ride-hidden', gone)).rejects.toThrow('unknown job');
    expect(await total()).toBe(0);
  });
});

describe('настройки при приёме (N4, RC-13)', () => {
  it('выключенная группа push — уведомление в центре есть, push skipped: disabled; остальные — pending', async () => {
    const res = await call(
      h,
      'PUT',
      '/v1/notifications/settings',
      {
        push: { races: true, disputes: true, rides: false },
        email: { disputes: true, rides: false },
        quietHours: { enabled: false, startHour: 22, endHour: 8 },
      },
      bearer(a.token),
    );
    expect(res.status).toBe(200);
    const ride = await rideWithParticipants();
    await notificationsIntake(h).drain();
    await authed(h, organizer, 'POST', `${RIDES}/${ride.id}/cancel`, { reason: 'weather' });
    await notificationsIntake(h).drain();
    const [forA] = await notificationsOf(h, a.userId);
    expect(forA).toMatchObject({
      kind: 'ride_cancelled',
      readAt: null,
      push: { state: 'skipped', reason: 'disabled' },
      email: { state: 'skipped' },
    });
    const [forB] = await notificationsOf(h, b.userId);
    expect(forB).toMatchObject({
      push: { state: 'pending', reason: null },
      email: { state: 'pending' },
    });
    // тихие часы по умолчанию (22–08 Минска): «сейчас» стенда — днём, push не отложен
    expect(forB?.push.notBefore).toEqual(h.clock.now());
  });
});

describe('пачки получателей (notifications.fanout)', () => {
  const PROTOCOL = 'results.protocol-published';
  /** Порт источника — граница теста (аудитория из `seedLiveUsers`), БД настоящая. */
  const audience = (recipients: string[]) => {
    const draft: NoticeDraft = {
      text: { kind: 'protocol_published', race: RACE_TITLE },
      target: { type: 'race', raceId: uuidv7() },
      recipients,
    };
    return vi.spyOn(h.worker.get(NotificationIntake), 'drafts').mockResolvedValue([draft]);
  };
  const protocolEvent = () => appendEvent(h, PROTOCOL, { raceId: uuidv7(), revision: 1 });
  const notifiedUsers = async () =>
    (await notificationsDb(h).notifications.find().toArray()).map((doc) => doc.userId).sort();
  const pushJobsOf = (userIds: readonly string[]) =>
    userIds.map((userId) => pushJobId(userId, h.clock.now())).sort();
  const chunkJob = (data: FanoutJobData, attemptsMade = 0) =>
    ({
      id: `test-${data.eventId}`,
      name: NOTIFICATIONS_FANOUT_JOB,
      data,
      attemptsMade,
      opts: { attempts: 5 },
    }) as unknown as Job;

  it('AC1: аудитория = пачке (200) — одна задача intake, пачек нет', async () => {
    const users = await seedLiveUsers(h, 200);
    audience(users);
    expect(await runIntake(h, PROTOCOL, await protocolEvent())).toBe('written');
    expect(await fanoutJobs(h)).toEqual([]);
    expect(await total()).toBe(200);
  });

  it('AC2: 450 — три пачки, intake не пишет; после пачек у каждого одно уведомление и доставка', async () => {
    const users = await seedLiveUsers(h, 450);
    audience(users);
    const eventId = await protocolEvent();
    expect(await runIntake(h, PROTOCOL, eventId)).toBe('fanned_out');
    const jobs = await fanoutJobs(h);
    expect(jobs.map((job) => job.id)).toEqual([0, 1, 2].map((c) => `fanout-${eventId}-0-${c}`));
    expect(jobs.map((job) => (job.data as FanoutJobData).userIds.length)).toEqual([200, 200, 50]);
    // опции очереди (FlowProducer их не применяет сам): ретраи, backoff, уборка
    expect(jobs[0]?.opts).toMatchObject({
      attempts: 5,
      backoff: { type: 'exponential', delay: 5_000 },
      removeOnComplete: 1_000,
      removeOnFail: false,
    });
    expect(await total()).toBe(0);

    expect(await completeIntakeJobs(h)).toEqual(['written', 'written', 'written']);
    expect(await notifiedUsers()).toEqual([...users].sort());
    expect(
      await notificationsDb(h).notifications.countDocuments({
        sourceEventId: eventId,
        kind: 'protocol_published',
        title: 'Протокол опубликован',
        'push.state': 'pending',
      }),
    ).toBe(450);
    expect((await deliveryJobs(h)).map((job) => job.id)).toEqual(pushJobsOf(users));
  });

  it('AC3: повтор intake — те же пачки, порт не вызван; выросшая аудитория и повтор после выполнения — новых нет', async () => {
    const users = await seedLiveUsers(h, 450);
    const drafts = audience(users);
    const eventId = await protocolEvent();
    expect(await runIntake(h, PROTOCOL, eventId)).toBe('fanned_out');
    expect(await runIntake(h, PROTOCOL, eventId)).toBe('fanned_out');
    expect(drafts).toHaveBeenCalledTimes(1);
    expect(await fanoutJobs(h)).toHaveLength(3);
    // повтор постановки тех же пачек (intake упал после addBulk, до ответа) — BullMQ не дублирует jobId
    const placed = await fanoutJobs(h);
    await h.worker
      .get(FanoutJobs)
      .enqueue(placed.map((job) => ({ jobId: String(job.id), data: job.data as FanoutJobData })));
    expect((await fanoutJobs(h)).map((job) => job.id)).toEqual(placed.map((job) => job.id));

    audience([...users, ...(await seedLiveUsers(h, 200))]);
    expect(await runIntake(h, PROTOCOL, eventId)).toBe('fanned_out');
    expect(await fanoutJobs(h)).toHaveLength(3);
    await completeIntakeJobs(h);
    expect(await total()).toBe(450);

    expect(await runIntake(h, PROTOCOL, eventId)).toBe('fanned_out');
    const jobs = await fanoutJobs(h);
    expect(jobs).toHaveLength(3);
    expect(await Promise.all(jobs.map((job) => job.getState()))).toEqual([
      'completed',
      'completed',
      'completed',
    ]);
    expect(await completeIntakeJobs(h)).toEqual([]);
    expect(await total()).toBe(450);
  });

  it('AC4: повтор пачки — unchanged, без дублей уведомлений и задач доставки', async () => {
    const users = await seedLiveUsers(h, 250);
    audience(users);
    expect(await runIntake(h, PROTOCOL, await protocolEvent())).toBe('fanned_out');
    const [first] = await fanoutJobs(h);
    expect(await runFanout(h, first!)).toBe('written');
    const delivery = await deliveryJobs(h);
    expect(await runFanout(h, first!)).toBe('unchanged');
    expect(await total()).toBe(200);
    expect(await deliveryJobs(h)).toEqual(delivery);
    expect(delivery).toHaveLength(200);
  });

  it('AC5: сбой записи пачки не мешает остальным; повтор дописывает и доставляет только её получателей', async () => {
    const users = await seedLiveUsers(h, 450);
    audience(users);
    expect(await runIntake(h, PROTOCOL, await protocolEvent())).toBe('fanned_out');
    const jobs = await fanoutJobs(h);
    const repository = h.worker.get(NotificationsRepository);
    const original = repository.writeNotices.bind(repository);
    vi.spyOn(repository, 'writeNotices')
      .mockImplementationOnce(original)
      .mockRejectedValueOnce(new Error('write failed'));

    expect(await runFanout(h, jobs[0]!)).toBe('written');
    await expect(runFanout(h, jobs[1]!)).rejects.toThrow('write failed');
    expect(await runFanout(h, jobs[2]!)).toBe('written');
    expect(await total()).toBe(250);

    // доставка первых пачек уже поставлена — повтор упавшей ставит только своих
    await deliveryQueue(h).drain(true);
    expect(await runFanout(h, jobs[1]!)).toBe('written');
    expect(await total()).toBe(450);
    const failedChunk = (jobs[1]!.data as FanoutJobData).userIds;
    expect((await deliveryJobs(h)).map((job) => job.id)).toEqual(pushJobsOf(failedChunk));
  });

  it('последняя попытка пачки — лог notifications.fanout_failed без userId и ошибка дальше', async () => {
    const users = await seedLiveUsers(h, 201);
    audience(users);
    const eventId = await protocolEvent();
    expect(await runIntake(h, PROTOCOL, eventId)).toBe('fanned_out');
    const [, last] = await fanoutJobs(h);
    vi.spyOn(h.worker.get(NotificationsRepository), 'writeNotices').mockRejectedValue(
      new Error('write failed'),
    );
    const errors = vi.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    await expect(runFanout(h, last!)).rejects.toThrow('write failed');
    expect(errors).not.toHaveBeenCalled();
    const final = chunkJob(last!.data as FanoutJobData, 4);
    await expect(runFanout(h, final)).rejects.toThrow('write failed');
    expect(errors).toHaveBeenCalledTimes(1);
    const [message] = errors.mock.calls[0] as [string];
    expect(message).toMatch(/^notifications\.fanout_failed /);
    expect(message).toContain(`event=${eventId}`);
    expect(message).toContain('attempts=5');
    expect(message).not.toContain(users[200]!);
  });

  it('пачка старше 72 ч — stale без записи; удалённый получатель пачки — без уведомления (RC-4)', async () => {
    const users = await seedLiveUsers(h, 3);
    const data = (eventId: string): FanoutJobData => ({
      eventId,
      type: PROTOCOL,
      kind: 'protocol_published',
      title: 'Протокол опубликован',
      body: `«${RACE_TITLE}»: итоговый протокол готов.`,
      target: null,
      userIds: users,
    });
    const now = h.clock.now().getTime();
    expect(await runFanout(h, chunkJob(data(uuidv7At(new Date(now - 72 * HOUR - 1)))))).toBe(
      'stale',
    );
    expect(await total()).toBe(0);

    await collections(h).users.updateOne({ _id: users[1] }, { $set: { deletedAt: h.clock.now() } });
    expect(await runFanout(h, chunkJob(data(uuidv7At(new Date(now - 72 * HOUR)))))).toBe('written');
    expect(await notifiedUsers()).toEqual([users[0]!, users[2]!].sort());
  });

  it('данные пачки не разбираются — ошибка (баг кода, failed-набор), без записи', async () => {
    const broken = chunkJob({ eventId: 'не-uuid' } as unknown as FanoutJobData);
    await expect(runFanout(h, broken)).rejects.toThrow();
    expect(await total()).toBe(0);
  });
});
