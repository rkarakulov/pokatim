import { describe, expect, it } from 'vitest';

import { createApiClient } from './index.ts';

interface Call {
  url: string;
  method: string | undefined;
  authorization: string | null;
  body: unknown;
}

const list = {
  items: [
    {
      provider: 'garmin',
      name: 'Garmin',
      available: true,
      status: 'not_connected',
      issue: null,
      connectedAt: null,
      lastSyncedAt: null,
    },
  ],
};
const ticket = 'B'.repeat(43);

function client(status: number, response: unknown) {
  const calls: Call[] = [];
  const fetchImpl = ((url: string, init?: RequestInit) => {
    calls.push({
      url,
      method: init?.method,
      authorization: new Headers(init?.headers).get('authorization'),
      body: typeof init?.body === 'string' ? JSON.parse(init.body) : undefined,
    });
    return Promise.resolve(new Response(JSON.stringify(response), { status }));
  }) as typeof fetch;
  return { calls, api: createApiClient({ baseUrl: 'https://api.test', fetchImpl }) };
}

describe('api-client: устройства и шаг онбординга (Bearer — только явным параметром)', () => {
  it('listDevices — GET с Bearer', async () => {
    const { calls, api } = client(200, list);
    await expect(api.listDevices('t')).resolves.toEqual(list);
    expect(calls).toEqual([
      {
        url: 'https://api.test/v1/devices',
        method: 'GET',
        authorization: 'Bearer t',
        body: undefined,
      },
    ]);
  });

  it('connect, complete, sync, disconnect — POST с телом и Bearer', async () => {
    const connect = client(200, { authorizeUrl: 'https://ow.test/authorize?x=1' });
    await expect(
      connect.api.connectDevice('t', 'garmin', { returnUrl: 'pokatim://devices/return' }),
    ).resolves.toEqual({ authorizeUrl: 'https://ow.test/authorize?x=1' });
    expect(connect.calls[0]).toEqual({
      url: 'https://api.test/v1/devices/garmin/connect',
      method: 'POST',
      authorization: 'Bearer t',
      body: { returnUrl: 'pokatim://devices/return' },
    });

    const complete = client(200, list);
    await complete.api.completeDevice('t', 'wahoo', { ticket });
    expect(complete.calls[0]).toMatchObject({
      url: 'https://api.test/v1/devices/wahoo/complete',
      body: { ticket },
      authorization: 'Bearer t',
    });

    const sync = client(200, list);
    await sync.api.syncDevice('t', 'garmin');
    expect(sync.calls[0]).toMatchObject({
      url: 'https://api.test/v1/devices/garmin/sync',
      method: 'POST',
      body: {},
    });

    const disconnect = client(200, list);
    await disconnect.api.disconnectDevice('t', 'garmin', { deleteActivities: true });
    expect(disconnect.calls[0]).toMatchObject({
      url: 'https://api.test/v1/devices/garmin/disconnect',
      body: { deleteActivities: true },
    });
  });

  it('ответ connect не https — ошибка разбора', async () => {
    await expect(
      client(200, { authorizeUrl: 'http://ow.test/a' }).api.connectDevice('t', 'garmin', {
        returnUrl: 'x',
      }),
    ).rejects.toThrow();
  });

  it('completeDevicesStep — PUT с исходом шага', async () => {
    const { calls, api } = client(200, { surveyCompleted: true, devicesStepCompleted: true });
    await expect(api.completeDevicesStep('t', { outcome: 'later' })).resolves.toEqual({
      surveyCompleted: true,
      devicesStepCompleted: true,
    });
    expect(calls[0]).toEqual({
      url: 'https://api.test/v1/profile/onboarding/devices',
      method: 'PUT',
      authorization: 'Bearer t',
      body: { outcome: 'later' },
    });
  });
});
