import { uuidv7 } from '@rkarakulov/api-kit/mongo';
import { Collection } from 'mongodb';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { seedDispute } from '../../../test/disputes';
import { createHarness, DAY, HOUR, type Harness, MINUTE } from '../../../test/harness';
import { bearer, call, collections } from '../../../test/identity';
import {
  appendEvent,
  eventsOfType,
  notificationsDb,
  notificationsIntake,
  notificationsOf,
  runIntake,
  uuidv7At,
} from '../../../test/notifications';
import { createSeason, publishedRace, staff } from '../../../test/races';
import { resultsDb } from '../../../test/results';
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
import type { NotificationDoc } from './notifications.collection';
import { NOTIFICATIONS_POLICY } from './notifications.policy';
import { NotificationsRepository } from './notifications.repository';

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
    const notice = (sourceEventId: string, body: string): NotificationDoc => ({
      _id: uuidv7(),
      userId: organizer.userId,
      kind: 'ride_joined',
      group: 'rides',
      title: 'Новый участник',
      body,
      target: { type: 'ride', rideId: 'r1' },
      sourceEventId,
      collapseKey: 'ride:r1:joined',
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
    const older = notice(uuidv7At(new Date(at.getTime() - MINUTE)), 'участников — 2.');
    const newer = notice(uuidv7At(at), 'участников — 3.');
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
