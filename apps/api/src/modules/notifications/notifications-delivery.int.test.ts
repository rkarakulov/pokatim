import { Logger } from '@nestjs/common';
import { MongoTransactions, uuidv7 } from '@rkarakulov/api-kit/mongo';
import { Worker } from 'bullmq';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { type FakeExpo, notRegisteredReceipt, startFakeExpo } from '../../../test/fake-expo';
import { createHarness, HOUR, type Harness, MINUTE } from '../../../test/harness';
import {
  bearer,
  call,
  collections,
  confirmPasswordReset,
  gate,
  latestResetToken,
  requestPasswordReset,
} from '../../../test/identity';
import {
  deliveryJobs,
  deliveryQueue,
  eventsOfType,
  expoToken,
  notificationsDb,
  notificationsOf,
  runEmail,
  runIntake,
  runPush,
  runReceipts,
  runRedeliver,
  seedNotification,
  seedPushToken,
} from '../../../test/notifications';
import { authed, createRide, join, RIDES, rider, type Rider } from '../../../test/rides';
import { RIDES_RIDE_CANCELLED } from '../rides';
import type { NotificationDoc } from './notifications.collection';
import { NotificationErasure } from './notification-erasure';
import { OPEN_APP_LINE } from './notification-email';
import { emailJobId, pushJobId } from './notifications.events';
import { NOTIFICATIONS_POLICY } from './notifications.policy';
import { NotificationsRepository } from './notifications.repository';
import { PushTokens } from './push-tokens';

/**
 * Доставка уведомлений (шаг C, AC2, AC5, AC6): push через фейковый Expo Push API, письма N2 — `FakeMailer`. Процессоры
 * вызываются напрямую, как их отдал бы worker; задачи, поставленные intake и регламентом, читаются из очереди.
 * Стенд: 2026-10-22 09:00Z = 12:00 по Минску (вне тихих часов по умолчанию 22–8).
 */
let expo: FakeExpo;
let h: Harness;
let organizer: Rider;
let a: Rider;
let b: Rider;
beforeAll(async () => {
  expo = await startFakeExpo();
  h = await createHarness({ PUSH_ENABLED: 'true', EXPO_PUSH_API_URL: expo.url });
});
beforeEach(async () => {
  await h.reset();
  expo.reset();
  organizer = await rider(h, 'org@example.by');
  a = await rider(h, 'a@example.by');
  b = await rider(h, 'b@example.by');
});
afterEach(() => {
  vi.restoreAllMocks();
});
afterAll(async () => {
  await h.close();
  await expo.stop();
});

/** Уведомление к отправке push (как его записал intake): `pending`, срок — сейчас. */
const pendingPush = (userId: string, overrides: Partial<NotificationDoc> = {}) =>
  seedNotification(h, userId, {
    push: {
      state: 'pending',
      notBefore: h.clock.now(),
      claimId: null,
      claimedUntil: null,
      sentAt: null,
      reason: null,
    },
    ...overrides,
  });
const docOf = (id: string) => notificationsDb(h).notifications.findOne({ _id: id });

/** Райд организатора с участниками `a` и `b`, отменённый; intake записал уведомления. */
async function cancelledRide() {
  const ride = await createRide(h, organizer, { title: 'Кофе на море' });
  expect((await join(h, a, ride.id)).status).toBe(200);
  expect((await join(h, b, ride.id)).status).toBe(200);
  expect(
    (await authed(h, organizer, 'POST', `${RIDES}/${ride.id}/cancel`, { reason: 'weather' }))
      .status,
  ).toBe(200);
  const [event] = await eventsOfType(h, RIDES_RIDE_CANCELLED);
  expect(await runIntake(h, RIDES_RIDE_CANCELLED, event!._id)).toBe('written');
  return { ride, eventId: event!._id };
}

describe('постановка из intake', () => {
  it('push по пользователю и письмо по уведомлению с детерминированными jobId; повтор intake — те же задачи', async () => {
    const { eventId } = await cancelledRide();
    const [docA] = await notificationsOf(h, a.userId);
    const [docB] = await notificationsOf(h, b.userId);
    const now = h.clock.now();
    const expected = [
      {
        name: 'notifications.email',
        id: emailJobId(docA!._id),
        data: { notificationId: docA!._id },
      },
      {
        name: 'notifications.email',
        id: emailJobId(docB!._id),
        data: { notificationId: docB!._id },
      },
      { name: 'notifications.push', id: pushJobId(a.userId, now), data: { userId: a.userId } },
      { name: 'notifications.push', id: pushJobId(b.userId, now), data: { userId: b.userId } },
    ].sort((x, y) => x.id.localeCompare(y.id));
    expect(await deliveryJobs(h)).toEqual(expected.map((job) => ({ ...job, delay: 0 })));

    expect(await runIntake(h, RIDES_RIDE_CANCELLED, eventId)).toBe('unchanged');
    expect(await deliveryJobs(h)).toHaveLength(4);
  });

  it('в тихие часы push — задача с задержкой до конца интервала; письмо — сразу', async () => {
    h.clock.advance(11 * HOUR); // 20:00Z = 23:00 по Минску
    // сессии стенда истекли — райдеры входят заново
    organizer = await rider(h, 'org2@example.by');
    a = await rider(h, 'a2@example.by');
    b = await rider(h, 'b2@example.by');
    await cancelledRide();
    const quietEnd = new Date('2026-10-23T05:00:00Z'); // 08:00 по Минску
    const jobs = await deliveryJobs(h);
    const push = jobs.find((job) => job.id === pushJobId(a.userId, quietEnd));
    expect(push?.delay).toBe(quietEnd.getTime() - h.clock.now().getTime());
    const [docA] = await notificationsOf(h, a.userId);
    expect(jobs.find((job) => job.id === emailJobId(docA!._id))?.delay).toBe(0);

    expect(await runEmail(h, docA!._id)).toBe('sent');
    expect(h.mailer.sent.map((mail) => mail.to)).toEqual(['a2@example.by']);
  });
});

describe('push', () => {
  it('уходит один раз: текст и цель уведомления на токены получателя; повтор задачи — none; чужие токены — нет', async () => {
    const { ride } = await cancelledRide();
    await seedPushToken(h, a.userId, 'a1');
    await seedPushToken(h, a.userId, 'a2');
    await seedPushToken(h, b.userId, 'b1');
    const [docA] = await notificationsOf(h, a.userId);

    expect(await runPush(h, a.userId)).toBe('sent');
    expect(await runPush(h, a.userId)).toBe('none');

    expect(expo.delivered.map((entry) => entry.message.to).sort()).toEqual([
      expoToken('a1'),
      expoToken('a2'),
    ]);
    expect(expo.messagesTo(expoToken('a1'))).toEqual([
      {
        to: expoToken('a1'),
        title: 'Райд отменён',
        body: docA!.body,
        sound: 'default',
        channelId: 'default',
        data: { target: { type: 'ride', rideId: ride.id } },
      },
    ]);
    expect(expo.messagesTo(expoToken('b1'))).toEqual([]);
    expect((await docOf(docA!._id))?.push).toMatchObject({
      state: 'sent',
      sentAt: h.clock.now(),
      claimId: null,
      claimedUntil: null,
    });
    expect(await notificationsDb(h).pushTickets.countDocuments()).toBe(2);
    // push b не тронут задачей a
    expect((await notificationsOf(h, b.userId))[0]?.push.state).toBe('pending');
  });

  it('две параллельные задачи пользователя — один push', async () => {
    await seedPushToken(h, a.userId, 'a1');
    await pendingPush(a.userId);
    const paused = gate();
    expo.hold(paused.wait);

    const first = runPush(h, a.userId);
    await paused.reached;
    expect(await runPush(h, a.userId)).toBe('none');
    paused.open();
    expect(await first).toBe('sent');
    expect(expo.delivered).toHaveLength(1);
  });

  it('сбой Expo посреди отправки — захват снят, ретрай шлёт один push; последняя попытка — failed', async () => {
    await seedPushToken(h, a.userId, 'a1');
    const doc = await pendingPush(a.userId);
    expo.fail('send', 503);

    await expect(runPush(h, a.userId)).rejects.toThrow('push service responded 503');
    expect((await docOf(doc._id))?.push).toMatchObject({ state: 'pending', claimId: null });
    expect(await runPush(h, a.userId, 1)).toBe('sent');
    expect(await runPush(h, a.userId, 2)).toBe('none');
    expect(expo.delivered).toHaveLength(1);

    const last = await pendingPush(a.userId);
    expo.fail('send', 500);
    const errors = vi.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    await expect(runPush(h, a.userId, 4)).rejects.toThrow();
    expect((await docOf(last._id))?.push).toMatchObject({ state: 'failed', reason: 'unavailable' });
    expect(errors.mock.calls.map((args) => String(args[0]))).toContain(
      `notifications.push_failed uid=${a.userId} count=1`,
    );
  });

  it('сбой worker после ответа Expo (до записи sent) — ретрай в пределах захвата не шлёт второй push', async () => {
    await seedPushToken(h, a.userId, 'a1');
    const doc = await pendingPush(a.userId);
    vi.spyOn(h.worker.get(NotificationsRepository), 'insertTickets').mockRejectedValueOnce(
      new Error('crash'),
    );

    await expect(runPush(h, a.userId)).rejects.toThrow('crash');
    expect(await runPush(h, a.userId, 1)).toBe('none');
    expect(expo.delivered).toHaveLength(1);
    expect((await docOf(doc._id))?.push.state).toBe('sending');
  });

  it('выключенная группа в момент отправки — push нет (skipped/disabled), другие группы уходят', async () => {
    await seedPushToken(h, a.userId, 'a1');
    const ride = await pendingPush(a.userId);
    const race = await pendingPush(a.userId, {
      kind: 'protocol_published',
      group: 'races',
      title: 'Протокол опубликован',
      body: '«Кольцо»: итоговый протокол готов.',
    });
    const saved = await call(
      h,
      'PUT',
      '/v1/notifications/settings',
      {
        push: { races: true, disputes: true, rides: false },
        email: { disputes: true, rides: true },
        quietHours: { enabled: false, startHour: 22, endHour: 8 },
      },
      bearer(a.token),
    );
    expect(saved.status).toBe(200);

    expect(await runPush(h, a.userId)).toBe('sent');
    expect((await docOf(ride._id))?.push).toMatchObject({ state: 'skipped', reason: 'disabled' });
    expect((await docOf(race._id))?.push.state).toBe('sent');
    expect(expo.delivered.map((entry) => entry.message.title)).toEqual(['Протокол опубликован']);
  });

  it('тихие часы: отложено до конца интервала; два отложенных — одна сводка без цели', async () => {
    await seedPushToken(h, a.userId, 'a1');
    h.clock.advance(11 * HOUR); // 23:00 по Минску
    const first = await pendingPush(a.userId);
    const second = await pendingPush(a.userId);

    expect(await runPush(h, a.userId)).toBe('deferred');
    const quietEnd = new Date('2026-10-23T05:00:00Z');
    for (const id of [first._id, second._id]) {
      expect((await docOf(id))?.push).toMatchObject({
        state: 'pending',
        notBefore: quietEnd,
        claimId: null,
      });
    }
    expect((await deliveryJobs(h)).map((job) => job.id)).toEqual([pushJobId(a.userId, quietEnd)]);
    expect(expo.delivered).toHaveLength(0);
    // до конца тихих часов задача ничего не берёт
    h.clock.advance(HOUR);
    expect(await runPush(h, a.userId)).toBe('none');

    h.clock.advance(quietEnd.getTime() - h.clock.now().getTime());
    expect(await runPush(h, a.userId)).toBe('sent');
    expect(expo.delivered.map((entry) => entry.message)).toEqual([
      expect.objectContaining({
        title: 'Покатим',
        body: 'У вас 2 новых уведомления.',
        data: { target: null },
      }),
    ]);
    expect((await docOf(first._id))?.push.state).toBe('sent');
    expect((await docOf(second._id))?.push.state).toBe('sent');
  });

  it('лимит 20 push в час: 21-й — limited, только в центре; через час — снова уходит', async () => {
    await seedPushToken(h, a.userId, 'a1');
    for (let i = 0; i < 20; i += 1) {
      await pendingPush(a.userId);
      expect(await runPush(h, a.userId)).toBe('sent');
      h.clock.advance(MINUTE);
    }
    const over = await pendingPush(a.userId);
    expect(await runPush(h, a.userId)).toBe('limited');
    expect((await docOf(over._id))?.push).toMatchObject({ state: 'limited', reason: 'rate_limit' });
    expect(expo.delivered).toHaveLength(20);

    h.clock.advance(HOUR);
    await pendingPush(a.userId);
    expect(await runPush(h, a.userId)).toBe('sent');
    expect(expo.delivered).toHaveLength(21);
  });

  it('ретрай после сбоя Expo не списывает лимит повторно', async () => {
    await seedPushToken(h, a.userId, 'a1');
    for (let i = 0; i < 19; i += 1) {
      await pendingPush(a.userId);
      expect(await runPush(h, a.userId)).toBe('sent');
      h.clock.advance(MINUTE);
    }
    // 20-й push: три сбоя Expo — лимит списан один раз, ретрай уходит
    await pendingPush(a.userId);
    for (let attempt = 0; attempt < 3; attempt += 1) {
      expo.fail('send', 503);
      await expect(runPush(h, a.userId, attempt)).rejects.toThrow();
    }
    expect(await runPush(h, a.userId, 3)).toBe('sent');
    expect(expo.delivered).toHaveLength(20);
    // 21-й в том же часе — limited
    await pendingPush(a.userId);
    expect(await runPush(h, a.userId)).toBe('limited');
  });

  it('нет токенов — skipped/no_tokens; удалённый аккаунт — skipped/deleted, без запроса к Expo', async () => {
    const noTokens = await pendingPush(a.userId);
    expect(await runPush(h, a.userId)).toBe('skipped');
    expect((await docOf(noTokens._id))?.push).toMatchObject({
      state: 'skipped',
      reason: 'no_tokens',
    });

    await seedPushToken(h, b.userId, 'b1');
    const deleted = await pendingPush(b.userId);
    await collections(h).users.updateOne({ _id: b.userId }, { $set: { deletedAt: h.clock.now() } });
    expect(await runPush(h, b.userId)).toBe('skipped');
    expect((await docOf(deleted._id))?.push).toMatchObject({ state: 'skipped', reason: 'deleted' });
    expect(expo.calls).toHaveLength(0);
  });

  it('тикет DeviceNotRegistered снимает токен сразу; push на живой токен — sent', async () => {
    const dead = await seedPushToken(h, a.userId, 'a1');
    const alive = await seedPushToken(h, a.userId, 'a2');
    expo.unregistered.add(expoToken('a1'));
    const doc = await pendingPush(a.userId);

    expect(await runPush(h, a.userId)).toBe('sent');
    expect(await notificationsDb(h).pushTokens.countDocuments({ _id: dead })).toBe(0);
    expect(await notificationsDb(h).pushTokens.countDocuments({ _id: alive })).toBe(1);
    expect((await docOf(doc._id))?.push.state).toBe('sent');
    expect(await notificationsDb(h).pushTickets.find().toArray()).toEqual([
      expect.objectContaining({ tokenId: alive }),
    ]);
  });

  it('сброс пароля отзывает сессии — push на токен прежней сессии не уходит, токен снят', async () => {
    const token = await seedPushToken(h, a.userId, 'a1');
    expect((await requestPasswordReset(h, 'a@example.by')).status).toBe(200);
    const reset = await confirmPasswordReset(
      h,
      await latestResetToken(h, 'a@example.by'),
      'brand-new-password',
    );
    expect(reset.status).toBe(200);
    const doc = await pendingPush(a.userId);

    expect(await runPush(h, a.userId)).toBe('skipped');
    expect((await docOf(doc._id))?.push).toMatchObject({ state: 'skipped', reason: 'no_tokens' });
    expect(await notificationsDb(h).pushTokens.countDocuments({ _id: token })).toBe(0);
    expect(expo.calls).toHaveLength(0);
  });

  it('отозванная сессия — её токен снимается, push уходит только на токен живой сессии', async () => {
    const [session] = await collections(h)
      .sessions.find({ userId: a.userId })
      .sort({ createdAt: -1 })
      .toArray();
    const alive = await seedPushToken(h, a.userId, 'a1');
    const revoked = await seedPushToken(h, a.userId, 'a2', uuidv7());
    await collections(h).sessions.insertOne({
      ...session!,
      _id: (await notificationsDb(h).pushTokens.findOne({ _id: revoked }))!.sessionId!,
      refreshTokenHash: 'revoked-session-hash',
      revokedAt: h.clock.now(),
      revokedReason: 'signed_out',
    });
    const foreign = await seedPushToken(h, a.userId, 'a3', session!._id);
    // сессия чужого пользователя под токеном a — не считается живой сессией a
    await notificationsDb(h).pushTokens.updateOne(
      { _id: foreign },
      { $set: { sessionId: (await collections(h).sessions.findOne({ userId: b.userId }))!._id } },
    );
    await pendingPush(a.userId);

    expect(await runPush(h, a.userId)).toBe('sent');
    expect(expo.delivered.map((entry) => entry.message.to)).toEqual([expoToken('a1')]);
    expect(await notificationsDb(h).pushTokens.countDocuments({ _id: alive })).toBe(1);
    expect(
      await notificationsDb(h).pushTokens.countDocuments({ _id: { $in: [revoked, foreign] } }),
    ).toBe(0);
  });

  /** Снятие токена: между чтением токенов и удалением устройство перерегистрировалось (`reassign`). */
  function reregisterBeforeDelete(tokenId: string, reassign: Record<string, string>) {
    const repository = h.worker.get(NotificationsRepository);
    const original = repository.deleteTokens.bind(repository);
    vi.spyOn(repository, 'deleteTokens').mockImplementationOnce(async (snapshot) => {
      await notificationsDb(h).pushTokens.updateOne({ _id: tokenId }, { $set: reassign });
      return original(snapshot);
    });
  }

  it('токен мёртвой сессии, перепривязанный в окне к другому аккаунту, не снимается (снятие по снимку)', async () => {
    const token = await seedPushToken(h, a.userId, 'a1', uuidv7());
    const sessionB = (await collections(h).sessions.findOne({ userId: b.userId }))!._id;
    reregisterBeforeDelete(token, { userId: b.userId, sessionId: sessionB });
    await pendingPush(a.userId);

    expect(await runPush(h, a.userId)).toBe('skipped');
    expect(await notificationsDb(h).pushTokens.findOne({ _id: token })).toMatchObject({
      userId: b.userId,
      sessionId: sessionB,
    });
  });

  it('тикет DeviceNotRegistered: токен, перерегистрированный в окне под новой сессией, не снимается', async () => {
    const token = await seedPushToken(h, a.userId, 'a1');
    expo.unregistered.add(expoToken('a1'));
    const fresh = uuidv7();
    reregisterBeforeDelete(token, { sessionId: fresh });
    await pendingPush(a.userId);

    expect(await runPush(h, a.userId)).toBe('failed');
    expect(await notificationsDb(h).pushTokens.findOne({ _id: token })).toMatchObject({
      userId: a.userId,
      sessionId: fresh,
    });
  });

  it('все тикеты с ошибкой — failed с кодом Expo', async () => {
    await seedPushToken(h, a.userId, 'a1');
    expo.unregistered.add(expoToken('a1'));
    const doc = await pendingPush(a.userId);
    expect(await runPush(h, a.userId)).toBe('failed');
    expect((await docOf(doc._id))?.push).toMatchObject({
      state: 'failed',
      reason: 'DeviceNotRegistered',
    });
    expect(await notificationsDb(h).pushTokens.countDocuments({ userId: a.userId })).toBe(0);
  });
});

describe('PUSH_ENABLED=false', () => {
  let off: Harness;
  beforeAll(async () => {
    off = await createHarness({ EXPO_PUSH_API_URL: expo.url });
  });
  afterAll(async () => {
    await off.close();
  });

  it('push помечается skipped/push_off, к Expo запросов нет', async () => {
    await off.reset();
    const who = await rider(off, 'off@example.by');
    await seedPushToken(off, who.userId, 'o1');
    const doc = await seedNotification(off, who.userId, {
      push: {
        state: 'pending',
        notBefore: off.clock.now(),
        claimId: null,
        claimedUntil: null,
        sentAt: null,
        reason: null,
      },
    });
    expect(await runPush(off, who.userId)).toBe('skipped');
    expect(
      (await notificationsDb(off).notifications.findOne({ _id: doc._id }))?.push,
    ).toMatchObject({ state: 'skipped', reason: 'push_off' });
    expect(expo.calls).toHaveLength(0);
  });
});

describe('квитанции Expo (регламент)', () => {
  it('DeviceNotRegistered в квитанции снимает токен; обработанные тикеты удаляются; моложе 15 мин — не проверяются', async () => {
    const token = await seedPushToken(h, a.userId, 'a1');
    const other = await seedPushToken(h, b.userId, 'b1');
    await pendingPush(a.userId);
    await pendingPush(b.userId);
    expect(await runPush(h, a.userId)).toBe('sent');
    expect(await runPush(h, b.userId)).toBe('sent');
    const ticketOf = (to: string) =>
      expo.delivered.find((entry) => entry.message.to === to)!.ticketId;
    expo.receiptsById.set(ticketOf(expoToken('a1')), notRegisteredReceipt());
    expo.receiptsById.set(ticketOf(expoToken('b1')), { status: 'ok' });

    h.clock.advance(10 * MINUTE);
    expect(await runReceipts(h)).toEqual({ checked: 0, unregistered: 0 });
    expect(expo.callsTo('getReceipts')).toHaveLength(0);

    h.clock.advance(5 * MINUTE);
    expect(await runReceipts(h)).toEqual({ checked: 2, unregistered: 1 });
    expect(await notificationsDb(h).pushTokens.countDocuments({ _id: token })).toBe(0);
    expect(await notificationsDb(h).pushTokens.countDocuments({ _id: other })).toBe(1);
    expect(await notificationsDb(h).pushTickets.countDocuments()).toBe(0);
  });

  it('квитанция ещё не готова — тикет остаётся до следующего прохода', async () => {
    await seedPushToken(h, a.userId, 'a1');
    await pendingPush(a.userId);
    await runPush(h, a.userId);
    h.clock.advance(16 * MINUTE);
    expect(await runReceipts(h)).toEqual({ checked: 0, unregistered: 0 });
    expect(await notificationsDb(h).pushTickets.countDocuments()).toBe(1);
  });

  it('пачка без готовых квитанций не закрывает следующие: DeviceNotRegistered за ней снимает токен в том же проходе', async () => {
    const batch = NOTIFICATIONS_POLICY.receiptsBatch;
    const sentAt = h.clock.now();
    // полная пачка старших тикетов, квитанции по которым Expo ещё не отдаёт
    await notificationsDb(h).pushTickets.insertMany(
      Array.from({ length: batch }, () => ({
        _id: uuidv7(),
        ticketId: uuidv7(),
        tokenId: uuidv7(),
        userId: b.userId,
        createdAt: new Date(sentAt.getTime() - MINUTE),
        expireAt: new Date(sentAt.getTime() + 24 * HOUR),
      })),
    );
    const token = await seedPushToken(h, a.userId, 'a1');
    await pendingPush(a.userId);
    expect(await runPush(h, a.userId)).toBe('sent');
    const [ticket] = expo.delivered;
    expo.receiptsById.set(ticket!.ticketId, notRegisteredReceipt());
    h.clock.advance(16 * MINUTE);

    expect(await runReceipts(h)).toEqual({ checked: 1, unregistered: 1 });
    expect(await notificationsDb(h).pushTokens.countDocuments({ _id: token })).toBe(0);
    expect(await notificationsDb(h).pushTickets.countDocuments()).toBe(batch);
  });
});

describe('удаление аккаунта (N11)', () => {
  it('push → тикет → токены сняты транзакцией удаления → стирание: тикетов пользователя нет, чужие целы', async () => {
    await seedPushToken(h, a.userId, 'a1');
    await seedPushToken(h, b.userId, 'b1');
    await pendingPush(a.userId);
    await pendingPush(b.userId);
    expect(await runPush(h, a.userId)).toBe('sent');
    expect(await runPush(h, b.userId)).toBe('sent');
    const tickets = notificationsDb(h).pushTickets;
    expect(await tickets.countDocuments({ userId: a.userId })).toBe(1);

    // как AccountDeletionService: токены снимаются в транзакции удаления, стирание — позже, фоном
    await h.app
      .get(MongoTransactions, { strict: false })
      .run((tx) => h.app.get(PushTokens, { strict: false }).revokeAllOf(tx, a.userId));
    expect(
      await h.worker.get(NotificationErasure, { strict: false }).erase(a.userId),
    ).toMatchObject({
      tokens: 0,
      tickets: 1,
    });

    expect(await tickets.countDocuments({ userId: a.userId })).toBe(0);
    expect(await tickets.countDocuments({ userId: b.userId })).toBe(1);
  });
});

describe('письма N2', () => {
  it('одно письмо при повторе задачи: тема — заголовок, текст — снимок; состояние sent', async () => {
    await cancelledRide();
    const [docA] = await notificationsOf(h, a.userId);

    expect(await runEmail(h, docA!._id)).toBe('sent');
    expect(await runEmail(h, docA!._id, 1)).toBe('skipped');

    expect(h.mailer.sent).toHaveLength(1);
    expect(h.mailer.sent[0]).toMatchObject({ to: 'a@example.by', subject: 'Райд отменён' });
    expect(h.mailer.sent[0]?.text).toContain(docA!.body);
    expect((await docOf(docA!._id))?.email).toMatchObject({
      state: 'sent',
      sentAt: h.clock.now(),
      claimedUntil: null,
    });
  });

  it('параллельная задача при живом захвате — ретрай (busy), письмо одно', async () => {
    await cancelledRide();
    const [docA] = await notificationsOf(h, a.userId);
    const release = h.mailer.hold();

    const first = runEmail(h, docA!._id);
    await vi.waitFor(async () => expect((await docOf(docA!._id))?.email?.state).toBe('sending'));
    await expect(runEmail(h, docA!._id)).rejects.toThrow('send in progress');
    release();
    expect(await first).toBe('sent');
    expect(h.mailer.sent).toHaveLength(1);
  });

  it('сбой SMTP — захват снят, ретрай шлёт одно письмо; последняя попытка — failed', async () => {
    await cancelledRide();
    const [docA] = await notificationsOf(h, a.userId);
    const [docB] = await notificationsOf(h, b.userId);

    h.mailer.failNext();
    await expect(runEmail(h, docA!._id)).rejects.toThrow();
    expect((await docOf(docA!._id))?.email?.state).toBe('pending');
    expect(await runEmail(h, docA!._id, 1)).toBe('sent');
    expect(h.mailer.sent).toHaveLength(1);

    h.mailer.failNext();
    vi.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    await expect(runEmail(h, docB!._id, 4)).rejects.toThrow();
    expect((await docOf(docB!._id))?.email?.state).toBe('failed');
  });

  it('удалённый получатель — skipped, письма нет; уведомление без письма — skipped', async () => {
    await cancelledRide();
    const [docA] = await notificationsOf(h, a.userId);
    await collections(h).users.updateOne({ _id: a.userId }, { $set: { deletedAt: h.clock.now() } });
    expect(await runEmail(h, docA!._id)).toBe('skipped');
    expect((await docOf(docA!._id))?.email?.state).toBe('skipped');

    const withoutEmail = await pendingPush(b.userId);
    expect(await runEmail(h, withoutEmail._id)).toBe('skipped');
    expect(h.mailer.sent).toHaveLength(0);
  });
});

describe('письмо напоминания о событии без APP_WEB_ORIGIN (PR D, RC-D9)', () => {
  it('цель «билет», но без env — без кнопки, строка «Откройте приложение»', async () => {
    const doc = await seedNotification(h, a.userId, {
      kind: 'event_reminder',
      group: 'events',
      title: 'Скоро старт',
      body: '«Гонка» — 24 октября, 10:00.\nПаспорт',
      target: { type: 'ticket', code: '7XK2M9PQRT' },
      email: { state: 'pending', claimedUntil: null, sentAt: null },
    });
    expect(await runEmail(h, doc._id)).toBe('sent');
    const mail = h.mailer.sent[0]!;
    expect(mail.subject).toBe('Скоро старт');
    expect(mail.html).not.toContain('href=');
    expect(mail.text).toContain(OPEN_APP_LINE);
  });
});

describe('перепостановка (регламент)', () => {
  it('pending дольше 10 мин после срока и истёкший захват — задачи с теми же jobId; свежие — нет; повтор — без дублей', async () => {
    const fresh = await pendingPush(a.userId);
    h.clock.advance(11 * MINUTE);
    await pendingPush(b.userId);
    const stuckEmail = await seedNotification(h, organizer.userId, {
      createdAt: new Date(h.clock.now().getTime() - 20 * MINUTE),
      email: { state: 'pending', claimedUntil: null, sentAt: null },
    });

    expect(await runRedeliver(h)).toEqual({ push: 1, email: 1 });
    expect((await deliveryJobs(h)).map((job) => job.id).sort()).toEqual(
      [pushJobId(a.userId, fresh.push.notBefore), emailJobId(stuckEmail._id)].sort(),
    );
    expect(await runRedeliver(h)).toEqual({ push: 0, email: 0 });
    expect(await deliveryJobs(h)).toHaveLength(2);
  });

  it('завершённая задача с тем же jobId (BullMQ хранит её) не мешает перепостановке', async () => {
    const doc = await pendingPush(a.userId);
    const jobId = pushJobId(a.userId, doc.push.notBefore);
    const queue = deliveryQueue(h);
    await queue.add('notifications.push', { userId: a.userId }, { jobId });
    // задача отработала раньше записи этого уведомления: завершена, хранится, документ остался pending
    const worker = new Worker(queue.name, null, { connection: queue.opts.connection });
    try {
      const job = await worker.getNextJob('lock-token');
      await job?.moveToCompleted('none', 'lock-token', false);
    } finally {
      await worker.close();
    }
    expect(await (await queue.getJob(jobId))?.getState()).toBe('completed');

    h.clock.advance(11 * MINUTE);
    expect(await runRedeliver(h)).toEqual({ push: 1, email: 0 });
    expect((await deliveryJobs(h)).map((job) => job.id)).toEqual([jobId]);
  });

  it('удалённое уведомление (истёкший срок хранения) не захватывается', async () => {
    await seedPushToken(h, a.userId, 'a1');
    await pendingPush(a.userId, { expireAt: h.clock.now() });
    expect(await runPush(h, a.userId)).toBe('none');
    expect(expo.calls).toHaveLength(0);
  });

  it('истёкшее уведомление (expireAt = сейчас) — письмо не захватывается и не перепоставляется', async () => {
    const expired = await seedNotification(h, a.userId, {
      createdAt: new Date(h.clock.now().getTime() - 20 * MINUTE),
      expireAt: h.clock.now(),
      email: { state: 'pending', claimedUntil: null, sentAt: null },
    });
    await pendingPush(b.userId, {
      expireAt: h.clock.now(),
      push: {
        state: 'pending',
        notBefore: new Date(h.clock.now().getTime() - 20 * MINUTE),
        claimId: null,
        claimedUntil: null,
        sentAt: null,
        reason: null,
      },
    });

    expect(await runRedeliver(h)).toEqual({ push: 0, email: 0 });
    expect(await runEmail(h, expired._id)).toBe('skipped');
    expect(h.mailer.sent).toHaveLength(0);
    expect((await docOf(expired._id))?.email?.state).toBe('pending');
  });
});
