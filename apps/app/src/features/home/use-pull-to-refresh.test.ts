/// <reference types="jest" />
import { onlineManager } from '@tanstack/react-query';
import { act, renderHook } from '@testing-library/react-native';

import { usePullToRefresh } from './use-pull-to-refresh';

function deferred() {
  let resolve: () => void = () => undefined;
  const promise = new Promise<void>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

describe('usePullToRefresh (R7, AC6)', () => {
  it('жест перезапрашивает все запросы; индикатор — только пока они идут', async () => {
    const sections = deferred();
    const profile = jest.fn(() => Promise.resolve());
    const section = jest.fn(() => sections.promise);
    const refetchers = [section, profile];
    const { result } = await renderHook(() => usePullToRefresh(refetchers));
    expect(result.current.refreshing).toBe(false);

    let done: Promise<void> = Promise.resolve();
    await act(async () => {
      done = result.current.onRefresh();
    });
    expect(section).toHaveBeenCalledTimes(1);
    expect(profile).toHaveBeenCalledTimes(1);
    expect(result.current.refreshing).toBe(true);

    await act(async () => {
      sections.resolve();
      await done;
    });
    expect(result.current.refreshing).toBe(false);
  });

  it('сбой одного запроса не оставляет индикатор висеть', async () => {
    const refetchers = [() => Promise.reject(new Error('net')), () => Promise.resolve()];
    const { result } = await renderHook(() => usePullToRefresh(refetchers));
    await act(() => result.current.onRefresh());
    expect(result.current.refreshing).toBe(false);
  });

  it('без сети: запросы встают на паузу (promise не завершён) — индикатор снимается сразу, запросы вызваны', async () => {
    onlineManager.setOnline(false);
    const paused = jest.fn(() => new Promise<void>(() => undefined));
    const refetchers = [paused];
    const { result } = await renderHook(() => usePullToRefresh(refetchers));

    await act(() => result.current.onRefresh());

    // запрос поставлен: TanStack Query возобновит его, когда сеть вернётся
    expect(paused).toHaveBeenCalledTimes(1);
    expect(result.current.refreshing).toBe(false);
  });

  it('сеть пропала во время жеста — индикатор снимается, не ждёт возврата сети', async () => {
    const paused = jest.fn(() => new Promise<void>(() => undefined));
    const refetchers = [paused];
    const { result } = await renderHook(() => usePullToRefresh(refetchers));

    let done: Promise<void> = Promise.resolve();
    await act(async () => {
      done = result.current.onRefresh();
    });
    expect(result.current.refreshing).toBe(true);

    await act(async () => {
      onlineManager.setOnline(false);
      await done;
    });
    expect(result.current.refreshing).toBe(false);
  });
});
