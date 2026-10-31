import {
  DEFAULT_NOTIFICATION_SETTINGS,
  NotificationPage,
  NotificationSettings,
  UnreadCount,
} from '@pokatim/contracts';
import { MongoTransactions, uuidv7 } from '@rkarakulov/api-kit/mongo';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { createHarness, DAY, type Harness, MINUTE } from '../../../test/harness';
import { bearer, call, type CallResult, collections, gate } from '../../../test/identity';
import {
  expoToken,
  NOTIFICATIONS,
  notificationsDb,
  seedNotification,
} from '../../../test/notifications';
import { rider, type Rider } from '../../../test/rides';
import { NotificationErasure } from './notification-erasure';
import { NOTIFICATIONS_POLICY } from './notifications.policy';
import { NotificationsRepository } from './notifications.repository';
import { PushTokens } from './push-tokens';

/**
 * HTTP центра уведомлений (шаг A, AC3, AC4): только свои, чужой id — 404, лимиты — 429, push-токены; порты
 * `PushTokens`/`NotificationErasure` для `account`. Уведомления — прямой вставкой (intake — шаг B).
 */
let h: Harness;
let a: Rider;
let b: Rider;
beforeAll(async () => {
  h = await createHarness();
});
beforeEach(async () => {
  await h.reset();
  a = await rider(h, 'a@example.by');
  b = await rider(h, 'b@example.by');
});
afterEach(() => {
  vi.restoreAllMocks();
});
afterAll(async () => {
  await h.close();
});

const as = (
  who: Rider,
  method: 'GET' | 'POST' | 'PUT',
  url: string,
  payload?: unknown,
): Promise<CallResult> => call(h, method, url, payload, bearer(who.token));

const listOf = async (who: Rider, query = '') => {
  const res = await as(who, 'GET', `${NOTIFICATIONS}${query}`);
  expect(res.status).toBe(200);
  return NotificationPage.parse(res.body);
};
const unreadOf = async (who: Rider) =>
  UnreadCount.parse((await as(who, 'GET', `${NOTIFICATIONS}/unread-count`)).body).count;

describe('без сессии', () => {
  it.each([
    ['GET', NOTIFICATIONS],
    ['GET', `${NOTIFICATIONS}/unread-count`],
    ['GET', `${NOTIFICATIONS}/settings`],
    ['PUT', `${NOTIFICATIONS}/settings`],
    ['GET', `${NOTIFICATIONS}/settings/events`],
    ['PUT', `${NOTIFICATIONS}/settings/events`],
    ['GET', `${NOTIFICATIONS}/settings/routes`],
    ['PUT', `${NOTIFICATIONS}/settings/routes`],
    ['GET', `${NOTIFICATIONS}/settings/achievements`],
    ['PUT', `${NOTIFICATIONS}/settings/achievements`],
    ['PUT', `${NOTIFICATIONS}/push-tokens`],
    ['POST', `${NOTIFICATIONS}/push-tokens/revoke`],
    ['POST', `${NOTIFICATIONS}/read-all`],
    ['POST', `${NOTIFICATIONS}/${uuidv7()}/read`],
  ] as const)('%s %s — 401', async (method, url) => {
    const res = await call(h, method, url, {});
    expect(res.status).toBe(401);
    expect(res.body).toMatchObject({ code: 'UNAUTHORIZED' });
  });
});

describe('список и счётчик', () => {
  it('только свои, новые сверху; ответ — явный список полей; no-store', async () => {
    const older = await seedNotification(h, a.userId, {
      createdAt: new Date(h.clock.now().getTime() - MINUTE),
    });
    const newer = await seedNotification(h, a.userId, { readAt: h.clock.now() });
    await seedNotification(h, b.userId);

    const res = await as(a, 'GET', NOTIFICATIONS);
    expect(res.headers['cache-control']).toBe('no-store');
    const page = NotificationPage.parse(res.body);
    expect(page.items.map((item) => item.id)).toEqual([newer._id, older._id]);
    expect(page.nextCursor).toBeNull();
    const raw = (res.body as { items: Record<string, unknown>[] }).items[1];
    expect(raw).toEqual({
      id: older._id,
      kind: 'ride_joined',
      group: 'rides',
      title: 'Новый участник',
      body: '«Кофе-райд»: участников — 2.',
      createdAt: older.createdAt.toISOString(),
      read: false,
      target: older.target,
    });
    expect(page.items[0]?.read).toBe(true);
  });

  it('курсор: страницы по limit без пропусков и повторов (одинаковое время — по id)', async () => {
    const ids: string[] = [];
    for (let i = 0; i < 5; i++) ids.push((await seedNotification(h, a.userId))._id);
    // порядок сервера — _id по убыванию; uuidv7 в пределах одной миллисекунды не монотонен, порядок вставки не тот
    const expected = [...ids].sort().reverse();
    const first = await listOf(a, '?limit=2');
    expect(first.items.map((item) => item.id)).toEqual(expected.slice(0, 2));
    const second = await listOf(a, `?limit=2&cursor=${first.nextCursor}`);
    expect(second.items.map((item) => item.id)).toEqual(expected.slice(2, 4));
    const third = await listOf(a, `?limit=2&cursor=${second.nextCursor}`);
    expect(third.items.map((item) => item.id)).toEqual(expected.slice(4));
    expect(third.nextCursor).toBeNull();
  });

  it('битый курсор и лишние ключи — 400', async () => {
    expect((await as(a, 'GET', `${NOTIFICATIONS}?cursor=%24%24`)).status).toBe(400);
    expect((await as(a, 'GET', `${NOTIFICATIONS}?userId=${b.userId}`)).status).toBe(400);
    expect((await as(a, 'GET', `${NOTIFICATIONS}?limit=51`)).status).toBe(400);
  });

  it('истёкшее (expireAt ≤ now) не видно ни в списке, ни в счётчике', async () => {
    await seedNotification(h, a.userId, { expireAt: h.clock.now() });
    const live = await seedNotification(h, a.userId);
    expect((await listOf(a)).items.map((item) => item.id)).toEqual([live._id]);
    expect(await unreadOf(a)).toBe(1);
  });

  it('unread-count: только свои непрочитанные, потолок 100', async () => {
    await seedNotification(h, a.userId);
    await seedNotification(h, a.userId, { readAt: h.clock.now() });
    await seedNotification(h, b.userId);
    expect(await unreadOf(a)).toBe(1);

    const docs = Array.from({ length: 105 }, () => ({
      _id: uuidv7(),
      userId: b.userId,
      kind: 'ride_joined' as const,
      group: 'rides' as const,
      title: 't',
      body: 'b',
      target: null,
      sourceEventId: uuidv7(),
      createdAt: h.clock.now(),
      readAt: null,
      expireAt: new Date(h.clock.now().getTime() + DAY),
      push: {
        state: 'skipped' as const,
        notBefore: h.clock.now(),
        claimId: null,
        claimedUntil: null,
        sentAt: null,
        reason: null,
      },
      email: null,
    }));
    await notificationsDb(h).notifications.insertMany(docs);
    expect(await unreadOf(b)).toBe(100);
  });
});

describe('прочтение', () => {
  it('своё — 204, readAt; повтор — 204 без смены readAt', async () => {
    const doc = await seedNotification(h, a.userId);
    const first = await as(a, 'POST', `${NOTIFICATIONS}/${doc._id}/read`, {});
    expect(first.status).toBe(204);
    const readAt = h.clock.now();
    expect((await notificationsDb(h).notifications.findOne({ _id: doc._id }))?.readAt).toEqual(
      readAt,
    );
    h.clock.advance(MINUTE);
    expect((await as(a, 'POST', `${NOTIFICATIONS}/${doc._id}/read`, {})).status).toBe(204);
    expect((await notificationsDb(h).notifications.findOne({ _id: doc._id }))?.readAt).toEqual(
      readAt,
    );
    expect(await unreadOf(a)).toBe(0);
  });

  it('чужое — 404 и не меняется; неизвестное и истёкшее — 404; не UUID — 400', async () => {
    const foreign = await seedNotification(h, b.userId);
    const res = await as(a, 'POST', `${NOTIFICATIONS}/${foreign._id}/read`, {});
    expect(res.status).toBe(404);
    expect(res.body).toMatchObject({ code: 'NOT_FOUND' });
    expect((await notificationsDb(h).notifications.findOne({ _id: foreign._id }))?.readAt).toBe(
      null,
    );
    expect(await unreadOf(b)).toBe(1);

    expect((await as(a, 'POST', `${NOTIFICATIONS}/${uuidv7()}/read`, {})).status).toBe(404);
    const expired = await seedNotification(h, a.userId, { expireAt: h.clock.now() });
    expect((await as(a, 'POST', `${NOTIFICATIONS}/${expired._id}/read`, {})).status).toBe(404);
    expect((await as(a, 'POST', `${NOTIFICATIONS}/not-a-uuid/read`, {})).status).toBe(400);
  });

  it('read-all — только свои', async () => {
    await seedNotification(h, a.userId);
    await seedNotification(h, a.userId);
    await seedNotification(h, b.userId);
    expect((await as(a, 'POST', `${NOTIFICATIONS}/read-all`, {})).status).toBe(204);
    expect(await unreadOf(a)).toBe(0);
    expect(await unreadOf(b)).toBe(1);
  });

  it('лимит notifications-read (общий для read и read-all): сверх — 429 + retryAfterSec', async () => {
    const doc = await seedNotification(h, a.userId);
    for (let i = 0; i < NOTIFICATIONS_POLICY.readLimit.limit; i++) {
      expect((await as(a, 'POST', `${NOTIFICATIONS}/read-all`, {})).status).toBe(204);
    }
    const limited = await as(a, 'POST', `${NOTIFICATIONS}/${doc._id}/read`, {});
    expect(limited.status).toBe(429);
    expect(limited.body).toMatchObject({
      code: 'RATE_LIMITED',
      details: { retryAfterSec: expect.any(Number) },
    });
    // лимит — по пользователю
    expect((await as(b, 'POST', `${NOTIFICATIONS}/read-all`, {})).status).toBe(204);
  });
});

describe('настройки', () => {
  const custom: NotificationSettings = {
    push: { races: false, disputes: true, rides: true },
    email: { disputes: false, rides: true },
    quietHours: { enabled: true, startHour: 23, endHour: 7 },
  };

  it('нет документа — умолчания; PUT сохраняет и возвращает; у другого — свои умолчания', async () => {
    const initial = await as(a, 'GET', `${NOTIFICATIONS}/settings`);
    expect(initial.status).toBe(200);
    expect(initial.headers['cache-control']).toBe('no-store');
    expect(initial.body).toEqual(DEFAULT_NOTIFICATION_SETTINGS);

    const saved = await as(a, 'PUT', `${NOTIFICATIONS}/settings`, custom);
    expect(saved.status).toBe(200);
    expect(saved.body).toEqual(custom);
    expect((await as(a, 'GET', `${NOTIFICATIONS}/settings`)).body).toEqual(custom);
    expect((await as(b, 'GET', `${NOTIFICATIONS}/settings`)).body).toEqual(
      DEFAULT_NOTIFICATION_SETTINGS,
    );
    expect(await notificationsDb(h).settings.findOne({ _id: a.userId })).toEqual({
      _id: a.userId,
      ...custom,
      updatedAt: h.clock.now(),
    });
  });

  it('начало = концу — 400 INVALID на quietHours.endHour; неполный объект и лишние ключи — 400', async () => {
    const res = await as(a, 'PUT', `${NOTIFICATIONS}/settings`, {
      ...custom,
      quietHours: { enabled: true, startHour: 8, endHour: 8 },
    });
    expect(res.status).toBe(400);
    expect(res.body).toMatchObject({
      code: 'VALIDATION_FAILED',
      details: { fields: [{ path: 'quietHours.endHour', code: 'INVALID' }] },
    });
    expect((await as(a, 'PUT', `${NOTIFICATIONS}/settings`, { push: custom.push })).status).toBe(
      400,
    );
    expect(
      (await as(a, 'PUT', `${NOTIFICATIONS}/settings`, { ...custom, userId: b.userId })).status,
    ).toBe(400);
    expect(await notificationsDb(h).settings.countDocuments()).toBe(0);
  });

  it('лимит notifications-settings: сверх — 429', async () => {
    for (let i = 0; i < NOTIFICATIONS_POLICY.settingsLimit.limit; i++) {
      expect((await as(a, 'PUT', `${NOTIFICATIONS}/settings`, custom)).status).toBe(200);
    }
    const limited = await as(a, 'PUT', `${NOTIFICATIONS}/settings`, custom);
    expect(limited.status).toBe(429);
    expect(limited.body).toMatchObject({ code: 'RATE_LIMITED' });
  });
});

describe('настройки «Мероприятия» (подресурс, RC-D1)', () => {
  const EVENTS = `${NOTIFICATIONS}/settings/events`;
  const custom: NotificationSettings = {
    push: { races: false, disputes: true, rides: true },
    email: { disputes: false, rides: true },
    quietHours: { enabled: true, startHour: 23, endHour: 7 },
  };

  it('умолчания — всё включено; PUT сохраняет в документ настроек; у другого — свои умолчания; no-store', async () => {
    const initial = await as(a, 'GET', EVENTS);
    expect(initial.status).toBe(200);
    expect(initial.headers['cache-control']).toBe('no-store');
    expect(initial.body).toEqual({ push: true, email: true });
    const saved = await as(a, 'PUT', EVENTS, { push: false, email: true });
    expect(saved.status).toBe(200);
    expect(saved.body).toEqual({ push: false, email: true });
    expect((await as(a, 'GET', EVENTS)).body).toEqual({ push: false, email: true });
    expect((await as(b, 'GET', EVENTS)).body).toEqual({ push: true, email: true });
    // основные настройки при этом — умолчания и прежней формы
    expect((await as(a, 'GET', `${NOTIFICATIONS}/settings`)).body).toEqual(
      DEFAULT_NOTIFICATION_SETTINGS,
    );
    expect(await notificationsDb(h).settings.findOne({ _id: a.userId })).toMatchObject({
      push: { events: false },
      email: { events: true },
    });
  });

  it('старый PUT /settings не стирает «Мероприятия»; ответ /settings — ровно прежние ключи (старые сборки)', async () => {
    await as(a, 'PUT', EVENTS, { push: false, email: false });
    const saved = await as(a, 'PUT', `${NOTIFICATIONS}/settings`, custom);
    expect(saved.status).toBe(200);
    expect(saved.body).toEqual(custom);
    const read = await as(a, 'GET', `${NOTIFICATIONS}/settings`);
    // строгая схема уже установленных сборок разбирает ответ
    expect(NotificationSettings.parse(read.body)).toEqual(custom);
    expect((await as(a, 'GET', EVENTS)).body).toEqual({ push: false, email: false });
    // и обратно: PUT подресурса не трогает основные тумблеры
    await as(a, 'PUT', EVENTS, { push: true, email: false });
    expect((await as(a, 'GET', `${NOTIFICATIONS}/settings`)).body).toEqual(custom);
  });

  it('лишний ключ, неполный объект, не boolean — 400; лимит общий с /settings — 429', async () => {
    for (const body of [
      { push: true },
      { push: true, email: true, sms: true },
      { push: 1, email: true },
    ]) {
      const res = await as(a, 'PUT', EVENTS, body);
      expect(res.status).toBe(400);
      expect(res.body).toMatchObject({ code: 'VALIDATION_FAILED' });
    }
    expect(await notificationsDb(h).settings.countDocuments()).toBe(0);
    for (let i = 0; i < NOTIFICATIONS_POLICY.settingsLimit.limit - 1; i++) {
      expect((await as(a, 'PUT', `${NOTIFICATIONS}/settings`, custom)).status).toBe(200);
    }
    expect((await as(a, 'PUT', EVENTS, { push: true, email: true })).status).toBe(200);
    const limited = await as(a, 'PUT', EVENTS, { push: true, email: true });
    expect(limited.status).toBe(429);
    expect(limited.body).toMatchObject({ code: 'RATE_LIMITED' });
  });
});

describe('настройки «Достижения» (подресурс, только push, achievements-push P4)', () => {
  const ACHIEVEMENTS = `${NOTIFICATIONS}/settings/achievements`;
  const custom: NotificationSettings = {
    push: { races: false, disputes: true, rides: false },
    email: { disputes: false, rides: true },
    quietHours: { enabled: true, startHour: 23, endHour: 7 },
  };

  it('нет документа и нет поля — включено (без наследования от «Райдов»); no-store', async () => {
    const initial = await as(a, 'GET', ACHIEVEMENTS);
    expect(initial.status).toBe(200);
    expect(initial.headers['cache-control']).toBe('no-store');
    expect(initial.body).toEqual({ push: true });
    await as(a, 'PUT', `${NOTIFICATIONS}/settings`, custom);
    expect((await as(a, 'GET', ACHIEVEMENTS)).body).toEqual({ push: true });
  });

  it('PUT пишет только push.achievements; /settings — прежняя форма; PUT /settings старой формы его не стирает', async () => {
    await as(a, 'PUT', `${NOTIFICATIONS}/settings`, custom);
    const saved = await as(a, 'PUT', ACHIEVEMENTS, { push: false });
    expect(saved.status).toBe(200);
    expect(saved.body).toEqual({ push: false });
    expect((await as(a, 'GET', ACHIEVEMENTS)).body).toEqual({ push: false });
    expect((await as(a, 'GET', `${NOTIFICATIONS}/settings`)).body).toEqual(custom);
    await as(a, 'PUT', `${NOTIFICATIONS}/settings`, {
      ...custom,
      push: { ...custom.push, rides: true },
    });
    expect((await as(a, 'GET', ACHIEVEMENTS)).body).toEqual({ push: false });
    expect((await as(b, 'GET', ACHIEVEMENTS)).body).toEqual({ push: true });
  });

  it('PUT без документа — умолчания основных настроек ($setOnInsert): /settings — полный объект', async () => {
    expect((await as(a, 'PUT', ACHIEVEMENTS, { push: false })).status).toBe(200);
    expect((await as(a, 'GET', `${NOTIFICATIONS}/settings`)).body).toEqual(
      DEFAULT_NOTIFICATION_SETTINGS,
    );
  });

  it('лишний ключ, пустой объект, не boolean — 400; лимит общий с /settings — 429', async () => {
    for (const body of [{}, { push: true, email: true }, { push: 1 }]) {
      const res = await as(a, 'PUT', ACHIEVEMENTS, body);
      expect(res.status).toBe(400);
      expect(res.body).toMatchObject({ code: 'VALIDATION_FAILED' });
    }
    for (let i = 0; i < NOTIFICATIONS_POLICY.settingsLimit.limit; i++) {
      expect((await as(a, 'PUT', ACHIEVEMENTS, { push: true })).status).toBe(200);
    }
    const limited = await as(a, 'PUT', `${NOTIFICATIONS}/settings`, custom);
    expect(limited.status).toBe(429);
    expect(limited.body).toMatchObject({ code: 'RATE_LIMITED' });
  });
});

describe('настройки «Маршруты» (подресурс, только push)', () => {
  const ROUTES = `${NOTIFICATIONS}/settings/routes`;
  const custom: NotificationSettings = {
    push: { races: false, disputes: true, rides: true },
    email: { disputes: false, rides: true },
    quietHours: { enabled: true, startHour: 23, endHour: 7 },
  };

  it('нет документа — push включён; нет поля push.routes — значение push.rides; no-store', async () => {
    const initial = await as(a, 'GET', ROUTES);
    expect(initial.status).toBe(200);
    expect(initial.headers['cache-control']).toBe('no-store');
    expect(initial.body).toEqual({ push: true });
    await as(a, 'PUT', `${NOTIFICATIONS}/settings`, {
      ...custom,
      push: { ...custom.push, rides: false },
    });
    expect((await as(a, 'GET', ROUTES)).body).toEqual({ push: false });
    expect((await as(b, 'GET', ROUTES)).body).toEqual({ push: true });
  });

  it('PUT пишет только push.routes; /settings — прежняя форма и значения; PUT /settings его не стирает', async () => {
    await as(a, 'PUT', `${NOTIFICATIONS}/settings`, custom);
    await as(a, 'PUT', `${NOTIFICATIONS}/settings/events`, { push: false, email: true });
    const saved = await as(a, 'PUT', ROUTES, { push: false });
    expect(saved.status).toBe(200);
    expect(saved.body).toEqual({ push: false });
    expect((await as(a, 'GET', ROUTES)).body).toEqual({ push: false });
    const read = await as(a, 'GET', `${NOTIFICATIONS}/settings`);
    expect(NotificationSettings.parse(read.body)).toEqual(custom);
    expect(read.body).toEqual(custom);
    expect((await as(a, 'GET', `${NOTIFICATIONS}/settings/events`)).body).toEqual({
      push: false,
      email: true,
    });
    expect(await notificationsDb(h).settings.findOne({ _id: a.userId })).toEqual({
      _id: a.userId,
      push: { ...custom.push, events: false, routes: false },
      email: { ...custom.email, events: true },
      quietHours: custom.quietHours,
      updatedAt: h.clock.now(),
    });
    // повторное сохранение основных настроек «Маршруты» не трогает
    await as(a, 'PUT', `${NOTIFICATIONS}/settings`, {
      ...custom,
      push: { ...custom.push, rides: true },
    });
    expect((await as(a, 'GET', ROUTES)).body).toEqual({ push: false });
  });

  it('PUT без документа — умолчания основных настроек ($setOnInsert): /settings — полный объект', async () => {
    expect((await as(a, 'PUT', ROUTES, { push: true })).status).toBe(200);
    expect((await as(a, 'GET', `${NOTIFICATIONS}/settings`)).body).toEqual(
      DEFAULT_NOTIFICATION_SETTINGS,
    );
    expect(await notificationsDb(h).settings.findOne({ _id: a.userId })).toMatchObject({
      push: { ...DEFAULT_NOTIFICATION_SETTINGS.push, routes: true },
      email: DEFAULT_NOTIFICATION_SETTINGS.email,
      quietHours: DEFAULT_NOTIFICATION_SETTINGS.quietHours,
    });
  });

  it('лишний ключ, пустой объект, не boolean — 400; лимит общий с /settings — 429', async () => {
    for (const body of [{}, { push: true, email: true }, { push: 1 }]) {
      const res = await as(a, 'PUT', ROUTES, body);
      expect(res.status).toBe(400);
      expect(res.body).toMatchObject({ code: 'VALIDATION_FAILED' });
    }
    expect(await notificationsDb(h).settings.countDocuments()).toBe(0);
    for (let i = 0; i < NOTIFICATIONS_POLICY.settingsLimit.limit - 1; i++) {
      expect((await as(a, 'PUT', `${NOTIFICATIONS}/settings`, custom)).status).toBe(200);
    }
    expect((await as(a, 'PUT', ROUTES, { push: true })).status).toBe(200);
    const limited = await as(a, 'PUT', ROUTES, { push: true });
    expect(limited.status).toBe(429);
    expect(limited.body).toMatchObject({ code: 'RATE_LIMITED' });
  });
});

describe('push-токены', () => {
  const tokens = () =>
    notificationsDb(h)
      .pushTokens.find({}, { projection: { _id: 0, token: 1, userId: 1, platform: 1 } })
      .sort({ token: 1 })
      .toArray();

  it('регистрация — 204; повтор обновляет платформу и время без второго документа', async () => {
    const token = expoToken('one');
    const res = await as(a, 'PUT', `${NOTIFICATIONS}/push-tokens`, { token, platform: 'ios' });
    expect(res.status).toBe(204);
    expect(await tokens()).toEqual([{ token, userId: a.userId, platform: 'ios' }]);

    h.clock.advance(MINUTE);
    await as(a, 'PUT', `${NOTIFICATIONS}/push-tokens`, { token, platform: 'android' });
    const docs = await notificationsDb(h).pushTokens.find().toArray();
    expect(docs).toHaveLength(1);
    expect(docs[0]).toMatchObject({ platform: 'android', updatedAt: h.clock.now() });
    expect(docs[0]?.createdAt.getTime()).toBe(h.clock.now().getTime() - MINUTE);
  });

  it('токен привязан к сессии запроса (доставка — только живым сессиям)', async () => {
    const token = expoToken('bound');
    await as(a, 'PUT', `${NOTIFICATIONS}/push-tokens`, { token, platform: 'ios' });
    const session = await collections(h).sessions.findOne({ userId: a.userId });
    expect(await notificationsDb(h).pushTokens.findOne({ token })).toMatchObject({
      sessionId: session!._id,
    });
  });

  it('тот же токен другим аккаунтом — переходит к нему (устройство одно)', async () => {
    const token = expoToken('shared');
    await as(a, 'PUT', `${NOTIFICATIONS}/push-tokens`, { token, platform: 'ios' });
    await as(b, 'PUT', `${NOTIFICATIONS}/push-tokens`, { token, platform: 'ios' });
    expect(await tokens()).toEqual([{ token, userId: b.userId, platform: 'ios' }]);
  });

  it('поздняя регистрация старой сессии (выход, вход другим аккаунтом) не перехватывает токен новой', async () => {
    const token = expoToken('late');
    // запрос A прошёл `AuthGuard` и остановлен перед записью
    const paused = gate();
    const original = NotificationsRepository.prototype.registerToken;
    vi.spyOn(NotificationsRepository.prototype, 'registerToken').mockImplementationOnce(
      async function (this: NotificationsRepository, ...args) {
        await paused.wait();
        return original.apply(this, args);
      },
    );
    const late = as(a, 'PUT', `${NOTIFICATIONS}/push-tokens`, { token, platform: 'ios' });
    await paused.reached;
    await collections(h).sessions.updateMany(
      { userId: a.userId },
      { $set: { revokedAt: h.clock.now(), revokedReason: 'signed_out' } },
    );
    // на устройстве вошёл B (его сессия новее) и зарегистрировал тот же токен
    expect(
      (await as(b, 'PUT', `${NOTIFICATIONS}/push-tokens`, { token, platform: 'ios' })).status,
    ).toBe(204);
    paused.open();
    expect((await late).status).toBe(204);
    const session = await collections(h).sessions.findOne({ userId: b.userId });
    expect(await notificationsDb(h).pushTokens.findOne({ token })).toMatchObject({
      userId: b.userId,
      sessionId: session!._id,
    });
  });

  it('параллельная первая регистрация одного токена — один документ', async () => {
    const token = expoToken('race');
    const results = await Promise.all(
      Array.from({ length: 4 }, () =>
        as(a, 'PUT', `${NOTIFICATIONS}/push-tokens`, { token, platform: 'ios' }),
      ),
    );
    expect(results.map((res) => res.status)).toEqual([204, 204, 204, 204]);
    expect(await notificationsDb(h).pushTokens.countDocuments()).toBe(1);
  });

  it('11-й токен вытесняет старейший по времени регистрации', async () => {
    for (let i = 0; i < 11; i++) {
      h.clock.advance(MINUTE);
      expect(
        (
          await as(a, 'PUT', `${NOTIFICATIONS}/push-tokens`, {
            token: expoToken(`t${String(i).padStart(2, '0')}`),
            platform: 'android',
          })
        ).status,
      ).toBe(204);
    }
    const left = (await tokens()).map((doc) => doc.token);
    expect(left).toHaveLength(NOTIFICATIONS_POLICY.maxTokensPerUser);
    expect(left).not.toContain(expoToken('t00'));
    expect(left).toContain(expoToken('t10'));
  });

  it('снятие своего — удалён; чужого и неизвестного — 204 без эффекта', async () => {
    const mine = expoToken('mine');
    const theirs = expoToken('theirs');
    await as(a, 'PUT', `${NOTIFICATIONS}/push-tokens`, { token: mine, platform: 'ios' });
    await as(b, 'PUT', `${NOTIFICATIONS}/push-tokens`, { token: theirs, platform: 'ios' });

    expect(
      (await as(a, 'POST', `${NOTIFICATIONS}/push-tokens/revoke`, { token: theirs })).status,
    ).toBe(204);
    expect(
      (await as(a, 'POST', `${NOTIFICATIONS}/push-tokens/revoke`, { token: expoToken('none') }))
        .status,
    ).toBe(204);
    expect(await tokens()).toEqual([
      { token: mine, userId: a.userId, platform: 'ios' },
      { token: theirs, userId: b.userId, platform: 'ios' },
    ]);
    expect(
      (await as(a, 'POST', `${NOTIFICATIONS}/push-tokens/revoke`, { token: mine })).status,
    ).toBe(204);
    expect(await tokens()).toEqual([{ token: theirs, userId: b.userId, platform: 'ios' }]);
  });

  it('невалидный токен, платформа web, операторный объект — 400', async () => {
    const put = (body: unknown) => as(a, 'PUT', `${NOTIFICATIONS}/push-tokens`, body);
    expect((await put({ token: 'garbage', platform: 'ios' })).status).toBe(400);
    expect((await put({ token: expoToken('w'), platform: 'web' })).status).toBe(400);
    expect(
      (await as(a, 'POST', `${NOTIFICATIONS}/push-tokens/revoke`, { token: { $ne: null } })).status,
    ).toBe(400);
    expect(await tokens()).toEqual([]);
  });

  it('лимит notifications-push-token (общий для регистрации и снятия): сверх — 429', async () => {
    const token = expoToken('limit');
    for (let i = 0; i < NOTIFICATIONS_POLICY.pushTokenLimit.limit; i++) {
      const res =
        i % 2 === 0
          ? await as(a, 'PUT', `${NOTIFICATIONS}/push-tokens`, { token, platform: 'ios' })
          : await as(a, 'POST', `${NOTIFICATIONS}/push-tokens/revoke`, { token });
      expect(res.status).toBe(204);
    }
    const limited = await as(a, 'PUT', `${NOTIFICATIONS}/push-tokens`, { token, platform: 'ios' });
    expect(limited.status).toBe(429);
    expect(limited.body).toMatchObject({ code: 'RATE_LIMITED' });
  });
});

describe('порты для account', () => {
  it('PushTokens.revokeAllOf — все токены пользователя в транзакции; откат транзакции — токены остаются', async () => {
    await as(a, 'PUT', `${NOTIFICATIONS}/push-tokens`, { token: expoToken('a1'), platform: 'ios' });
    await as(a, 'PUT', `${NOTIFICATIONS}/push-tokens`, { token: expoToken('a2'), platform: 'ios' });
    await as(b, 'PUT', `${NOTIFICATIONS}/push-tokens`, { token: expoToken('b1'), platform: 'ios' });
    const ports = h.app.get(PushTokens, { strict: false });
    const transactions = h.app.get(MongoTransactions, { strict: false });

    await expect(
      transactions.run(async (tx) => {
        await ports.revokeAllOf(tx, a.userId);
        throw new Error('rollback');
      }),
    ).rejects.toThrow('rollback');
    expect(await notificationsDb(h).pushTokens.countDocuments({ userId: a.userId })).toBe(2);

    const revoked = await transactions.run((tx) => ports.revokeAllOf(tx, a.userId));
    expect(revoked).toBe(2);
    expect(await notificationsDb(h).pushTokens.countDocuments({ userId: a.userId })).toBe(0);
    expect(await notificationsDb(h).pushTokens.countDocuments({ userId: b.userId })).toBe(1);
  });

  it('NotificationErasure.erase — уведомления, настройки, токены и их тикеты; чужое цело; повтор — нули', async () => {
    await seedNotification(h, a.userId);
    await seedNotification(h, a.userId);
    const foreign = await seedNotification(h, b.userId);
    await as(a, 'PUT', `${NOTIFICATIONS}/settings`, DEFAULT_NOTIFICATION_SETTINGS);
    await as(a, 'PUT', `${NOTIFICATIONS}/push-tokens`, { token: expoToken('e1'), platform: 'ios' });
    await as(b, 'PUT', `${NOTIFICATIONS}/push-tokens`, { token: expoToken('e2'), platform: 'ios' });
    const db = notificationsDb(h);
    const ticket = (tokenId: string, userId: string) => ({
      _id: uuidv7(),
      ticketId: uuidv7(),
      tokenId,
      userId,
      createdAt: h.clock.now(),
      expireAt: new Date(h.clock.now().getTime() + DAY),
    });
    const tokenA = await db.pushTokens.findOne({ userId: a.userId });
    const tokenB = await db.pushTokens.findOne({ userId: b.userId });
    await db.pushTickets.insertMany([
      ticket(tokenA?._id ?? '', a.userId),
      ticket(tokenB?._id ?? '', b.userId),
    ]);

    const erasure = h.app.get(NotificationErasure, { strict: false });
    expect(await erasure.erase(a.userId)).toEqual({
      notifications: 2,
      settings: 1,
      tokens: 1,
      tickets: 1,
    });
    expect(await db.notifications.find().toArray()).toEqual([foreign]);
    expect(await db.settings.countDocuments()).toBe(0);
    expect(await db.pushTokens.countDocuments()).toBe(1);
    expect(await db.pushTickets.countDocuments({ tokenId: tokenB?._id })).toBe(1);
    expect(await erasure.erase(a.userId)).toEqual({
      notifications: 0,
      settings: 0,
      tokens: 0,
      tickets: 0,
    });
  });
});
