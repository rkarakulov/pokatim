import { randomUUID } from 'node:crypto';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';

/**
 * Фейковый Expo Push API для тестов (RC-10, по образцу `fake-ow.ts`): локальный HTTP-сервер (порт 0) с путями
 * `/--/api/v2/push/send` и `/getReceipts` и формой ответов Expo (`{ data: [...] }` тикетов, `{ data: { id: … } }`
 * квитанций). Токены из `unregistered` получают тикет `DeviceNotRegistered`; квитанции задаёт тест (`receiptsById`).
 * Режимы ошибок, ворота и журнал вызовов — для проверок.
 */

export const FAKE_EXPO_PATH = '/--/api/v2/push';

export interface FakeExpoMessage {
  to: string;
  title: string;
  body: string;
  sound?: string;
  channelId?: string;
  data?: { target: unknown };
}

export interface FakeExpoCall {
  route: 'send' | 'getReceipts' | 'other';
  headers: IncomingMessage['headers'];
  body: unknown;
}

type ExpoReceipt =
  { status: 'ok' } | { status: 'error'; message: string; details: { error: string } };

interface Failure {
  status: number;
  times: number;
  body?: string;
}

export class FakeExpo {
  readonly calls: FakeExpoCall[] = [];
  /** Все принятые сообщения (по порядку) и id выданного тикета. */
  readonly delivered: { message: FakeExpoMessage; ticketId: string }[] = [];
  /** Токены, на которые Expo отвечает тикетом `DeviceNotRegistered`. */
  readonly unregistered = new Set<string>();
  /** Квитанции по id тикета (нет в карте — квитанция ещё не готова). */
  readonly receiptsById = new Map<string, ExpoReceipt>();
  private readonly failures = new Map<string, Failure[]>();
  private holdUntil: (() => Promise<void>) | null = null;
  private server!: Server;
  url = '';

  async start(): Promise<this> {
    this.server = createServer((request, response) => {
      void this.handle(request, response).catch(() => {
        if (!response.headersSent) response.writeHead(500);
        response.end();
      });
    });
    await new Promise<void>((resolve) => this.server.listen(0, '127.0.0.1', resolve));
    const { port } = this.server.address() as AddressInfo;
    this.url = `http://127.0.0.1:${port}${FAKE_EXPO_PATH}`;
    return this;
  }

  async stop(): Promise<void> {
    this.server.closeAllConnections();
    await new Promise<void>((resolve) => this.server.close(() => resolve()));
  }

  reset(): void {
    this.calls.length = 0;
    this.delivered.length = 0;
    this.unregistered.clear();
    this.receiptsById.clear();
    this.failures.clear();
    this.holdUntil = null;
  }

  /** Следующие `times` запросов маршрута отвечают `status` (и `body`, если задан). */
  fail(route: 'send' | 'getReceipts', status: number, times = 1, body?: string): void {
    this.failures.set(route, [...(this.failures.get(route) ?? []), { status, times, body }]);
  }

  /** Запросы `send` ждут `wait()` (ворота `gate()` из `test/identity.ts`). */
  hold(wait: () => Promise<void>): void {
    this.holdUntil = wait;
  }

  callsTo(route: 'send' | 'getReceipts'): FakeExpoCall[] {
    return this.calls.filter((call) => call.route === route);
  }

  /** Сообщения на токен. */
  messagesTo(token: string): FakeExpoMessage[] {
    return this.delivered
      .filter((entry) => entry.message.to === token)
      .map((entry) => entry.message);
  }

  private async handle(request: IncomingMessage, response: ServerResponse): Promise<void> {
    const path = new URL(request.url ?? '/', 'http://fake').pathname;
    const raw = await readBody(request);
    const body: unknown = raw ? JSON.parse(raw) : undefined;
    const route =
      request.method === 'POST' && path === `${FAKE_EXPO_PATH}/send`
        ? 'send'
        : request.method === 'POST' && path === `${FAKE_EXPO_PATH}/getReceipts`
          ? 'getReceipts'
          : 'other';
    this.calls.push({ route, headers: request.headers, body });
    const send = (status: number, payload: unknown) => {
      response.writeHead(status, { 'content-type': 'application/json' });
      response.end(JSON.stringify(payload));
    };
    if (route === 'other') return send(404, { errors: [{ code: 'NOT_FOUND' }] });
    if (route === 'send' && this.holdUntil) await this.holdUntil();
    const failure = this.failures.get(route)?.find((entry) => entry.times > 0);
    if (failure) {
      failure.times -= 1;
      response.writeHead(failure.status, { 'content-type': 'application/json' });
      response.end(failure.body ?? JSON.stringify({ errors: [{ code: 'FAKE_FAILURE' }] }));
      return;
    }
    if (route === 'send') {
      const messages = body as FakeExpoMessage[];
      if (!Array.isArray(messages) || messages.length > 100) {
        return send(400, { errors: [{ code: 'VALIDATION_ERROR' }] });
      }
      const data = messages.map((message) => {
        if (this.unregistered.has(message.to)) {
          return {
            status: 'error',
            message: `"${message.to}" is not a registered push notification recipient`,
            details: { error: 'DeviceNotRegistered', expoPushToken: message.to },
          };
        }
        const ticketId = randomUUID();
        this.delivered.push({ message, ticketId });
        return { status: 'ok', id: ticketId };
      });
      return send(200, { data });
    }
    const ids = (body as { ids?: unknown } | undefined)?.ids;
    if (!Array.isArray(ids) || ids.length > 1000) {
      return send(400, { errors: [{ code: 'VALIDATION_ERROR' }] });
    }
    const data: Record<string, ExpoReceipt> = {};
    for (const id of ids as string[]) {
      const receipt = this.receiptsById.get(id);
      if (receipt) data[id] = receipt;
    }
    return send(200, { data });
  }
}

/** Квитанция `DeviceNotRegistered` (как отвечает Expo после отказа APNs/FCM). */
export const notRegisteredReceipt = (): ExpoReceipt => ({
  status: 'error',
  message: 'The device cannot receive push notifications anymore',
  details: { error: 'DeviceNotRegistered' },
});

async function readBody(request: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks).toString('utf8');
}

export async function startFakeExpo(): Promise<FakeExpo> {
  return new FakeExpo().start();
}
