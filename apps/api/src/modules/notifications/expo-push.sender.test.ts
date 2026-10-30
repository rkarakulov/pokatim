import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';

import { Logger } from '@nestjs/common';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { type FakeExpo, notRegisteredReceipt, startFakeExpo } from '../../../test/fake-expo';
import { ExpoPushSender } from './expo-push.sender';
import { type PushMessage, PushSendError } from './push-sender';

const ACCESS_TOKEN = 'expo-access-token-0123456789abcdef';
const RIDE = '0190a8c8-0000-7000-8000-000000000001';

let expo: FakeExpo;
beforeAll(async () => {
  expo = await startFakeExpo();
});
afterAll(async () => {
  await expo.stop();
});
beforeEach(() => {
  expo.reset();
});
afterEach(() => {
  vi.restoreAllMocks();
});

const make = (
  overrides: { accessToken?: string | null; timeoutMs?: number; maxBodyBytes?: number } = {},
) => new ExpoPushSender({ apiUrl: expo.url, accessToken: ACCESS_TOKEN, ...overrides });

const token = (n: number) => `ExponentPushToken[device-${String(n).padStart(10, '0')}]`;
const message = (n: number): PushMessage => ({
  to: token(n),
  title: 'Райд отменён',
  body: '«Кофе» отменён.',
  target: { type: 'ride', rideId: RIDE },
});

const failure = async (promise: Promise<unknown>): Promise<PushSendError> => {
  const error = await promise.then(
    () => undefined,
    (reason: unknown) => reason,
  );
  if (!(error instanceof PushSendError))
    throw new Error(`expected PushSendError: ${String(error)}`);
  return error;
};

describe('ExpoPushSender.send', () => {
  it('сообщение Expo: to, title, body, sound, channelId, data.target; тикеты по порядку', async () => {
    expo.unregistered.add(token(2));
    const tickets = await make().send([message(1), message(2)]);
    expect(tickets[0]).toMatchObject({ status: 'ok' });
    expect(tickets[1]).toEqual({ status: 'error', error: 'DeviceNotRegistered' });
    const [call] = expo.callsTo('send');
    expect(call?.body).toEqual([
      {
        to: token(1),
        title: 'Райд отменён',
        body: '«Кофе» отменён.',
        sound: 'default',
        channelId: 'default',
        data: { target: { type: 'ride', rideId: RIDE } },
      },
      expect.objectContaining({ to: token(2) }),
    ]);
    expect(call?.headers['content-type']).toBe('application/json');
    expect(call?.headers.accept).toBe('application/json');
    expect(call?.headers.authorization).toBe(`Bearer ${ACCESS_TOKEN}`);
  });

  it('пачки по 100 сообщений', async () => {
    const messages = Array.from({ length: 250 }, (_, i) => message(i));
    const tickets = await make().send(messages);
    expect(tickets).toHaveLength(250);
    expect(expo.callsTo('send').map((call) => (call.body as unknown[]).length)).toEqual([
      100, 100, 50,
    ]);
  });

  it('без EXPO_ACCESS_TOKEN — без заголовка Authorization', async () => {
    await make({ accessToken: null }).send([message(1)]);
    expect(expo.callsTo('send')[0]?.headers.authorization).toBeUndefined();
  });

  it('429 и 5xx — unavailable, прочие 4xx — rejected', async () => {
    expo.fail('send', 429);
    expect((await failure(make().send([message(1)]))).kind).toBe('unavailable');
    expo.fail('send', 503);
    expect((await failure(make().send([message(1)]))).kind).toBe('unavailable');
    expo.fail('send', 400);
    expect(await failure(make().send([message(1)]))).toMatchObject({
      kind: 'rejected',
      status: 400,
    });
  });

  it('ответ не по схеме, не JSON, число тикетов не совпало — protocol', async () => {
    expo.fail('send', 200, 1, JSON.stringify({ data: [{ status: 'weird' }] }));
    expect((await failure(make().send([message(1)]))).kind).toBe('protocol');
    expo.fail('send', 200, 1, 'not json');
    expect((await failure(make().send([message(1)]))).kind).toBe('protocol');
    expo.fail('send', 200, 1, JSON.stringify({ data: [] }));
    expect((await failure(make().send([message(1)]))).kind).toBe('protocol');
  });

  it('тело больше лимита — protocol', async () => {
    expect((await failure(make({ maxBodyBytes: 10 }).send([message(1)]))).kind).toBe('protocol');
  });

  it('таймаут и сеть — unavailable', async () => {
    let release!: () => void;
    expo.hold(() => new Promise<void>((resolve) => (release = resolve)));
    // таймаут — по команде теста, когда запрос уже удержан фейком (настоящие 50 мс под нагрузкой истекали раньше,
    // чем запрос до него доходил)
    const timeout = new AbortController();
    const timeoutSpy = vi.spyOn(AbortSignal, 'timeout').mockReturnValue(timeout.signal);
    const sending = failure(make({ timeoutMs: 50 }).send([message(1)]));
    await vi.waitFor(() => expect(expo.callsTo('send')).toHaveLength(1));
    expect(timeoutSpy).toHaveBeenCalledWith(50);
    timeout.abort(new DOMException('timed out', 'TimeoutError'));
    expect(await sending).toMatchObject({ kind: 'unavailable', message: 'push service timeout' });
    // удержанный запрос дорабатывает в этом тесте: проснувшись в следующем, он забрал бы его `expo.fail(...)`
    release();
    await vi.waitFor(() => expect(expo.delivered).toHaveLength(1));
    const closed = new ExpoPushSender({
      apiUrl: 'http://127.0.0.1:1/--/api/v2/push',
      accessToken: null,
    });
    expect((await failure(closed.send([message(1)]))).kind).toBe('unavailable');
  });

  it('редирект не следует — ошибка', async () => {
    const server: Server = createServer((_request, response) => {
      response.writeHead(302, { location: expo.url + '/send' });
      response.end();
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const { port } = server.address() as AddressInfo;
    try {
      const redirecting = new ExpoPushSender({
        apiUrl: `http://127.0.0.1:${port}`,
        accessToken: null,
      });
      await failure(redirecting.send([message(1)]));
      expect(expo.callsTo('send')).toHaveLength(0);
    } finally {
      server.closeAllConnections();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });

  it('токены устройств и ключ — не в логах и не в текстах ошибок', async () => {
    const logs: string[] = [];
    for (const level of ['log', 'warn', 'error'] as const) {
      vi.spyOn(Logger.prototype, level).mockImplementation((text: unknown) => {
        logs.push(String(text));
      });
    }
    expo.fail('send', 500);
    const error = await failure(make().send([message(1)]));
    expo.fail('send', 200, 1, JSON.stringify({ data: [{ status: 'weird' }] }));
    const protocol = await failure(make().send([message(1)]));
    const text = [...logs, error.message, protocol.message].join('\n');
    expect(logs.length).toBeGreaterThan(0);
    expect(text).not.toContain('ExponentPushToken');
    expect(text).not.toContain(ACCESS_TOKEN);
  });
});

describe('ExpoPushSender.receipts', () => {
  it('квитанции по id пачками до 1000; ещё не готовые — нет в карте', async () => {
    const ids = Array.from({ length: 1500 }, (_, i) => `ticket-${i}`);
    expo.receiptsById.set('ticket-0', { status: 'ok' });
    expo.receiptsById.set('ticket-1200', notRegisteredReceipt());
    const receipts = await make().receipts(ids);
    expect(
      expo.callsTo('getReceipts').map((call) => (call.body as { ids: unknown[] }).ids.length),
    ).toEqual([1000, 500]);
    expect(receipts.get('ticket-0')).toEqual({ status: 'ok' });
    expect(receipts.get('ticket-1200')).toEqual({ status: 'error', error: 'DeviceNotRegistered' });
    expect(receipts.has('ticket-1')).toBe(false);
  });

  it('5xx — unavailable', async () => {
    expo.fail('getReceipts', 502);
    expect((await failure(make().receipts(['t']))).kind).toBe('unavailable');
  });
});
