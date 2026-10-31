import { randomBytes } from 'node:crypto';

import { DEFAULT_NOTIFICATION_SETTINGS, NotificationPage } from '@pokatim/contracts';
import { uuidv7 } from '@rkarakulov/api-kit/mongo';
import type { Job } from 'bullmq';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { type FakeExpo, startFakeExpo } from '../../../test/fake-expo';
import { createHarness, type Harness, HOUR } from '../../../test/harness';
import { bearer, call, type CallResult } from '../../../test/identity';
import {
  deliveryJobs,
  NOTIFICATIONS,
  notificationsDb,
  notificationsOf,
  runFanout,
  runPush,
  seedNotification,
  seedPushToken,
  uuidv7At,
} from '../../../test/notifications';
import { rider, type Rider } from '../../../test/rides';
import { profilesCollection, seedProfile } from '../../../test/standings';
import { ProfileErasure, RIDER_NAMES, type RiderNameDirectory } from '../profile';
import { renderDraft } from './notification-fanout';
import type { NoticeDraft } from './notification-intake';
import { NotificationErasure } from './notification-erasure';
import { type FanoutJobData, NOTIFICATIONS_FANOUT_JOB, pushJobId } from './notifications.events';
import { NOTIFICATIONS_POLICY } from './notifications.policy';
import {
  SOCIAL_ACTORS_MAX,
  type SocialNoticeKind,
  type SocialObjectType,
  socialNoticeDraft,
} from './social-notices';

/**
 * Группа «Свои» (social-p1, ADR-0027 п. 6): подресурс настроек, имена действующих лиц при чтении списка и отправке
 * push, накопление `actors` в окне схлопывания. Событий `social.*` ещё нет (P7) — запись идёт реальным путём задачи
 * `notifications.fanout` (`writeRecipients` → `writeNotices`) с черновиком `socialNoticeDraft`.
 * Стенд: 2026-10-22 09:00Z = 12:00 по Минску.
 */
let expo: FakeExpo;
let h: Harness;
let a: Rider;
let b: Rider;
let katya: Rider;
let petya: Rider;
let hidden: Rider;
let katyaId: string;
let petyaId: string;
beforeAll(async () => {
  expo = await startFakeExpo();
  h = await createHarness({ PUSH_ENABLED: 'true', EXPO_PUSH_API_URL: expo.url });
});
beforeEach(async () => {
  await h.reset();
  expo.reset();
  a = await rider(h, 'a@example.by');
  b = await rider(h, 'b@example.by');
  katya = await rider(h, 'katya@example.by');
  petya = await rider(h, 'petya@example.by');
  hidden = await rider(h, 'hidden@example.by');
  katyaId = randomBytes(32).toString('base64url');
  petyaId = randomBytes(32).toString('base64url');
  await seedProfile(h, katya.userId, 'Катя Л.', true, { publicId: katyaId });
  await seedProfile(h, petya.userId, 'Петя', true, { publicId: petyaId });
  // имя есть, согласия на показ нет
  await seedProfile(h, hidden.userId, 'Скрытый', false);
});
afterEach(() => {
  vi.restoreAllMocks();
});
afterAll(async () => {
  await h.close();
  await expo.stop();
});

const as = (
  who: Rider,
  method: 'GET' | 'PUT',
  url: string,
  payload?: unknown,
): Promise<CallResult> => call(h, method, url, payload, bearer(who.token));

const SOCIAL_SETTINGS = `${NOTIFICATIONS}/settings/social`;

/** Задача-пачка `notifications.fanout` из черновика (как её поставил бы intake P7), получатели — `recipients`. */
function fanoutJob(eventId: string, draft: NoticeDraft): Job {
  const rendered = renderDraft(draft);
  const data: FanoutJobData = {
    eventId,
    type: 'social.test',
    kind: rendered.kind,
    title: rendered.title,
    body: rendered.body,
    target: rendered.target,
    ...(rendered.collapse ? { collapse: rendered.collapse } : {}),
    ...(rendered.social ? { social: rendered.social } : {}),
    userIds: draft.recipients,
  };
  return {
    name: NOTIFICATIONS_FANOUT_JOB,
    id: `fanout-${eventId}-0-0`,
    data,
    attemptsMade: 0,
    opts: { attempts: 5 },
  } as unknown as Job;
}

const RIDE_ID = '01890a5d-ac96-774b-bcce-b302099a8057';
const RIDE = { type: 'ride' as SocialObjectType, id: RIDE_ID, title: 'Кофе-райд' };

/** Социальное событие: черновик → пачка → запись. Возвращает id события и итог задачи. */
async function social(
  kind: SocialNoticeKind,
  actor: Rider | null,
  recipients: Rider[],
  object: { type: SocialObjectType; id: string; title: string } | null = RIDE,
  { at = h.clock.now(), eventId = uuidv7At(at) }: { at?: Date; eventId?: string } = {},
) {
  const draft = socialNoticeDraft({
    kind,
    eventId,
    actor: actor?.userId ?? null,
    recipients: recipients.map((who) => who.userId),
    object,
  });
  const outcome = await runFanout(h, fanoutJob(eventId, draft));
  return { eventId, outcome, job: fanoutJob(eventId, draft) };
}

const listOf = async (who: Rider) => {
  const res = await as(who, 'GET', NOTIFICATIONS);
  expect(res.status).toBe(200);
  return NotificationPage.parse(res.body).items;
};
const docsOf = (who: Rider) => notificationsOf(h, who.userId);

describe('настройки «Свои» (подресурс, только push)', () => {
  const custom = {
    push: { races: false, disputes: true, rides: false },
    email: { disputes: false, rides: true },
    quietHours: { enabled: true, startHour: 23, endHour: 7 },
  };

  it('без сессии — 401', async () => {
    for (const method of ['GET', 'PUT'] as const) {
      const res = await call(h, method, SOCIAL_SETTINGS, { push: false });
      expect(res.status).toBe(401);
    }
  });

  it('нет документа и нет поля — включено (без наследования); no-store', async () => {
    const initial = await as(a, 'GET', SOCIAL_SETTINGS);
    expect(initial.status).toBe(200);
    expect(initial.headers['cache-control']).toBe('no-store');
    expect(initial.body).toEqual({ push: true });
    await as(a, 'PUT', `${NOTIFICATIONS}/settings`, custom);
    expect((await as(a, 'GET', SOCIAL_SETTINGS)).body).toEqual({ push: true });
  });

  it('PUT пишет только push.social; /settings — прежние ключи; PUT /settings его не стирает; у другого — своё', async () => {
    await as(a, 'PUT', `${NOTIFICATIONS}/settings`, custom);
    const saved = await as(a, 'PUT', SOCIAL_SETTINGS, { push: false });
    expect(saved.status).toBe(200);
    expect(saved.body).toEqual({ push: false });
    expect((await as(a, 'GET', SOCIAL_SETTINGS)).body).toEqual({ push: false });
    expect((await as(a, 'GET', `${NOTIFICATIONS}/settings`)).body).toEqual(custom);
    await as(a, 'PUT', `${NOTIFICATIONS}/settings`, custom);
    expect((await as(a, 'GET', SOCIAL_SETTINGS)).body).toEqual({ push: false });
    expect((await as(b, 'GET', SOCIAL_SETTINGS)).body).toEqual({ push: true });
    // другие подресурсы не тронуты
    expect((await as(a, 'GET', `${NOTIFICATIONS}/settings/achievements`)).body).toEqual({
      push: true,
    });
  });

  it('PUT без документа — умолчания основных настроек: /settings — полный объект', async () => {
    expect((await as(a, 'PUT', SOCIAL_SETTINGS, { push: false })).status).toBe(200);
    expect((await as(a, 'GET', `${NOTIFICATIONS}/settings`)).body).toEqual(
      DEFAULT_NOTIFICATION_SETTINGS,
    );
  });

  it('лишний ключ, пустой объект, не boolean — 400; лимит общий с /settings — 429', async () => {
    for (const body of [{}, { push: true, email: true }, { push: 1 }]) {
      const res = await as(a, 'PUT', SOCIAL_SETTINGS, body);
      expect(res.status).toBe(400);
      expect(res.body).toMatchObject({ code: 'VALIDATION_FAILED' });
    }
    for (let i = 0; i < NOTIFICATIONS_POLICY.settingsLimit.limit; i++) {
      expect((await as(a, 'PUT', SOCIAL_SETTINGS, { push: true })).status).toBe(200);
    }
    const limited = await as(a, 'PUT', SOCIAL_SETTINGS, { push: true });
    expect(limited.status).toBe(429);
    expect(limited.body).toMatchObject({ code: 'RATE_LIMITED' });
  });
});

describe('запись и накопление (writeNotices, RC-1a)', () => {
  it('создание: actors и params, запасной текст без имён; доставка — push pending, письма нет', async () => {
    const { eventId, outcome } = await social('social_riders_going', katya, [a, b]);
    expect(outcome).toBe('written');
    const [doc] = await docsOf(a);
    expect(doc).toMatchObject({
      kind: 'social_riders_going',
      group: 'social',
      title: 'Свои идут',
      body: 'Райдер · «Кофе-райд»',
      target: { type: 'ride', rideId: RIDE_ID },
      sourceEventId: eventId,
      collapseKey: `social:going:${RIDE_ID}`,
      actors: [katya.userId],
      params: { object: 'Кофе-райд' },
      readAt: null,
      push: { state: 'pending' },
      email: null,
    });
    expect(doc).not.toHaveProperty('collapseSeq');
    expect(await docsOf(b)).toHaveLength(1);
  });

  it('повтор с новым лицом — один документ: лицо добавлено, снова непрочитано и наверху, создающее событие и push прежние; задачи push нет', async () => {
    const first = await social('social_riders_going', katya, [a]);
    const [created] = await docsOf(a);
    await notificationsDb(h).notifications.updateOne(
      { _id: created!._id },
      { $set: { readAt: h.clock.now() } },
    );
    const jobsBefore = await deliveryJobs(h);
    expect(jobsBefore.map((job) => job.id)).toEqual([pushJobId(a.userId, h.clock.now())]);

    h.clock.advance(HOUR);
    const other = await seedNotification(h, a.userId); // обычное уведомление между событиями
    h.clock.advance(HOUR);
    const second = await social('social_riders_going', petya, [a], {
      ...RIDE,
      title: 'Кофе-райд (новое имя)',
    });
    expect(second.outcome).toBe('written');

    const docs = await docsOf(a);
    expect(docs.map((doc) => doc._id)).toEqual([created!._id, other._id]);
    expect(docs[0]).toMatchObject({
      actors: [katya.userId, petya.userId],
      readAt: null,
      createdAt: h.clock.now(),
      sourceEventId: first.eventId,
      push: created!.push,
      params: { object: 'Кофе-райд (новое имя)' },
    });
    expect(docs[0]!.expireAt).toEqual(
      new Date(h.clock.now().getTime() + NOTIFICATIONS_POLICY.ttlDays * 86_400_000),
    );
    // второе событие push не ставит: его создающего документа нет
    expect(await deliveryJobs(h)).toEqual(jobsBefore);
  });

  it('повтор того же лица — документ без изменений (прочитанное остаётся прочитанным); повтор задачи — unchanged', async () => {
    const first = await social('social_thanks', katya, [a]);
    const [created] = await docsOf(a);
    await notificationsDb(h).notifications.updateOne(
      { _id: created!._id },
      { $set: { readAt: h.clock.now() } },
    );
    const read = await notificationsDb(h).notifications.findOne({ _id: created!._id });
    h.clock.advance(HOUR);
    expect((await social('social_thanks', katya, [a])).outcome).toBe('unchanged');
    expect(await runFanout(h, first.job)).toBe('unchanged');
    expect(await docsOf(a)).toEqual([read]);
  });

  it('новое окно — новый документ: другой райд; «в сутки» — другой день по Минску', async () => {
    await social('social_riders_going', katya, [a]);
    await social('social_riders_going', katya, [a], { ...RIDE, id: uuidv7() });
    expect(await docsOf(a)).toHaveLength(2);

    // 20:59Z и 21:00Z — разные сутки Минска
    const evening = new Date('2026-10-22T20:59:00Z');
    const night = new Date('2026-10-22T21:00:00Z');
    await social('social_added', katya, [b], null, { at: evening });
    await social('social_added', petya, [b], null, { at: evening });
    await social('social_added', hidden, [b], null, { at: night });
    const added = await docsOf(b);
    expect(added.map((doc) => [doc.collapseKey, doc.actors])).toEqual(
      expect.arrayContaining([
        ['social:added:2026-10-22', [katya.userId, petya.userId]],
        ['social:added:2026-10-23', [hidden.userId]],
      ]),
    );
    expect(added).toHaveLength(2);
  });

  it('гонка двух первых событий окна с разными лицами — один документ, оба лица (10 окон)', async () => {
    const draft = (who: Rider, eventId: string, rideId: string) =>
      socialNoticeDraft({
        kind: 'social_riders_going',
        eventId,
        actor: who.userId,
        recipients: [a.userId],
        object: { ...RIDE, id: rideId },
      });
    const rides = Array.from({ length: 10 }, () => uuidv7());
    for (const rideId of rides) {
      const e1 = uuidv7At(h.clock.now());
      const e2 = uuidv7At(h.clock.now());
      const outcomes = await Promise.all([
        runFanout(h, fanoutJob(e1, draft(katya, e1, rideId))),
        runFanout(h, fanoutJob(e2, draft(petya, e2, rideId))),
      ]);
      expect(outcomes).toEqual(['written', 'written']);
    }
    const docs = await docsOf(a);
    expect(docs).toHaveLength(rides.length);
    for (const doc of docs) {
      expect([...doc.actors!].sort()).toEqual([katya.userId, petya.userId].sort());
    }
  });

  it('потолок SOCIAL_ACTORS_MAX: полный документ больше не меняется', async () => {
    await social('social_riders_going', katya, [a]);
    const [doc] = await docsOf(a);
    const full = [...Array.from({ length: SOCIAL_ACTORS_MAX - 1 }, () => uuidv7()), katya.userId];
    await notificationsDb(h).notifications.updateOne(
      { _id: doc!._id },
      { $set: { actors: full, readAt: h.clock.now() } },
    );
    const before = await notificationsDb(h).notifications.findOne({ _id: doc!._id });
    expect((await social('social_riders_going', petya, [a])).outcome).toBe('unchanged');
    expect(await docsOf(a)).toEqual([before]);
  });

  it('«Как прошёл райд?» — снимок без лиц, повтор окна — без изменений (RC-10)', async () => {
    await social('social_ride_ask', null, [a]);
    const [doc] = await docsOf(a);
    expect(doc).toMatchObject({
      title: 'Как прошёл райд?',
      body: '«Кофе-райд»: отметьте, что были.',
      collapseKey: `social:ask:${RIDE_ID}`,
      collapseSeq: 1,
    });
    expect(doc).not.toHaveProperty('actors');
    expect((await social('social_ride_ask', null, [a])).outcome).toBe('unchanged');
    expect(await docsOf(a)).toEqual([doc]);
  });
});

describe('список: имена при чтении (K10, K13)', () => {
  it('тексты таблицы v1 с текущими именами; «и ещё N»; цель rider — publicId показанного лица', async () => {
    await social('social_riders_going', hidden, [a]);
    await social('social_riders_going', katya, [a]);
    h.clock.advance(1000);
    await social('social_added', katya, [a], null);
    await social('social_added', hidden, [a], null);
    const items = await listOf(a);
    expect(
      items.map(({ kind, group, title, body, target }) => ({ kind, group, title, body, target })),
    ).toEqual([
      {
        kind: 'social_added',
        group: 'social',
        title: 'Вас добавили в свои',
        body: 'Катя Л. и ещё 1',
        target: { type: 'rider', publicId: katyaId },
      },
      {
        kind: 'social_riders_going',
        group: 'social',
        title: 'Свои идут',
        body: 'Катя Л. и ещё 1 · «Кофе-райд»',
        target: { type: 'ride', rideId: RIDE_ID },
      },
    ]);
    // userId действующих лиц в ответ не попадают
    const raw = await as(a, 'GET', NOTIFICATIONS);
    expect(JSON.stringify(raw.body)).not.toContain(katya.userId);
    expect(JSON.stringify(raw.body)).not.toContain(hidden.userId);
  });

  it('смена имени видна в созданном уведомлении; отзыв согласия — «Райдер», цель null', async () => {
    await social('social_invite_registered', katya, [a], null);
    expect((await listOf(a))[0]).toMatchObject({ body: 'Катя Л.' });
    await profilesCollection(h).updateOne(
      { _id: katya.userId },
      { $set: { publicName: 'Катерина' } },
    );
    expect((await listOf(a))[0]).toMatchObject({
      title: 'По вашей ссылке зарегистрировались',
      body: 'Катерина',
      target: { type: 'rider', publicId: katyaId },
    });
    await profilesCollection(h).updateOne(
      { _id: katya.userId },
      { $set: { showNameInResults: false } },
    );
    expect((await listOf(a))[0]).toMatchObject({ body: 'Райдер', target: null });
  });

  it('старый документ без actors и документы других групп — как раньше; один запрос имён на страницу', async () => {
    const old = await seedNotification(h, a.userId, {
      kind: 'social_thanks',
      group: 'social',
      title: 'Спасибо за компанию',
      body: 'Райдер · «Старый райд»',
    });
    const ride = await seedNotification(h, a.userId);
    await social('social_thanks', katya, [a]);
    await social('social_respect', petya, [a], { type: 'race', id: uuidv7(), title: 'Кольцо' });

    const names = h.app.get<RiderNameDirectory>(RIDER_NAMES, { strict: false });
    const spy = vi.spyOn(names, 'publicRiders');
    const items = await listOf(a);
    expect(spy).toHaveBeenCalledTimes(1);
    expect([...spy.mock.calls[0]![0]].sort()).toEqual([katya.userId, petya.userId].sort());
    const byId = new Map(items.map((item) => [item.id, item]));
    expect(byId.get(old._id)).toMatchObject({ body: old.body, target: old.target });
    expect(byId.get(ride._id)).toMatchObject({ title: ride.title, body: ride.body });
    expect(items.map((item) => item.body)).toEqual(
      expect.arrayContaining(['Катя Л. · «Кофе-райд»', 'Петя · «Кольцо»']),
    );

    // страница без действующих лиц — без запроса имён
    spy.mockClear();
    await listOf(b);
    expect(spy).not.toHaveBeenCalled();
  });
});

describe('push «Своих» (RC-5)', () => {
  it('текст собирается на момент отправки: переименование между записью и отправкой; цель rider в payload', async () => {
    await seedPushToken(h, a.userId, 'a1');
    await social('social_added', katya, [a], null);
    await profilesCollection(h).updateOne(
      { _id: katya.userId },
      { $set: { publicName: 'Катерина' } },
    );
    expect(await runPush(h, a.userId)).toBe('sent');
    expect(expo.delivered.map((entry) => entry.message)).toEqual([
      expect.objectContaining({
        title: 'Вас добавили в свои',
        body: 'Катерина',
        data: { target: { type: 'rider', publicId: katyaId } },
      }),
    ]);
    // в документе — по-прежнему запасной текст без имён
    expect((await docsOf(a))[0]).toMatchObject({ body: 'Райдер', target: null });
  });

  it('сбой запроса имён — push уходит запасным текстом, документ не застревает в sending (findings MEDIUM)', async () => {
    await seedPushToken(h, a.userId, 'a1');
    await social('social_added', katya, [a], null);
    const names = h.worker.get<RiderNameDirectory>(RIDER_NAMES, { strict: false });
    vi.spyOn(names, 'publicRiders').mockRejectedValue(new Error('profiles unavailable'));
    expect(await runPush(h, a.userId)).toBe('sent');
    expect(expo.delivered.map((entry) => entry.message)).toEqual([
      expect.objectContaining({
        title: 'Вас добавили в свои',
        body: 'Райдер',
        data: { target: null },
      }),
    ]);
    expect((await docsOf(a))[0]?.push).toMatchObject({ state: 'sent', claimId: null });
    expect(await runPush(h, a.userId)).toBe('none');
  });

  it('тихие часы → накопление → после конца интервала один push «… и ещё 1»', async () => {
    await seedPushToken(h, a.userId, 'a1');
    h.clock.advance(11 * HOUR); // 23:00 по Минску
    await social('social_riders_going', katya, [a]);
    const quietEnd = new Date('2026-10-23T05:00:00Z');
    expect((await docsOf(a))[0]?.push).toMatchObject({ state: 'pending', notBefore: quietEnd });
    h.clock.advance(HOUR);
    expect((await social('social_riders_going', petya, [a])).outcome).toBe('written');
    expect((await deliveryJobs(h)).map((job) => job.id)).toEqual([pushJobId(a.userId, quietEnd)]);
    h.clock.advance(quietEnd.getTime() - h.clock.now().getTime());
    expect(await runPush(h, a.userId)).toBe('sent');
    expect(expo.delivered.map((entry) => entry.message)).toEqual([
      expect.objectContaining({
        title: 'Свои идут',
        body: 'Петя и ещё 1 · «Кофе-райд»',
        data: { target: { type: 'ride', rideId: RIDE_ID } },
      }),
    ]);
  });

  it('push.social выключен — skipped/disabled, в центре уведомление есть', async () => {
    await seedPushToken(h, a.userId, 'a1');
    expect((await as(a, 'PUT', SOCIAL_SETTINGS, { push: false })).status).toBe(200);
    await social('social_thanks', katya, [a]);
    expect((await docsOf(a))[0]?.push).toMatchObject({ state: 'skipped', reason: 'disabled' });
    // выключили после записи — пропуск в момент отправки
    await social('social_thanks', katya, [b]);
    await seedPushToken(h, b.userId, 'b1');
    await as(b, 'PUT', SOCIAL_SETTINGS, { push: false });
    expect(await runPush(h, b.userId)).toBe('skipped');
    expect((await docsOf(b))[0]?.push).toMatchObject({ state: 'skipped', reason: 'disabled' });
    expect(expo.delivered).toHaveLength(0);
    expect(await listOf(a)).toHaveLength(1);
  });

  it('два отложенных — сводка без имён (имена не запрашиваются)', async () => {
    await seedPushToken(h, a.userId, 'a1');
    h.clock.advance(11 * HOUR);
    await social('social_thanks', katya, [a]);
    await social('social_added', petya, [a], null);
    const names = h.worker.get<RiderNameDirectory>(RIDER_NAMES, { strict: false });
    const spy = vi.spyOn(names, 'publicRiders');
    h.clock.advance(new Date('2026-10-23T05:00:00Z').getTime() - h.clock.now().getTime());
    expect(await runPush(h, a.userId)).toBe('sent');
    expect(spy).not.toHaveBeenCalled();
    expect(expo.delivered.map((entry) => entry.message)).toEqual([
      expect.objectContaining({
        title: 'Покатим',
        body: 'У вас 2 новых уведомления.',
        data: { target: null },
      }),
    ]);
  });
});

describe('стирание аккаунта (K10, K13)', () => {
  it('стёрт аккаунт действующего лица — у получателя «Райдер», цель null; уведомления стёртого удалены', async () => {
    await social('social_added', katya, [a], null);
    await social('social_thanks', a, [katya]);
    expect(await h.app.get(ProfileErasure, { strict: false }).erase(katya.userId)).toBe(true);
    const erased = await h.app.get(NotificationErasure, { strict: false }).erase(katya.userId);
    expect(erased.notifications).toBe(1);
    expect(await docsOf(katya)).toEqual([]);
    const [doc] = await docsOf(a);
    // id стёртого в чужих actors остаётся (K10)
    expect(doc?.actors).toEqual([katya.userId]);
    expect((await listOf(a))[0]).toMatchObject({
      title: 'Вас добавили в свои',
      body: 'Райдер',
      target: null,
    });
  });
});
