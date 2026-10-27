import { PassThrough } from 'node:stream';

import { DomainError } from '@rkarakulov/api-kit/core';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { readLimited } from './raw-body';

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
