import { createServer, type Server } from 'node:http';
import { connect, type AddressInfo, type Socket } from 'node:net';
import { PassThrough } from 'node:stream';

import { DomainError } from '@rkarakulov/api-kit/core';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { LINGER_MS, readLimited } from './raw-body';

const ERRORS = { unsupported: 'ROUTE_FORMAT_UNSUPPORTED', tooLarge: 'ROUTE_TOO_LARGE' } as const;
const TIMEOUTS = { idleMs: 30_000, totalMs: 180_000 };

/** Отказ чтения тела: код, статус и детали `DomainError`. */
async function rejection(promise: Promise<unknown>) {
  const error: unknown = await promise.then(
    () => undefined,
    (failure: unknown) => failure,
  );
  expect(error).toBeInstanceOf(DomainError);
  const domain = error as DomainError<string>;
  return { code: domain.code, status: domain.status, details: domain.details };
}

const TIMED_OUT = {
  code: 'VALIDATION_FAILED',
  status: 408,
  details: { fields: [{ path: 'body', code: 'INVALID' }] },
};

describe('readLimited', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('тело целиком — байты; не поток — 415; больше лимита — 413 и остаток сливается', async () => {
    const body = new PassThrough();
    const read = readLimited(body, 10, ERRORS, TIMEOUTS);
    body.write('abc');
    body.end('def');
    expect(Buffer.from(await read).toString()).toBe('abcdef');

    expect(await rejection(readLimited({}, 10, ERRORS, TIMEOUTS))).toMatchObject({
      code: 'ROUTE_FORMAT_UNSUPPORTED',
      status: 415,
    });

    const large = new PassThrough();
    const tooLarge = readLimited(large, 4, ERRORS, TIMEOUTS);
    large.write('12345');
    expect(await rejection(tooLarge)).toMatchObject({ code: 'ROUTE_TOO_LARGE', status: 413 });
    expect(large.isPaused()).toBe(false);
  });

  it('тишина дольше idleMs — 408 VALIDATION_FAILED body INVALID, поток сливается', async () => {
    const body = new PassThrough();
    const read = readLimited(body, 1024, ERRORS, TIMEOUTS);
    body.write('a');
    await vi.advanceTimersByTimeAsync(TIMEOUTS.idleMs - 1);
    body.write('b');
    // порция сбросила таймер тишины
    await vi.advanceTimersByTimeAsync(TIMEOUTS.idleMs - 1);
    const outcome = rejection(read);
    await vi.advanceTimersByTimeAsync(1);
    expect(await outcome).toEqual(TIMED_OUT);
    expect(body.listenerCount('data')).toBe(0); // сборщик тела снят, остаток сливается
    expect(body.isPaused()).toBe(false);
  });

  it('тело без единой порции — 408 через idleMs', async () => {
    const body = new PassThrough();
    const outcome = rejection(readLimited(body, 1024, ERRORS, TIMEOUTS));
    await vi.advanceTimersByTimeAsync(TIMEOUTS.idleMs);
    expect(await outcome).toEqual(TIMED_OUT);
  });

  it('порции чаще idleMs, но тело дольше totalMs — 408', async () => {
    const body = new PassThrough();
    const outcome = rejection(readLimited(body, 1024 * 1024, ERRORS, TIMEOUTS));
    for (let elapsed = 0; elapsed < TIMEOUTS.totalMs; elapsed += 10_000) {
      body.write('x');
      await vi.advanceTimersByTimeAsync(10_000);
    }
    expect(await outcome).toEqual(TIMED_OUT);
  });

  it('после завершения и отказа таймеры сняты (поздний таймаут не срабатывает)', async () => {
    const body = new PassThrough();
    const read = readLimited(body, 1024, ERRORS, TIMEOUTS);
    body.end('ok');
    await read;
    expect(vi.getTimerCount()).toBe(0);

    const large = new PassThrough();
    const tooLarge = rejection(readLimited(large, 1, ERRORS, TIMEOUTS));
    large.write('12');
    await tooLarge;
    expect(vi.getTimerCount()).toBe(0);

    const broken = new PassThrough();
    const failed = readLimited(broken, 1024, ERRORS, TIMEOUTS).catch((error: unknown) => error);
    broken.destroy(new Error('aborted'));
    expect(await failed).toBeInstanceOf(Error);
    expect(vi.getTimerCount()).toBe(0);
  });
});

/** HTTP-сервер: тело — `readLimited` с лимитом 64 КиБ, отказ — 413 с `Connection: close` (как обработчики загрузок). */
async function limitedServer(): Promise<{ server: Server; port: number; closed: Promise<void> }> {
  let serverSocketClosed!: () => void;
  const closed = new Promise<void>((resolve) => (serverSocketClosed = resolve));
  const server = createServer((request, response) => {
    readLimited(request, 64 * 1024, ERRORS, TIMEOUTS).then(
      () => response.writeHead(202).end(),
      () => response.writeHead(413, { connection: 'close' }).end('{"code":"ROUTE_TOO_LARGE"}'),
    );
  });
  server.once('connection', (socket: Socket) => socket.once('close', serverSocketClosed));
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  return { server, port: (server.address() as AddressInfo).port, closed };
}

/**
 * Клиент на голом сокете: заголовки с `Content-Length`, затем `sent` байт тела; ответ и исход соединения.
 * `allowHalfOpen` — клиент не закрывается на FIN сервера (молчит, держит соединение).
 */
function rawUpload(port: number, declared: number, sent: number, allowHalfOpen = false) {
  const socket = connect({ port, host: '127.0.0.1', allowHalfOpen });
  const received: Buffer[] = [];
  socket.on('data', (chunk: Buffer) => received.push(chunk));
  // первая порция ответа — по событию сокета, без `vi.waitFor`: с фейковыми таймерами он сам двигает часы
  const responded = new Promise<void>((resolve) => socket.once('data', () => resolve()));
  const closed = new Promise<{ error: string | null }>((resolve) => {
    let error: string | null = null;
    socket.on(
      'error',
      (failure: NodeJS.ErrnoException) => (error = failure.code ?? failure.message),
    );
    socket.on('close', () => resolve({ error }));
  });
  socket.write(
    `POST /upload HTTP/1.1\r\nHost: x\r\nContent-Type: application/octet-stream\r\nContent-Length: ${declared}\r\n\r\n`,
  );
  socket.write(Buffer.alloc(sent, 0x20));
  return {
    socket,
    response: () => Buffer.concat(received).toString('latin1'),
    responded,
    closed,
  };
}

describe('readLimited: закрытие после отказа (lingering close)', () => {
  let target: Awaited<ReturnType<typeof limitedServer>>;
  beforeEach(async () => {
    target = await limitedServer();
  });
  afterEach(async () => {
    vi.useRealTimers();
    target.server.closeAllConnections();
    await new Promise<void>((resolve) => target.server.close(() => resolve()));
  });

  it('хвост тела ещё идёт после 413 — клиент получает ответ целиком, сокет закрыт без RST', async () => {
    const size = 64 * 1024 * 1024;
    const upload = rawUpload(target.port, size, size);
    expect(await upload.closed).toEqual({ error: null });
    expect(upload.response()).toMatch(/^HTTP\/1\.1 413 /);
    expect(upload.response()).toMatch(/\r\nconnection: close\r\n/i);
    expect(upload.response()).toContain('ROUTE_TOO_LARGE');
  });

  it('клиент не дослал тело и молчит — сервер закрывает сокет через LINGER_MS, не раньше', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const upload = rawUpload(target.port, 1024 * 1024, 128 * 1024, true);
    let closed = false;
    void target.closed.then(() => (closed = true));
    await upload.responded;
    expect(upload.response()).toMatch(/^HTTP\/1\.1 413 /);
    await vi.advanceTimersByTimeAsync(LINGER_MS - 100);
    expect(closed).toBe(false);
    await vi.advanceTimersByTimeAsync(100);
    await target.closed;
    upload.socket.destroy();
  });
});
