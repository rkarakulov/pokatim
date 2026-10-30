/// <reference types="jest" />
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook } from '@testing-library/react-native';
import type { ReactNode } from 'react';

import {
  AVATAR_BLOCK_RECHECK_MS,
  MAX_TIMEOUT_MS,
  useAvatarBlockExpiry,
} from './avatar-block-expiry';

const NOW = Date.parse('2026-10-30T10:00:00.000Z');
const at = (ms: number) => new Date(NOW + ms).toISOString();
const DAY = 24 * 60 * 60 * 1000;

let client: QueryClient;
let invalidate: jest.SpyInstance;

function render(initial: string | null) {
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  return renderHook(({ until }: { until: string | null }) => useAvatarBlockExpiry(until), {
    wrapper,
    initialProps: { until: initial },
  });
}

/** Ответ сервера после перечитывания: срок истёк — `null`, расхождение часов — прежний срок. */
const serverAnswers = (until: string | null) =>
  invalidate.mockImplementation(async () => {
    client.setQueryData(['profile'], { avatarUploadBlockedUntil: until });
  });

const advance = (ms: number) =>
  act(async () => {
    await jest.advanceTimersByTimeAsync(ms);
  });

beforeEach(() => {
  jest.useFakeTimers({ now: NOW });
  client = new QueryClient();
  invalidate = jest.spyOn(client, 'invalidateQueries');
  serverAnswers(null);
});
afterEach(() => {
  jest.useRealTimers();
});

describe('окончание запрета загрузки фото при открытом экране (ревью pass 1, MEDIUM)', () => {
  it('срок прошёл — перечитывание профиля ровно один раз; до срока — нет', async () => {
    await render(at(60_000));
    await advance(59_000);
    expect(invalidate).not.toHaveBeenCalled();
    await advance(2_000);
    expect(invalidate).toHaveBeenCalledTimes(1);
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['profile'] });
    await advance(10 * AVATAR_BLOCK_RECHECK_MS);
    expect(invalidate).toHaveBeenCalledTimes(1);
  });

  it('без запрета — таймера нет', async () => {
    await render(null);
    await advance(DAY);
    expect(invalidate).not.toHaveBeenCalled();
  });

  it('размонтирование до срока — таймер отменён', async () => {
    const view = await render(at(60_000));
    await view.unmount();
    await advance(2 * 60_000);
    expect(invalidate).not.toHaveBeenCalled();
  });

  it('срок сменился — прежний таймер отменён, новый — на новый срок', async () => {
    const view = await render(at(60_000));
    await view.rerender({ until: at(5 * 60_000) });
    await advance(2 * 60_000);
    expect(invalidate).not.toHaveBeenCalled();
    await advance(4 * 60_000);
    expect(invalidate).toHaveBeenCalledTimes(1);
  });

  it('срок дальше предела setTimeout (30 дней) — задержка не больше 2^31-1 мс, перечитывание — в срок', async () => {
    const timeout = jest.spyOn(globalThis, 'setTimeout');
    await render(at(30 * DAY));
    await advance(MAX_TIMEOUT_MS + 1_000);
    expect(invalidate).not.toHaveBeenCalled();
    await advance(30 * DAY - MAX_TIMEOUT_MS);
    expect(invalidate).toHaveBeenCalledTimes(1);
    for (const [, delay] of timeout.mock.calls)
      expect(delay ?? 0).toBeLessThanOrEqual(MAX_TIMEOUT_MS);
  });

  it('сервер ещё держит запрет (часы устройства впереди) — повторная проверка позже, без разблокировки', async () => {
    const until = at(60_000);
    serverAnswers(until);
    await render(until);
    await advance(61_000);
    expect(invalidate).toHaveBeenCalledTimes(1);
    serverAnswers(null);
    await advance(AVATAR_BLOCK_RECHECK_MS);
    expect(invalidate).toHaveBeenCalledTimes(2);
    await advance(10 * AVATAR_BLOCK_RECHECK_MS);
    expect(invalidate).toHaveBeenCalledTimes(2);
  });

  it('срок уже в прошлом при монтировании — перечитывание сразу', async () => {
    await render(at(-1_000));
    await advance(0);
    expect(invalidate).toHaveBeenCalledTimes(1);
  });
});
