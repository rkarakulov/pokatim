/// <reference types="jest" />
import { ApiHttpError, ApiNetworkError } from '@pokatim/api-client';
import NetInfo from '@react-native-community/netinfo';
import { focusManager, onlineManager, QueryObserver } from '@tanstack/react-query';

import { connectOnlineManager } from './online-manager';
import { createQueryClient, shouldRetry } from './query-client';

type Listener = Parameters<typeof NetInfo.addEventListener>[0];

describe('QueryClient приложения', () => {
  it('onlineManager следует за NetInfo: без сети запросы встают на паузу (fetchStatus paused)', () => {
    let listener: Listener | undefined;
    jest.mocked(NetInfo.addEventListener).mockImplementation((next) => {
      listener = next;
      return jest.fn();
    });
    connectOnlineManager();
    expect(listener).toBeDefined();

    listener?.({ isConnected: false } as Parameters<Listener>[0]);
    expect(onlineManager.isOnline()).toBe(false);
    listener?.({ isConnected: true } as Parameters<Listener>[0]);
    expect(onlineManager.isOnline()).toBe(true);
  });

  it('повтор — только для сети и 5xx; ответы 4xx окончательны', () => {
    expect(shouldRetry(0, new ApiNetworkError(null))).toBe(true);
    expect(shouldRetry(0, new ApiHttpError(503, null))).toBe(true);
    expect(shouldRetry(2, new ApiHttpError(503, null))).toBe(false);
    expect(shouldRetry(0, new ApiHttpError(404, null))).toBe(false);
    expect(shouldRetry(0, new ApiHttpError(401, null))).toBe(false);
  });

  it('мутации не повторяются сами (действие пользователя может быть не идемпотентным)', () => {
    const client = createQueryClient();
    expect(client.getDefaultOptions().mutations?.retry).toBe(false);
    expect(client.getDefaultOptions().queries?.retry).toBe(shouldRetry);
  });

  it('возврат фокуса сразу после ответа не повторяет запрос; через 10 с — повторяет (B13 смоука dev)', async () => {
    jest.useFakeTimers({ now: new Date('2026-10-27T09:00:00Z') });
    try {
      const client = createQueryClient();
      // как QueryClientProvider: подписка клиента на focusManager
      client.mount();
      const queryFn = jest.fn(async () => 'участие');
      const observer = new QueryObserver(client, { queryKey: ['races', 'entry', 'x'], queryFn });
      const unsubscribe = observer.subscribe(() => undefined);
      await jest.advanceTimersByTimeAsync(0);
      expect(queryFn).toHaveBeenCalledTimes(1);

      focusManager.setFocused(false);
      focusManager.setFocused(true);
      await jest.advanceTimersByTimeAsync(0);
      expect(queryFn).toHaveBeenCalledTimes(1);

      await jest.advanceTimersByTimeAsync(10_000);
      focusManager.setFocused(false);
      focusManager.setFocused(true);
      await jest.advanceTimersByTimeAsync(0);
      expect(queryFn).toHaveBeenCalledTimes(2);
      unsubscribe();
      client.unmount();
      client.clear();
    } finally {
      focusManager.setFocused(undefined);
      jest.useRealTimers();
    }
  });
});
