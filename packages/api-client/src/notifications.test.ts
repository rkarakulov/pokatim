import { describe, expect, it } from 'vitest';

import { ApiHttpError, createApiClient } from './index.ts';

interface Call {
  url: string;
  method: string | undefined;
  authorization: string | null;
  body: unknown;
}

const ID = '01890a5d-ac96-774b-bcce-b302099a8057';
const TOKEN = 'ExponentPushToken[xxxxxxxxxxxxxxxxxxxxxx]';
const SETTINGS = {
  push: { races: true, disputes: false, rides: true },
  email: { disputes: true, rides: false },
  quietHours: { enabled: true, startHour: 23, endHour: 7 },
};

/** fetch-заглушка: `null` — пустое тело (204). */
function client(status: number, response: unknown) {
  const calls: Call[] = [];
  const fetchImpl = ((url: string, init?: RequestInit) => {
    calls.push({
      url,
      method: init?.method,
      authorization: new Headers(init?.headers).get('authorization'),
      body: typeof init?.body === 'string' ? JSON.parse(init.body) : undefined,
    });
    const body = response === null ? null : JSON.stringify(response);
    return Promise.resolve(new Response(body, { status }));
  }) as typeof fetch;
  return { calls, api: createApiClient({ baseUrl: 'https://api.test', fetchImpl }) };
}

describe('api-client: уведомления', () => {
  it('listNotifications — GET с курсором и лимитом, Bearer; незнакомая цель — unknown', async () => {
    const { calls, api } = client(200, {
      items: [
        {
          id: ID,
          kind: 'ride_joined',
          group: 'rides',
          title: 'Новый участник',
          body: '«Райд»: участников — 3.',
          createdAt: '2026-10-22T09:00:00.000Z',
          read: false,
          target: { type: 'season', seasonId: ID },
        },
      ],
      nextCursor: 'next',
    });
    const page = await api.listNotifications('t', { cursor: 'c1', limit: 10 });
    expect(page.items[0]?.target).toEqual({ type: 'unknown' });
    expect(page.nextCursor).toBe('next');
    expect(calls).toEqual([
      {
        url: 'https://api.test/v1/notifications?cursor=c1&limit=10',
        method: 'GET',
        authorization: 'Bearer t',
        body: undefined,
      },
    ]);
  });

  it('getUnreadCount — GET unread-count', async () => {
    const { calls, api } = client(200, { count: 7 });
    await expect(api.getUnreadCount('t')).resolves.toEqual({ count: 7 });
    expect(calls[0]).toMatchObject({
      url: 'https://api.test/v1/notifications/unread-count',
      method: 'GET',
      authorization: 'Bearer t',
    });
  });

  it('markNotificationRead и markAllNotificationsRead — POST, 204 → undefined', async () => {
    const { calls, api } = client(204, null);
    await expect(api.markNotificationRead('t', ID)).resolves.toBeUndefined();
    await expect(api.markAllNotificationsRead('t')).resolves.toBeUndefined();
    expect(calls.map(({ url, method, authorization }) => ({ url, method, authorization }))).toEqual(
      [
        {
          url: `https://api.test/v1/notifications/${ID}/read`,
          method: 'POST',
          authorization: 'Bearer t',
        },
        {
          url: 'https://api.test/v1/notifications/read-all',
          method: 'POST',
          authorization: 'Bearer t',
        },
      ],
    );
  });

  it('настройки — GET и PUT полного объекта', async () => {
    const { calls, api } = client(200, SETTINGS);
    await expect(api.getNotificationSettings('t')).resolves.toEqual(SETTINGS);
    await expect(api.updateNotificationSettings('t', SETTINGS)).resolves.toEqual(SETTINGS);
    expect(calls.map(({ url, method, body }) => ({ url, method, body }))).toEqual([
      { url: 'https://api.test/v1/notifications/settings', method: 'GET', body: undefined },
      { url: 'https://api.test/v1/notifications/settings', method: 'PUT', body: SETTINGS },
    ]);
  });

  it('настройки «Мероприятия» — подресурс GET и PUT (RC-D1)', async () => {
    const { calls, api } = client(200, { push: false, email: true });
    await expect(api.getEventNotificationSettings('t')).resolves.toEqual({
      push: false,
      email: true,
    });
    await expect(
      api.updateEventNotificationSettings('t', { push: false, email: true }),
    ).resolves.toEqual({ push: false, email: true });
    expect(
      calls.map(({ url, method, body, authorization }) => ({ url, method, body, authorization })),
    ).toEqual([
      {
        url: 'https://api.test/v1/notifications/settings/events',
        method: 'GET',
        body: undefined,
        authorization: 'Bearer t',
      },
      {
        url: 'https://api.test/v1/notifications/settings/events',
        method: 'PUT',
        body: { push: false, email: true },
        authorization: 'Bearer t',
      },
    ]);
  });

  it('настройки «Маршруты» — подресурс GET и PUT, только push', async () => {
    const { calls, api } = client(200, { push: false });
    await expect(api.getRouteNotificationSettings('t')).resolves.toEqual({ push: false });
    await expect(api.updateRouteNotificationSettings('t', { push: false })).resolves.toEqual({
      push: false,
    });
    expect(
      calls.map(({ url, method, body, authorization }) => ({ url, method, body, authorization })),
    ).toEqual([
      {
        url: 'https://api.test/v1/notifications/settings/routes',
        method: 'GET',
        body: undefined,
        authorization: 'Bearer t',
      },
      {
        url: 'https://api.test/v1/notifications/settings/routes',
        method: 'PUT',
        body: { push: false },
        authorization: 'Bearer t',
      },
    ]);
  });

  it('push-токены — PUT регистрации и POST снятия, 204', async () => {
    const { calls, api } = client(204, null);
    await api.registerPushToken('t', { token: TOKEN, platform: 'android' });
    await api.revokePushToken('t', { token: TOKEN });
    expect(calls).toEqual([
      {
        url: 'https://api.test/v1/notifications/push-tokens',
        method: 'PUT',
        authorization: 'Bearer t',
        body: { token: TOKEN, platform: 'android' },
      },
      {
        url: 'https://api.test/v1/notifications/push-tokens/revoke',
        method: 'POST',
        authorization: 'Bearer t',
        body: { token: TOKEN },
      },
    ]);
  });

  it('web push — GET ключа, PUT подписки и POST снятия', async () => {
    const publicKey = `B${'A'.repeat(86)}`;
    await expect(client(200, { publicKey }).api.getWebPushConfig('t')).resolves.toEqual({
      publicKey,
    });
    const endpoint = 'https://fcm.googleapis.com/fcm/send/abc';
    const subscription = { endpoint, keys: { p256dh: publicKey, auth: 'A'.repeat(22) } };
    const { calls, api } = client(204, null);
    await api.registerWebPushSubscription('t', subscription);
    await api.revokeWebPushSubscription('t', { endpoint });
    expect(calls).toEqual([
      {
        url: 'https://api.test/v1/notifications/web-push/subscriptions',
        method: 'PUT',
        authorization: 'Bearer t',
        body: subscription,
      },
      {
        url: 'https://api.test/v1/notifications/web-push/subscriptions/revoke',
        method: 'POST',
        authorization: 'Bearer t',
        body: { endpoint },
      },
    ]);
  });

  it('429 RATE_LIMITED — ApiHttpError с кодом', async () => {
    const error = (await client(429, {
      code: 'RATE_LIMITED',
      message: 'x',
      details: { retryAfterSec: 30 },
    })
      .api.markAllNotificationsRead('t')
      .catch((e: unknown) => e)) as ApiHttpError;
    expect(error).toBeInstanceOf(ApiHttpError);
    expect(error.apiError.code).toBe('RATE_LIMITED');
  });
});
